/**
 * Admin API for the Tony D site.
 *
 * This runs inside the site's own Worker: the root wrangler.toml points
 * `main` here and only sends /api/admin/* to this script, so every other
 * request is served straight from the static assets. That is what lets the
 * admin work on a bare *.workers.dev address, where a separate Worker route
 * is impossible.
 *
 * Everyone signs in with their own username (or email) and password, kept
 * in the ACCOUNTS KV namespace, and is answered with a signed, HttpOnly
 * session cookie - see "accounts" below. Everyone signed in can edit and
 * publish. Cloudflare Access would be stronger, but on workers.dev it would
 * lock the public site as well; it can come once the site has a domain.
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
 *   ADMIN_PASSWORD  secret — the owner password: TonyDeng's way in, and what
 *                   removing TonyDeng asks for
 *   ACCOUNTS        KV namespace — sign-ins, settings, the message inbox
 *   BREVO_API_KEY   secret — sends the emails (see "mail")
 *   MAIL_FROM       secret — the address they are sent from
 */

const CONTENT_FILES = ['content/shared.json', 'content/en.json', 'content/zh.json'];

const IMAGE_TYPES = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const AUDIO_TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg' };

// Short clips for In the Making entries. Anything long belongs on Bilibili /
// YouTube as a site video, which an entry can point at instead.
const VIDEO_TYPES = { mp4: 'video/mp4', webm: 'video/webm' };
const UPLOAD_TYPES = { img: IMAGE_TYPES, audio: AUDIO_TYPES, video: VIDEO_TYPES };

// GitHub's blob API takes base64; anything much larger than this belongs in
// R2 rather than in git history.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

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

function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

// ------------------------------------------------------------ accounts

/* One sign-in per person, kept in the ACCOUNTS KV namespace (wrangler.toml).
 *
 *   user:<login, lower case>   { login, email, salt, hash, mustChange, ver, created, owner? }
 *   email:<address>            <login key>, so people can sign in with either
 *   reset:<token>              <login key>, a password link, gone after an hour
 *   fail:<who>                 failed sign-ins, forgotten after 15 minutes
 *
 * TonyDeng is the owner account. Until it has a password of its own it signs
 * in with ADMIN_PASSWORD, and ADMIN_PASSWORD always still works for it - so
 * the long password is the way back in if Tony forgets his own. Deleting
 * TonyDeng takes ADMIN_PASSWORD too, and leaves `{ deleted: true }` behind so
 * the account does not quietly come back.
 *
 * With no ACCOUNTS binding the admin falls back to the old single password,
 * signed in as TonyDeng, so a deploy before the namespace exists still works.
 *
 * `ver` goes up when a password changes and is carried in the session
 * cookie, so a new password signs that person out everywhere else. A
 * deleted account's cookie stops working on its next request. */

const OWNER = 'tonydeng';
const DEFAULT_PASSWORD = '1234567890';
const MIN_PASSWORD = 6;
const PBKDF2_ROUNDS = 100000; // the most Workers allow
const MAX_FAILS = 8;

const userKey = (login) => `user:${String(login).trim().toLowerCase()}`;
const emailKey = (email) => `email:${String(email).trim().toLowerCase()}`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64urlToBytes(salt), iterations: PBKDF2_ROUNDS }, key, 256,
  );
  return bytesToB64url(bits);
}

function randomToken(bytes = 24) {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function withPassword(user, password, mustChange) {
  const salt = randomToken(16);
  return {
    ...user,
    salt,
    hash: await hashPassword(password, salt),
    mustChange,
    ver: (user.ver || 0) + 1,
  };
}

/** The account stored under `key`, the owner before it has a record, or null. */
async function getUser(env, key) {
  const rec = await env.ACCOUNTS.get(key, 'json');
  if (rec === null && key === userKey(OWNER)) {
    return { login: 'TonyDeng', email: '', owner: true, ver: 0, mustChange: false, created: null };
  }
  return rec && !rec.deleted ? rec : null;
}

async function putUser(env, user) {
  await env.ACCOUNTS.put(userKey(user.login), JSON.stringify(user));
}

/** Find an account by username or by email address. */
async function findUser(env, who) {
  who = String(who || '').trim();
  if (!who) return null;
  if (who.includes('@')) {
    const key = await env.ACCOUNTS.get(emailKey(who));
    if (key) return getUser(env, key);
  }
  return getUser(env, userKey(who));
}

async function listUsers(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.ACCOUNTS.list({ prefix: 'user:', cursor });
    for (const { name } of page.keys) {
      const user = await getUser(env, name);
      if (user) out.push(user);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  if (!out.some((u) => u.owner) && (await getUser(env, userKey(OWNER)))) {
    out.unshift(await getUser(env, userKey(OWNER)));
  }
  return out.sort((a, b) => (b.owner ? 1 : 0) - (a.owner ? 1 : 0)
    || String(a.created || '').localeCompare(String(b.created || '')));
}

/** What the browser is told about an account - never the hash. */
function publicUser(user) {
  return {
    login: user.login,
    email: user.email || '',
    owner: !!user.owner,
    mustChange: !!user.mustChange,
    created: user.created || null,
  };
}

async function isOwnerKey(env, text) {
  return sameText(env, String(text || ''), requireSecret(env, 'ADMIN_PASSWORD'));
}

async function checkPassword(env, user, password) {
  if (user.owner && (await isOwnerKey(env, password))) return true;
  if (!user.hash) return false;
  return sameText(env, await hashPassword(String(password || ''), user.salt), user.hash);
}

function checkNewPassword(next) {
  next = String(next || '');
  if (next.length < MIN_PASSWORD) {
    throw new HttpError(400, `Use at least ${MIN_PASSWORD} characters`);
  }
  if (next === DEFAULT_PASSWORD) throw new HttpError(400, 'Choose something other than the starting password');
  return next;
}

/* The name a commit is signed with. The repository is public, so a login
 * that is an email address must not end up in its history whole. */
function commitName(login) {
  return String(login).split('@')[0].replace(/[^A-Za-z0-9._-]/g, '') || 'admin';
}

function sessionUser(user) {
  return {
    email: commitName(user.login),
    login: user.login,
    owner: !!user.owner,
    mustChange: !!user.mustChange,
    canPublish: true,
  };
}

async function handleLogin(request, env) {
  const { login, password } = await request.json().catch(() => ({}));

  let user = null;
  if (env.ACCOUNTS) {
    const who = String(login || '').trim().toLowerCase() || OWNER;
    const failKey = `fail:${who}`;
    const fails = Number(await env.ACCOUNTS.get(failKey)) || 0;
    if (fails >= MAX_FAILS) {
      throw new HttpError(429, 'Too many tries', 'Wait 15 minutes, or use “Forgot password?”.');
    }
    user = await findUser(env, who);
    if (!user || !(await checkPassword(env, user, password))) {
      await env.ACCOUNTS.put(failKey, String(fails + 1), { expirationTtl: 900 });
      user = null;
    } else if (fails) {
      await env.ACCOUNTS.delete(failKey);
    }
  } else if (await isOwnerKey(env, password)) {
    user = { login: 'TonyDeng', owner: true, ver: 0 };
  }

  if (!user) {
    // Slows guessing down a little; the fail count above is the real limit.
    await new Promise((r) => setTimeout(r, 1000));
    throw new HttpError(401, 'Wrong username or password');
  }

  const token = await signSession(env, user);
  const res = json({ ok: true, ...sessionUser(user) });
  res.headers.append('Set-Cookie', sessionCookie(token, SESSION_SECONDS));
  return res;
}

async function signSession(env, user) {
  const payload = bytesToB64url(enc.encode(JSON.stringify({
    u: user.login.toLowerCase(),
    v: user.ver || 0,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })));
  return `${payload}.${bytesToB64url(await hmac(env, payload))}`;
}

function handleLogout() {
  const res = json({ ok: true });
  res.headers.append('Set-Cookie', sessionCookie('', 0));
  return res;
}

/* Someone signed in with the starting password may only choose a new one
 * (and sign out) until they have. */
const BEFORE_NEW_PASSWORD = ['/me', '/password', '/logout'];

async function authenticate(request, env, path) {
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

  if (!env.ACCOUNTS) return sessionUser({ login: 'TonyDeng', owner: true });

  // a cookie from before accounts existed belonged to the one password
  const user = await getUser(env, userKey(data.u || OWNER));
  if (!user || (user.ver || 0) !== (data.v || 0)) {
    throw new HttpError(401, 'Not signed in', 'Your password changed or the account was removed — sign in again.');
  }
  if (user.mustChange && !BEFORE_NEW_PASSWORD.includes(path)) {
    throw new HttpError(403, 'Choose a new password first');
  }
  return sessionUser(user);
}

function needAccounts(env) {
  if (!env.ACCOUNTS) {
    throw new HttpError(501, 'Accounts are not switched on yet',
      'The ACCOUNTS KV namespace is not bound to this Worker — see wrangler.toml.');
  }
}

async function handleMe(env, user) {
  if (!env.ACCOUNTS) return json({ ...publicUser(user), accounts: false, mail: mailReady(env) });
  const rec = await getUser(env, userKey(user.login));
  return json({ ...publicUser(rec), accounts: true, mail: mailReady(env) });
}

async function handleUsers(env) {
  needAccounts(env);
  return json({ users: (await listUsers(env)).map(publicUser), mail: mailReady(env) });
}

async function handleAddUser(request, env, me, origin) {
  needAccounts(env);
  const body = await request.json().catch(() => ({}));
  let login = String(body.login || '').trim();
  let email = String(body.email || '').trim();
  if (!login && EMAIL_RE.test(email)) login = email;
  if (EMAIL_RE.test(login) && !email) email = login;

  if (!/^[A-Za-z0-9._@+-]{2,80}$/.test(login)) {
    throw new HttpError(400, 'Give a username (letters, numbers, . _ -) or an email address');
  }
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'That email address does not look right');
  if (await env.ACCOUNTS.get(userKey(login))) {
    const old = await env.ACCOUNTS.get(userKey(login), 'json');
    if (!old.deleted) throw new HttpError(409, `There is already an account called ${login}`);
  }
  if (login.toLowerCase() === OWNER && (await getUser(env, userKey(OWNER)))) {
    throw new HttpError(409, 'There is already an account called TonyDeng');
  }
  if (email && (await env.ACCOUNTS.get(emailKey(email)))) {
    throw new HttpError(409, `${email} already belongs to an account`);
  }

  const user = await withPassword({
    login,
    email,
    owner: login.toLowerCase() === OWNER,
    created: new Date().toISOString(),
    addedBy: me.login,
    ver: 0,
  }, DEFAULT_PASSWORD, true);
  await putUser(env, user);
  if (email) await env.ACCOUNTS.put(emailKey(email), userKey(login));

  let emailed = false;
  if (email && mailReady(env)) {
    const link = await resetLink(env, user, origin, 7 * 24 * 3600);
    await sendMail(env, {
      to: email,
      subject: 'Your sign-in for the Tony D site admin',
      text: [
        `${me.login} has given you access to the Tony D site admin.`,
        '',
        `Username: ${login}`,
        `Starting password: ${DEFAULT_PASSWORD}`,
        '',
        'You will be asked to choose your own password the first time you sign in.',
        'Or set it now with this link (it works for 7 days):',
        link,
        '',
        `${origin}/admin/`,
      ].join('\n'),
    });
    emailed = true;
  }
  return json({ ok: true, user: publicUser(user), emailed });
}

async function handleDeleteUser(request, env, me) {
  needAccounts(env);
  const { login, ownerKey } = await request.json().catch(() => ({}));
  const user = await getUser(env, userKey(login || ''));
  if (!user) throw new HttpError(404, 'No such account');

  if (user.owner && !(await isOwnerKey(env, ownerKey))) {
    await new Promise((r) => setTimeout(r, 1000));
    throw new HttpError(403, 'That is not the owner password',
      'Removing TonyDeng takes the long ADMIN_PASSWORD, not TonyDeng’s own password.');
  }
  if ((await listUsers(env)).length <= 1) {
    throw new HttpError(400, 'This is the last account', 'Add another one first, or nobody could sign in.');
  }

  if (user.owner) await env.ACCOUNTS.put(userKey(user.login), JSON.stringify({ deleted: true }));
  else await env.ACCOUNTS.delete(userKey(user.login));
  if (user.email) await env.ACCOUNTS.delete(emailKey(user.email));

  return json({ ok: true, self: user.login.toLowerCase() === me.login.toLowerCase() });
}

/* Put someone back on the starting password - for an account with no email
 * to send a link to. Not the owner: that one has ADMIN_PASSWORD instead. */
async function handleResetUser(request, env) {
  needAccounts(env);
  const { login } = await request.json().catch(() => ({}));
  const user = await getUser(env, userKey(login || ''));
  if (!user) throw new HttpError(404, 'No such account');
  if (user.owner) throw new HttpError(400, 'TonyDeng can always sign in with the owner password');
  await putUser(env, await withPassword(user, DEFAULT_PASSWORD, true));
  return json({ ok: true });
}

async function handleSetEmail(request, env, me) {
  needAccounts(env);
  const { email: raw } = await request.json().catch(() => ({}));
  const email = String(raw || '').trim();
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'That email address does not look right');

  const user = await getUser(env, userKey(me.login));
  if (email && email.toLowerCase() !== (user.email || '').toLowerCase()) {
    const taken = await env.ACCOUNTS.get(emailKey(email));
    if (taken && taken !== userKey(user.login)) throw new HttpError(409, `${email} already belongs to an account`);
  }
  if (user.email) await env.ACCOUNTS.delete(emailKey(user.email));
  if (email) await env.ACCOUNTS.put(emailKey(email), userKey(user.login));
  await putUser(env, { ...user, email });
  return json({ ok: true, email });
}

async function handlePassword(request, env, me) {
  needAccounts(env);
  const { current, next } = await request.json().catch(() => ({}));
  const user = await getUser(env, userKey(me.login));
  if (!(await checkPassword(env, user, current))) {
    await new Promise((r) => setTimeout(r, 1000));
    throw new HttpError(403, 'Your current password is not right');
  }
  const updated = await withPassword(user, checkNewPassword(next), false);
  await putUser(env, updated);

  // this browser stays signed in; every other one is signed out
  const res = json({ ok: true });
  res.headers.append('Set-Cookie', sessionCookie(await signSession(env, updated), SESSION_SECONDS));
  return res;
}

async function resetLink(env, user, origin, ttl = 3600) {
  const token = randomToken();
  await env.ACCOUNTS.put(`reset:${token}`, userKey(user.login), { expirationTtl: ttl });
  return `${origin}/admin/#reset=${token}`;
}

/* "Forgot password?". The answer is the same whether or not the account
 * exists, so the form cannot be used to find out who has one. */
async function handleForgot(request, env, origin) {
  needAccounts(env);
  const { who } = await request.json().catch(() => ({}));
  const user = await findUser(env, who);
  if (user && user.email && mailReady(env)) {
    await sendMail(env, {
      to: user.email,
      subject: 'Reset your Tony D site admin password',
      text: [
        `Someone asked to reset the password for ${user.login}.`,
        '',
        'Choose a new one here (the link works for one hour):',
        await resetLink(env, user, origin),
        '',
        'If it was not you, ignore this email - nothing has changed.',
      ].join('\n'),
    });
  }
  return json({ ok: true, mail: mailReady(env) });
}

async function handleReset(request, env) {
  needAccounts(env);
  const { token, next } = await request.json().catch(() => ({}));
  const key = token && (await env.ACCOUNTS.get(`reset:${token}`));
  const user = key && (await getUser(env, key));
  if (!user) throw new HttpError(400, 'That link has expired', 'Ask for a new one with “Forgot password?”.');
  const updated = await withPassword(user, checkNewPassword(next), false);
  await putUser(env, updated);
  await env.ACCOUNTS.delete(`reset:${token}`);
  await env.ACCOUNTS.delete(`fail:${user.login.toLowerCase()}`);

  const res = json({ ok: true, login: user.login });
  res.headers.append('Set-Cookie', sessionCookie(await signSession(env, updated), SESSION_SECONDS));
  return res;
}

// ------------------------------------------------------------ mail

/* Mail goes out through Brevo's API (brevo.com, free for 300 a day). It is
 * used because it can send to anyone from a single verified address; the
 * others want a domain of our own, which the site does not have yet.
 *
 *   BREVO_API_KEY   secret - Brevo → SMTP & API → API keys
 *   MAIL_FROM       secret - the sender address verified in Brevo
 *
 * Both are secrets rather than [vars] only because the repository is public
 * and MAIL_FROM is a real person's address. */
function mailReady(env) {
  return !!(env.BREVO_API_KEY && env.MAIL_FROM);
}

async function sendMail(env, { to, subject, text, replyTo, fromName = 'Tony D site' }) {
  if (!mailReady(env)) throw new HttpError(503, 'Email is not set up', 'BREVO_API_KEY and MAIL_FROM secrets.');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: env.MAIL_FROM, name: fromName },
      to: [{ email: to }],
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      subject,
      textContent: text,
    }),
  });
  if (!res.ok) {
    throw new HttpError(502, 'The email did not send', `Brevo said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
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
    // a null sha in a tree entry is how git's tree API says "remove this"
    if (file.remove) {
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
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

  // `parent` is what this went on top of. An upload does not check that the
  // admin's copy is current, and if the admin then took the new commit as
  // its own it would think it was up to date - and its next Save would write
  // an old copy of the content over whatever someone else had saved in
  // between. The admin moves forward only when `parent` is what it had.
  return { sha: commit.sha, parent: head };
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

  const { sha, parent } = await commitFiles(env, {
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

  if (typeof path !== 'string' || !/^(img|audio|video)\/[A-Za-z0-9._/-]+$/.test(path) || path.includes('..')) {
    throw new HttpError(400, 'Uploads must go to img/, audio/ or video/ with a simple filename');
  }

  const ext = path.split('.').pop().toLowerCase();
  const allowed = UPLOAD_TYPES[path.split('/')[0]];
  if (!allowed[ext]) {
    throw new HttpError(400, `${ext} is not an allowed file type for ${path.split('/')[0]}/`);
  }

  const size = Math.floor((contentBase64.length * 3) / 4);
  const limit = path.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES;
  if (size > limit) {
    throw new HttpError(413, `File is ${(size / 1e6).toFixed(1)}MB — the limit is ${Math.round(limit / 1e6)}MB`);
  }

  // Never overwrite: a second "photo.webp" is saved as "photo-2.webp".
  // Overwriting used to happen silently (client issue 12), and since the
  // admin shows pictures from the live site, nobody could see it had.
  const free = await freePath(env, path);

  const { sha, parent } = await commitFiles(env, {
    branch: env.DRAFT_BRANCH,
    files: [{ path: free, content: contentBase64, encoding: 'base64' }],
    message: `Upload ${free}\n\nUploaded by ${user.email} via /admin`,
    author: user.email,
  });

  return json({ ok: true, commit: sha, parent, path: free, renamed: free !== path });
}

async function exists(env, path) {
  const res = await fetch(
    `https://api.github.com${repo(env)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${env.DRAFT_BRANCH}`,
    { method: 'HEAD', headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'tony-site-admin',
      Accept: 'application/vnd.github+json' } },
  );
  return res.ok;
}

async function freePath(env, path) {
  if (!(await exists(env, path))) return path;
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const base = path.slice(0, dot > slash ? dot : path.length);
  const ext = dot > slash ? path.slice(dot) : '';
  for (let n = 2; n < 100; n++) {
    const next = `${base}-${n}${ext}`;
    if (!(await exists(env, next))) return next;
  }
  throw new HttpError(409, 'Too many files with that name - rename the file and try again');
}

// ------------------------------------------------------------ files

/* Everything under img/, audio/ and video/ on the draft branch, with sizes,
 * so the admin can show what is no longer used and offer to delete it
 * (client issue 13). Deciding what is "used" is the admin's job - it has the
 * content in hand, including edits not yet saved. */
async function handleFiles(env) {
  const head = await ensureDraft(env);
  const commit = await gh(env, `${repo(env)}/git/commits/${head}`);
  const tree = await gh(env, `${repo(env)}/git/trees/${commit.tree.sha}?recursive=1`);
  const files = (tree ? tree.tree : [])
    .filter((e) => e.type === 'blob' && /^(img|audio|video)\//.test(e.path))
    .map((e) => ({ path: e.path, size: e.size }));
  return json({ files, truncated: !!(tree && tree.truncated) });
}

async function handleDelete(request, env, user) {
  const { paths } = await request.json();
  if (!Array.isArray(paths) || !paths.length || paths.length > 200) {
    throw new HttpError(400, 'Nothing to delete');
  }
  for (const p of paths) {
    if (typeof p !== 'string' || !/^(img|audio|video)\/[A-Za-z0-9._/-]+$/.test(p) || p.includes('..')) {
      throw new HttpError(400, `Refusing to delete ${p}`);
    }
  }
  const { sha, parent } = await commitFiles(env, {
    branch: env.DRAFT_BRANCH,
    files: paths.map((path) => ({ path, remove: true })),
    message: `Delete ${paths.length} unused file${paths.length === 1 ? '' : 's'}\n\n`
      + paths.join('\n') + `\n\nDeleted by ${user.email} via /admin`,
    author: user.email,
  });
  return json({ ok: true, commit: sha, parent, deleted: paths.length });
}

/* A video's poster, fetched from YouTube and committed next to the others.
 *
 * Posters are kept in the repository because i.ytimg.com is blocked in
 * mainland China, so the page cannot hot-link them - but nothing stops this
 * Worker, which runs outside China, from fetching one once and storing it.
 * That turns "find the thumbnail, save it, convert it, upload it" into one
 * button. maxresdefault is not made for every video; YouTube answers 404
 * for those, and the next size down is tried. */
async function handlePoster(request, env, user) {
  const { yt } = await request.json();
  if (typeof yt !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(yt)) {
    throw new HttpError(400, 'That is not a YouTube video ID');
  }
  const tries = [
    [`https://i.ytimg.com/vi_webp/${yt}/maxresdefault.webp`, 'webp'],
    [`https://i.ytimg.com/vi/${yt}/maxresdefault.jpg`, 'jpg'],
    [`https://i.ytimg.com/vi_webp/${yt}/hqdefault.webp`, 'webp'],
    [`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, 'jpg'],
  ];
  for (const [url, ext] of tries) {
    const res = await fetch(url);
    if (!res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    const path = `img/video/${yt}.${ext}`;
    const { sha, parent } = await commitFiles(env, {
      branch: env.DRAFT_BRANCH,
      files: [{ path, content: btoa(bin), encoding: 'base64' }],
      message: `Poster for ${yt} from YouTube

Fetched by ${user.email} via /admin`,
      author: user.email,
    });
    return json({ ok: true, commit: sha, parent, path });
  }
  throw new HttpError(404, 'YouTube has no thumbnail for that ID', 'Check the ID, or upload a poster by hand.');
}

/* One media file straight from the draft branch.

   The admin shows pictures by their site path, and the site only has a file
   once a Publish has been built and deployed - so a picture uploaded a
   minute ago was a broken image in every card and in the preview until
   then. When a picture fails to load, the admin asks here instead, and gets
   the bytes the upload committed. Media folders only; nothing else in the
   repository is readable through this. */
const RAW_TYPES = {
  webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
};

async function handleRaw(url, env) {
  const path = url.searchParams.get('path') || '';
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (!/^(img|audio|video)\/[^?#]+$/.test(path) || path.split('/').includes('..') || !RAW_TYPES[ext]) {
    throw new HttpError(400, 'Not a media path');
  }
  const res = await fetch(
    `https://api.github.com${repo(env)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${env.DRAFT_BRANCH}`,
    { headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.raw',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tony-site-admin',
    } },
  );
  if (res.status === 404) throw new HttpError(404, `${path} is not on the draft branch`);
  if (!res.ok) throw new HttpError(502, `GitHub ${res.status} reading ${path}`);
  return new Response(res.body, {
    headers: {
      'Content-Type': RAW_TYPES[ext],
      // an svg is still markup; never let it run as a page of its own
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    },
  });
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

// ------------------------------------------------------------ messages

/* "Message Tony" (js/main.js MessageDialog posts here, /api/message).
 *
 * Each message is emailed to the address set in the admin (settings, below)
 * with the sender as Reply-To, so pressing Reply in that mailbox answers the
 * sender directly. The sender gets a copy when they left an email address.
 *
 * Email cannot do anything with a phone number, and a reply typed in the
 * mailbox never comes back through here - there is no domain to receive
 * mail on. So every message is also kept in the admin's inbox, where a reply
 * to an email address is sent from here and a reply to a phone number opens
 * the replier's own phone to text it. Kept for a year:
 *
 *   msg:<newest first>-<random>   { id, at, name, replyTo, kind, message, lang, page, replies }
 *   settings                      { messageTo }
 *   rate:<ip>                     messages from one address this hour */

const MESSAGE_TTL = 365 * 24 * 3600;
// generous: in China many people can share one address
const MESSAGES_PER_HOUR = 10;

async function getSettings(env) {
  return (env.ACCOUNTS && (await env.ACCOUNTS.get('settings', 'json'))) || {};
}

async function handleGetSettings(env) {
  return json({ ...(await getSettings(env)), mail: mailReady(env), accounts: !!env.ACCOUNTS });
}

async function handlePutSettings(request, env) {
  needAccounts(env);
  const { messageTo: raw } = await request.json().catch(() => ({}));
  const messageTo = String(raw || '').trim();
  if (messageTo && !EMAIL_RE.test(messageTo)) throw new HttpError(400, 'That email address does not look right');
  const settings = { ...(await getSettings(env)), messageTo };
  await env.ACCOUNTS.put('settings', JSON.stringify(settings));
  return json({ ok: true, ...settings });
}

function contactKind(replyTo) {
  if (EMAIL_RE.test(replyTo)) return 'email';
  if (/^\+?[\d\s().-]+$/.test(replyTo) && replyTo.replace(/\D/g, '').length >= 6) return 'phone';
  return null;
}

async function handleMessage(request, env, url) {
  const body = await request.json().catch(() => ({}));
  // the hidden field: a person never fills it in, so pretend it worked
  if (body.website) return json({ ok: true });

  const message = String(body.message || '').trim().slice(0, 2000);
  const replyTo = String(body.replyTo || '').trim().slice(0, 120);
  const name = String(body.name || '').trim().slice(0, 80);
  const kind = contactKind(replyTo);
  if (!message) throw new HttpError(400, 'Write a message first');
  if (!kind) throw new HttpError(400, 'Enter an email address or a phone number');

  const settings = await getSettings(env);
  const emailTo = mailReady(env) && settings.messageTo;
  // nowhere for it to go: say so, so the page shows its error line and the
  // sender uses the email address it gives instead of trusting a "Sent"
  if (!env.ACCOUNTS && !emailTo) throw new HttpError(503, 'Messages are not set up');

  if (env.ACCOUNTS) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const sent = Number(await env.ACCOUNTS.get(`rate:${ip}`)) || 0;
    if (sent >= MESSAGES_PER_HOUR) throw new HttpError(429, 'Too many messages - try again later');
    await env.ACCOUNTS.put(`rate:${ip}`, String(sent + 1), { expirationTtl: 3600 });
  }

  const at = new Date().toISOString();
  const id = `${String(1e13 - Date.now()).padStart(13, '0')}-${randomToken(4)}`;
  const record = {
    id, at, name, replyTo, kind, message,
    lang: String(body.lang || '').slice(0, 10),
    page: String(body.page || '').slice(0, 200),
    replies: [],
  };
  if (env.ACCOUNTS) await env.ACCOUNTS.put(`msg:${id}`, JSON.stringify(record), { expirationTtl: MESSAGE_TTL });

  const who = name ? `${name} (${replyTo})` : replyTo;
  if (emailTo) {
    // kept in the inbox already, so a mail failure is not the sender's problem
    const send = env.ACCOUNTS ? (m) => sendMail(env, m).catch(() => {}) : (m) => sendMail(env, m);
    await send({
      to: emailTo,
      replyTo: kind === 'email' ? replyTo : undefined,
      fromName: name || 'Tony D site',
      subject: `Message from ${who} - Tony D site`,
      text: [
        message,
        '',
        '---',
        `From: ${who}`,
        `Sent: ${at} from ${record.page || 'the site'}`,
        '',
        kind === 'email'
          ? 'Press Reply to answer - it goes straight to them.'
          : `They left a phone number, not an email. Text or call ${replyTo}, or reply from the admin inbox:`,
        `${url.origin}/admin/#inbox`,
      ].join('\n'),
    });
  }
  // their copy; best effort - the message itself has already arrived
  if (kind === 'email' && mailReady(env)) {
    try {
      await sendMail(env, {
        to: replyTo,
        replyTo: settings.messageTo || undefined,
        subject: 'Your message to Tony D',
        text: [
          record.lang.startsWith('zh') ? '你的留言已送达，回复会发到这个邮箱。' : 'Your message has been sent. Any reply will come to this address.',
          '',
          message,
        ].join('\n'),
      });
    } catch { /* the message went; only the copy did not */ }
  }
  return json({ ok: true, kind });
}

async function handleMessages(env) {
  needAccounts(env);
  const page = await env.ACCOUNTS.list({ prefix: 'msg:', limit: 100 });
  const messages = (await Promise.all(page.keys.map(({ name }) => env.ACCOUNTS.get(name, 'json')))).filter(Boolean);
  return json({ messages, more: !page.list_complete, mail: mailReady(env) });
}

async function getMessage(env, id) {
  if (!/^[0-9]{13}-[A-Za-z0-9_-]+$/.test(String(id || ''))) throw new HttpError(400, 'Bad message id');
  const record = await env.ACCOUNTS.get(`msg:${id}`, 'json');
  if (!record) throw new HttpError(404, 'That message is gone');
  return record;
}

/* A reply from the inbox. To an email address it is sent from here; to a
 * phone number it is only noted down, and the page opens the replier's own
 * messaging app with the words filled in. */
async function handleReply(request, env, me) {
  needAccounts(env);
  const { id, text: raw } = await request.json().catch(() => ({}));
  const record = await getMessage(env, id);
  const text = String(raw || '').trim().slice(0, 4000);
  if (!text) throw new HttpError(400, 'Write a reply first');

  if (record.kind === 'email') {
    const settings = await getSettings(env);
    await sendMail(env, {
      to: record.replyTo,
      replyTo: settings.messageTo || undefined,
      fromName: 'Tony D',
      subject: 'Re: your message to Tony D',
      text: [text, '', '---', `${record.name || record.replyTo} wrote:`, ...record.message.split('\n').map((l) => `> ${l}`)].join('\n'),
    });
  }
  record.replies.push({ at: new Date().toISOString(), by: me.login, text, via: record.kind === 'email' ? 'email' : 'text' });
  await env.ACCOUNTS.put(`msg:${record.id}`, JSON.stringify(record), { expirationTtl: MESSAGE_TTL });
  return json({ ok: true, message: record });
}

async function handleDeleteMessage(request, env) {
  needAccounts(env);
  const { id } = await request.json().catch(() => ({}));
  await getMessage(env, id);
  await env.ACCOUNTS.delete(`msg:${id}`);
  return json({ ok: true });
}

// ------------------------------------------------------------ router

// ------------------------------------------------------------ media

/* Audio and video with byte ranges. The static assets answer a Range
   request with the whole file and a 200, and a browser that gets that
   cannot seek: pressing halfway along a clip's bar played on from the
   start. So /audio/* and /video/* come through here (wrangler.toml,
   run_worker_first) and a Range is answered with a 206 and just those
   bytes. The files are a few MB, so slicing the asset is fine. */
async function serveMedia(request, env) {
  const res = await env.ASSETS.fetch(request);
  const range = request.headers.get('Range');
  // a 206 means the assets did it themselves; anything else not ours to cut
  if (!res.ok || res.status === 206 || request.method !== 'GET') return res;
  const headers = new Headers(res.headers);
  headers.set('Accept-Ranges', 'bytes');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return new Response(res.body, { status: res.status, headers });

  const body = await res.arrayBuffer();
  const size = body.byteLength;
  let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] === '' || m[2] === '' ? size - 1 : Number(m[2]);
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}

/* A countdown's picture (build.py: render_countdown, build_dist). Only
   /reveal/<ring id>, and only once that ring's moment has passed on this
   clock; before then - and for any other path under /reveal/, the
   manifest and the files' own names included - there is nothing here. */
async function serveReveal(request, env, url) {
  const nothing = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const id = url.pathname.slice('/reveal/'.length);
  if (!/^[a-z0-9-]+$/.test(id)) return nothing();
  const list = await env.ASSETS.fetch(new Request(new URL('/reveal/manifest.json', url.origin)));
  if (!list.ok) return nothing();
  const entry = (await list.json())[id];
  if (!entry || !(Date.now() >= Date.parse(entry.at))) return nothing();
  const file = await env.ASSETS.fetch(new Request(new URL(`/reveal/${entry.file}`, url.origin)));
  if (!file.ok) return nothing();
  const headers = new Headers(file.headers);
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(file.body, { status: 200, headers });
}

/* The public message route, with the admin's error handling but none of its
 * sign-in. Same-origin only: the form is on this site and nowhere else. */
async function routeMessage(request, env, url) {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'POST only');
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-site request refused');
    return await handleMessage(request, env, url);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, detail: err.detail }, err.status);
    return json({ error: 'Unexpected error', detail: String(err && err.message) }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/reveal/')) return serveReveal(request, env, url);
    if (/^\/(audio|video)\//.test(url.pathname)) return serveMedia(request, env);
    if (url.pathname === '/api/message') return routeMessage(request, env, url);
    // wrangler.toml only runs this script for the paths above and
    // /api/admin/*, but if that pattern ever widens the site must still be
    // served.
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
      if (request.method === 'POST' && path === '/forgot') return await handleForgot(request, env, url.origin);
      if (request.method === 'POST' && path === '/reset') return await handleReset(request, env);

      const user = await authenticate(request, env, path);

      if (request.method === 'GET' && path === '/me') return await handleMe(env, user);
      if (request.method === 'POST' && path === '/password') return await handlePassword(request, env, user);
      if (request.method === 'POST' && path === '/me/email') return await handleSetEmail(request, env, user);
      if (request.method === 'GET' && path === '/users') return await handleUsers(env);
      if (request.method === 'POST' && path === '/users') return await handleAddUser(request, env, user, url.origin);
      if (request.method === 'POST' && path === '/users/delete') return await handleDeleteUser(request, env, user);
      if (request.method === 'POST' && path === '/users/reset') return await handleResetUser(request, env);
      if (request.method === 'GET' && path === '/settings') return await handleGetSettings(env);
      if (request.method === 'PUT' && path === '/settings') return await handlePutSettings(request, env);
      if (request.method === 'GET' && path === '/messages') return await handleMessages(env);
      if (request.method === 'POST' && path === '/messages/reply') return await handleReply(request, env, user);
      if (request.method === 'POST' && path === '/messages/delete') return await handleDeleteMessage(request, env);

      // `return await`, not `return`: a bare returned promise would reject
      // outside this try, and the error would reach the browser as a bare 500.
      if (request.method === 'GET' && path === '/status') return await handleStatus(env, user);
      if (request.method === 'GET' && path === '/content') return await handleContent(env);
      if (request.method === 'PUT' && path === '/content') return await handleSave(request, env, user);
      if (request.method === 'POST' && path === '/upload') return await handleUpload(request, env, user);
      if (request.method === 'POST' && path === '/publish') return await handlePublish(env, user);
      if (request.method === 'POST' && path === '/poster') return await handlePoster(request, env, user);
      if (request.method === 'GET' && path === '/files') return await handleFiles(env);
      if (request.method === 'GET' && path === '/raw') return await handleRaw(url, env);
      if (request.method === 'POST' && path === '/delete') return await handleDelete(request, env, user);

      throw new HttpError(404, `No admin route for ${request.method} ${path}`);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message, detail: err.detail }, err.status);
      }
      return json({ error: 'Unexpected error', detail: String(err && err.message) }, 500);
    }
  },
};
