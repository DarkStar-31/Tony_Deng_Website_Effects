/**
 * Admin API for the Tony D site.
 *
 * This runs inside the site's own Worker: the root wrangler.toml points
 * `main` here and only sends /api/admin/* to this script, so every other
 * request is served straight from the static assets. That is what lets the
 * admin work on a bare *.workers.dev address, where a separate Worker route
 * is impossible.
 *
 * Authentication is one shared password, kept in a Worker secret and
 * answered with a signed, HttpOnly session cookie. It is a stopgap until the
 * site has its own domain and can go behind Cloudflare Access — Access on
 * workers.dev would lock the public site as well. Everyone who knows the
 * password can edit and publish; there is no per-person identity.
 *
 * The browser never talks to GitHub. It posts JSON here, and this Worker
 * commits with a token it holds server-side — which is what makes the admin
 * usable from mainland China, where api.github.com is slow and unreliable
 * but the Cloudflare edge is reachable.
 *
 * Bindings (see the root wrangler.toml):
 *   ASSETS          the static site, for anything that is not the API
 *   GITHUB_REPO     owner/repo the admin commits to
 *   LIVE_BRANCH     main
 *   DRAFT_BRANCH    draft
 *   GITHUB_TOKEN    secret — fine-grained PAT, Contents: read & write
 *   ADMIN_PASSWORD  secret — the one password for /admin
 */

const CONTENT_FILES = ['content/shared.json', 'content/en.json', 'content/zh.json'];

const IMAGE_TYPES = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const AUDIO_TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg' };

// GitHub's blob API takes base64; anything much larger than this belongs in
// R2 rather than in git history.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// ------------------------------------------------------------ login

const COOKIE = 'tony_admin';
const SESSION_SECONDS = 7 * 24 * 3600;

const enc = new TextEncoder();

function b64urlToBytes(input) {
  let s = input.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function requireSecret(env, name) {
  if (!env[name]) {
    throw new HttpError(500, `The ${name} secret is not set`,
      'Cloudflare dashboard → this Worker → Settings → Variables and Secrets.');
  }
  return env[name];
}

async function hmac(env, text) {
  const key = await crypto.subtle.importKey(
    // Keyed on the password and the token together, so changing the password
    // signs everyone out and there is no third secret to set.
    'raw', enc.encode(`${requireSecret(env, 'ADMIN_PASSWORD')}
${requireSecret(env, 'GITHUB_TOKEN')}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

/** Compare two strings without leaking where they differ through timing. */
async function sameText(env, a, b) {
  const [x, y] = await Promise.all([hmac(env, a), hmac(env, b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const ADMIN = { email: 'admin', canPublish: true };

function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function handleLogin(request, env) {
  const { password } = await request.json().catch(() => ({}));

  if (!(await sameText(env, String(password || ''), requireSecret(env, 'ADMIN_PASSWORD')))) {
    // Slows guessing down a little. It is per request, not per attacker, so
    // it is no substitute for a long password.
    await new Promise((r) => setTimeout(r, 1000));
    throw new HttpError(401, 'Wrong password');
  }

  const payload = bytesToB64url(enc.encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })));
  const token = `${payload}.${bytesToB64url(await hmac(env, payload))}`;

  const res = json({ ok: true, ...ADMIN });
  res.headers.append('Set-Cookie', sessionCookie(token, SESSION_SECONDS));
  return res;
}

function handleLogout() {
  const res = json({ ok: true });
  res.headers.append('Set-Cookie', sessionCookie('', 0));
  return res;
}

async function authenticate(request, env) {
  const token = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)tony_admin=([^;]+)/)?.[1];
  if (!token) throw new HttpError(401, 'Not signed in');

  const [payload, sig] = token.split('.');
  if (!sig || !(await sameText(env, sig, bytesToB64url(await hmac(env, payload))))) {
    throw new HttpError(401, 'Not signed in', 'The session was not recognised — sign in again.');
  }

  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
  } catch {
    throw new HttpError(401, 'Not signed in');
  }
  if (!data.exp || data.exp < Date.now() / 1000) {
    throw new HttpError(401, 'Not signed in', 'Your session expired — sign in again.');
  }

  return ADMIN;
}

// ------------------------------------------------------------ GitHub

async function gh(env, path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tony-site-admin',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const body = await res.text();
    throw new HttpError(502, `GitHub ${res.status} on ${path}`, body.slice(0, 400));
  }
  return res.status === 204 ? true : res.json();
}

const repo = (env) => `/repos/${env.GITHUB_REPO}`;

async function branchHead(env, branch) {
  const ref = await gh(env, `${repo(env)}/git/ref/heads/${branch}`);
  return ref ? ref.object.sha : null;
}

/** Create the draft branch off the live branch the first time it is needed. */
async function ensureDraft(env) {
  const existing = await branchHead(env, env.DRAFT_BRANCH);
  if (existing) return existing;

  const live = await branchHead(env, env.LIVE_BRANCH);
  if (!live) throw new HttpError(500, `Live branch ${env.LIVE_BRANCH} not found`);

  await gh(env, `${repo(env)}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${env.DRAFT_BRANCH}`, sha: live }),
  });
  return live;
}

async function readFile(env, branch, path) {
  const data = await gh(
    env,
    `${repo(env)}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${branch}`,
  );
  if (!data) return null;
  const bytes = b64urlToBytes(data.content.replace(/\n/g, ''));
  return new TextDecoder().decode(bytes);
}

/**
 * Commit several files in one commit via the git data API, so content and the
 * images it references can never land half-applied.
 */
async function commitFiles(env, { branch, files, message, author, expectedHead }) {
  const head = await ensureDraft(env);

  if (expectedHead && expectedHead !== head) {
    throw new HttpError(
      409,
      'Someone else saved while you were editing',
      'Reload the admin to pick up their changes, then re-apply yours.',
    );
  }

  const headCommit = await gh(env, `${repo(env)}/git/commits/${head}`);

  const tree = [];
  for (const file of files) {
    const blob = await gh(env, `${repo(env)}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify(
        file.encoding === 'base64'
          ? { content: file.content, encoding: 'base64' }
          : { content: file.content, encoding: 'utf-8' },
      ),
    });
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await gh(env, `${repo(env)}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }),
  });

  const commit = await gh(env, `${repo(env)}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: newTree.sha,
      parents: [head],
      // Everyone shares one password, so there is no real person to credit.
      // `.invalid` can never be a real address, so no GitHub account gets it.
      author: { name: `Site ${author}`, email: `${author}@tony-deng-website.invalid`, date: new Date().toISOString() },
    }),
  });

  await gh(env, `${repo(env)}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  return commit.sha;
}

// ------------------------------------------------------------ handlers

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function handleContent(env) {
  const head = await ensureDraft(env);
  const out = { headSha: head, files: {} };

  for (const path of CONTENT_FILES) {
    const text = await readFile(env, env.DRAFT_BRANCH, path);
    if (text === null) throw new HttpError(500, `${path} missing on ${env.DRAFT_BRANCH}`);
    out.files[path] = JSON.parse(text);
  }
  return json(out);
}

async function handleSave(request, env, user) {
  const body = await request.json();
  const { files, headSha, message } = body;

  if (!files || typeof files !== 'object') throw new HttpError(400, 'No files in request');

  const payload = [];
  for (const path of Object.keys(files)) {
    if (!CONTENT_FILES.includes(path)) throw new HttpError(400, `Refusing to write ${path}`);
    // Re-serialise here rather than trusting the client's formatting, so the
    // committed JSON stays diffable no matter what the browser sent.
    payload.push({
      path,
      content: JSON.stringify(files[path], null, 2) + '\n',
      encoding: 'utf-8',
    });
  }

  const sha = await commitFiles(env, {
    branch: env.DRAFT_BRANCH,
    files: payload,
    message: (message || 'Update content').slice(0, 200) + `\n\nEdited by ${user.email} via /admin`,
    author: user.email,
    expectedHead: headSha,
  });

  return json({ ok: true, commit: sha });
}

async function handleUpload(request, env, user) {
  const body = await request.json();
  const { path, contentBase64 } = body;

  if (typeof path !== 'string' || !/^(img|audio)\/[A-Za-z0-9._/-]+$/.test(path) || path.includes('..')) {
    throw new HttpError(400, 'Uploads must go to img/ or audio/ with a simple filename');
  }

  const ext = path.split('.').pop().toLowerCase();
  const allowed = path.startsWith('img/') ? IMAGE_TYPES : AUDIO_TYPES;
  if (!allowed[ext]) {
    throw new HttpError(400, `${ext} is not an allowed file type for ${path.split('/')[0]}/`);
  }

  const size = Math.floor((contentBase64.length * 3) / 4);
  if (size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `File is ${(size / 1e6).toFixed(1)}MB — the limit is ${MAX_UPLOAD_BYTES / 1e6}MB`);
  }

  const sha = await commitFiles(env, {
    branch: env.DRAFT_BRANCH,
    files: [{ path, content: contentBase64, encoding: 'base64' }],
    message: `Upload ${path}\n\nUploaded by ${user.email} via /admin`,
    author: user.email,
  });

  return json({ ok: true, commit: sha, path });
}

async function handleStatus(env, user) {
  await ensureDraft(env);
  const compare = await gh(
    env,
    `${repo(env)}/compare/${env.LIVE_BRANCH}...${env.DRAFT_BRANCH}`,
  );

  return json({
    email: user.email,
    canPublish: user.canPublish,
    liveBranch: env.LIVE_BRANCH,
    draftBranch: env.DRAFT_BRANCH,
    ahead: compare ? compare.ahead_by : 0,
    behind: compare ? compare.behind_by : 0,
    unpublished: compare
      ? compare.commits.map((c) => ({
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split('\n')[0],
          date: c.commit.author.date,
          author: c.commit.author.email,
        }))
      : [],
  });
}

async function handlePublish(env, user) {
  if (!user.canPublish) {
    throw new HttpError(
      403,
      'Your changes are saved, but publishing is limited',
      'Ask the site owner to publish. Nothing is lost — everything you saved is on the draft branch and visible on the preview URL.',
    );
  }

  const res = await fetch(`https://api.github.com${repo(env)}/merges`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'tony-site-admin',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base: env.LIVE_BRANCH,
      head: env.DRAFT_BRANCH,
      commit_message: `Publish content changes\n\nPublished by ${user.email} via /admin`,
    }),
  });

  if (res.status === 409) throw new HttpError(409, 'Merge conflict between draft and live — needs a human with git');
  if (res.status === 204) return json({ ok: true, alreadyUpToDate: true });
  if (!res.ok) throw new HttpError(502, `GitHub ${res.status} on merge`, (await res.text()).slice(0, 400));

  const merge = await res.json();

  // Fast-forward draft onto the merge commit so the next edit starts level
  // with live; otherwise draft trails and every publish re-merges old work.
  await gh(env, `${repo(env)}/git/refs/heads/${env.DRAFT_BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: merge.sha, force: true }),
  });

  return json({ ok: true, commit: merge.sha });
}

// ------------------------------------------------------------ router

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // wrangler.toml only runs this script for /api/admin/*, but if that
    // pattern ever widens the site must still be served.
    if (!url.pathname.startsWith('/api/admin/')) return env.ASSETS.fetch(request);

    const path = url.pathname.replace(/^\/api\/admin/, '');

    try {
      // The cookie is SameSite=Strict already; refusing cross-site writes
      // outright is a second, independent guard against forged requests.
      const origin = request.headers.get('Origin');
      if (request.method !== 'GET' && origin && origin !== url.origin) {
        throw new HttpError(403, 'Cross-site request refused');
      }

      if (request.method === 'POST' && path === '/login') return await handleLogin(request, env);
      if (request.method === 'POST' && path === '/logout') return handleLogout();

      const user = await authenticate(request, env);

      // `return await`, not `return`: a bare returned promise would reject
      // outside this try, and the error would reach the browser as a bare 500.
      if (request.method === 'GET' && path === '/status') return await handleStatus(env, user);
      if (request.method === 'GET' && path === '/content') return await handleContent(env);
      if (request.method === 'PUT' && path === '/content') return await handleSave(request, env, user);
      if (request.method === 'POST' && path === '/upload') return await handleUpload(request, env, user);
      if (request.method === 'POST' && path === '/publish') return await handlePublish(env, user);

      throw new HttpError(404, `No admin route for ${request.method} ${path}`);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message, detail: err.detail }, err.status);
      }
      return json({ error: 'Unexpected error', detail: String(err && err.message) }, 500);
    }
  },
};
