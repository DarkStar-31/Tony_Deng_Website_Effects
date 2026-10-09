# Setting up the admin

The admin at `/admin/` lets anyone with the password edit every word, image
and video on the site from a browser. They don't need a GitHub account or git.
This guide covers the one-time setup and then the full edit, save and publish
flow you use to check that it works.

**How it fits together.** The site is a Cloudflare **Worker** with static
assets. It is *not* Cloudflare Pages. The Worker serves the built pages, and
for `/api/admin/*` only, it also runs the admin script in
`workers/admin/src/index.js`. That script holds a GitHub token and commits
your edits to the repository for you:

```
/admin  ──Save draft──▶  commit to the `draft` branch
        ──Publish─────▶  merge `draft` into `main`
                          └─▶ Cloudflare sees the push, runs build.py, deploys
                               └─▶ public site updated (1–3 minutes)
```

So three things have to be true for a change to reach the public page:
the Worker must have its **two secrets**, Cloudflare must be **connected to
the GitHub repository** so a push to `main` rebuilds it, and the Worker name
in `wrangler.toml` must be the Worker you are looking at.

| Copy | Repository | Worker / address |
|---|---|---|
| Live | `DarkStar-31/Tony_Deng_Website` | `tony-deng-website` → `tony-deng-website.jochen9999.workers.dev` |
| Effects | `DarkStar-31/Tony_Deng_Website_Effects` | `tony-deng-website-effects` → `tony-deng-website-effects.jochen9999.workers.dev` |

---

## 1. Connect the Worker to GitHub (automatic builds)

Cloudflare dashboard → **Workers & Pages** → the Worker → **Settings** →
**Build**:

1. **Git repository** → **Connect** → pick the repository from the table
   above. If GitHub asks, allow the Cloudflare app access to that repository.
2. **Build configuration**
   - Build command: `python3 build.py --dist`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/` (leave empty)
3. **Branch control** → production branch: `main`. Turn *off* builds for
   other branches. Otherwise every Save draft (which pushes to `draft`)
   triggers a build too.
4. Save, then **Deployments** → **Create deployment** (or push any commit)
   and wait for the build to show **Success**.

Check: open the workers.dev address. The site loads. Open `/admin/`. The
sign-in box appears.

> `npx wrangler deploy` deploys to the Worker named on the `name =` line of
> `wrangler.toml`. That line is the only thing that keeps the effects copy off
> the live site. If you connect a repository to a Worker with a different
> name, the build will deploy somewhere you did not expect.

## 2. Make a GitHub token

github.com → your picture → **Settings** → **Developer settings** →
**Personal access tokens** → **Fine-grained tokens** → **Generate new token**.

- **Token name**: e.g. `tony-site-admin (live)`
- **Expiration**: as long as you are comfortable with (up to a year). Put
  the date in your calendar. **When the token expires, saving stops
  working**, and the admin shows `GitHub 401` (see Troubleshooting).
- **Repository access**: *Only select repositories* → just the one
  repository for this Worker.
- **Permissions** → Repository permissions → **Contents: Read and write**.
  (Metadata: Read-only is added automatically.) Nothing else.

Generate it and copy it straight away, because GitHub shows it only once.

## 3. Add the two secrets to the Worker

The Worker must have been deployed once (step 1) before the dashboard
accepts secrets.

Cloudflare dashboard → **Workers & Pages** → the Worker → **Settings** →
**Variables and Secrets** → **Add**. Add each of these with type **Secret**
(not Text):

| Name | Value |
|---|---|
| `GITHUB_TOKEN` | the token from step 2 |
| `ADMIN_PASSWORD` | the shared admin password. Make it long. |

Click **Deploy** when it asks. Secrets survive later deploys, so this is
once only. Never write the password into a file. Both repositories are
public.

Changing `ADMIN_PASSWORD` later signs everyone out.

## 4. Check the full flow

Do this once after setup, and again whenever something seems wrong.

1. Open `https://<worker address>/admin/` and sign in with the password.
2. The bar at the top should say **signed in · live site is up to date**.
   If it says *Not connected* or shows a red message, go to Troubleshooting.
3. Pick something easy to spot, e.g. **Tony D** tab → a line of hero text.
   Click into the box and change a word. The bar shows **unsaved changes**,
   and **Save draft first** appears beside Publish.
4. Optionally type a note in *What changed?*, then press **Save draft**
   (or Ctrl+S / ⌘S). A green "Saved to the draft branch" message appears,
   and the bar shows **1 change waiting to publish**.
5. Press **Publish** → OK. A green "Published" message appears.
6. Cloudflare dashboard → the Worker → **Deployments**. A new build starts
   within a few seconds. Wait for **Success** (usually 1–3 minutes).
7. Open the public page in a new tab (or hard-refresh with Ctrl+F5) and see
   the change.

To undo the test, change the word back and repeat steps 4–5.

### Why Publish is sometimes grey

Publish sends what is **saved** on the draft branch. It does not send what is
in the form. So it waits until:

- there are no unsaved edits (the hint says **Save draft first**), and
- there is at least one saved change that is not live yet (the hint says
  **Nothing new to publish**).

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| Clicking a text box does nothing / typing goes nowhere | Fixed in October 2026. Each rich text field was wrapped in a `<label>`, so a click moved focus to its **B** button. If you still see it, the Worker is serving an old build. Check Deployments. |
| `Wrong password` | Wrong password, or `ADMIN_PASSWORD` is not set on *this* Worker. |
| `The ADMIN_PASSWORD secret is not set` (or GITHUB_TOKEN) | Step 3 was skipped, or done on the other Worker. |
| `GitHub 401 on …` | The token expired or was revoked. Make a new one (step 2) and replace the `GITHUB_TOKEN` secret (step 3). |
| `GitHub 403 on …` or `GitHub 404`-style "not found" | The token cannot see this repository, or lacks *Contents: Read and write*. Edit the token's repository access and permissions. |
| `Someone else saved while you were editing` | Someone else saved first (or another tab did). Press **Reload**, make your change again, and save. Nothing they saved is lost. |
| `Merge conflict between draft and live` | Someone changed `main` directly in a way that conflicts. This needs someone with git. |
| Published, but the public page has not changed | The build did not start or it failed. Open Deployments, then **Retry** a failed build. If no build appeared, step 1 (Git connection, production branch `main`) is not set up. Then hard-refresh the page. |
| `Not signed in` after a while | The session lasts 7 days, or ends sooner if the password was changed. Sign in again. Unsaved edits stay on the page if you sign in from a **new tab**. |

## Trying it without deploying anything

```
python tools/devserver.py
```

This serves the site and a local stand-in for the admin API at
<http://localhost:5502/admin/>. It writes straight to `content/*.json` on disk
and rebuilds after each save. There is **no password**, so use it on
localhost only.

## What the admin cannot do

These are left out on purpose, because each needs someone with git:

- Changing the page structure, such as section order, new sections or layout
- Editing CSS or JavaScript
- Deleting images from the repository (uploading a replacement is enough;
  old files just sit there)
- Resolving a merge conflict between `draft` and `main`

## Later: a domain and Cloudflare Access

One shared password is the weak point: anyone who finds `/admin/` can try to
guess it, and anyone who has it can publish. Once the site has its own
domain, the planned upgrade is per-person sign-in through Cloudflare Access,
with publishing limited to named people. The earlier version of this file
(in git history, before October 2026) has those steps.
