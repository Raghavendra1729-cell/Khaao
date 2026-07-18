# Khaao — Production Deployment Runbook

> **Status of this document:** this is a step-by-step guide for a human with
> real infrastructure access (a domain, a server/VM, and account access to
> Firebase/Cloudinary) to follow. No agent has provisioned anything described
> below — see `STATUS.md` § 9 "What's LEFT → Deployment" (D-1 through D-7) for
> the source checklist this expands on. Cross-reference `backend/.env.example`
> and `frontend/.env.example` for the authoritative, current list of env vars
> — if this doc and those files ever disagree, the `.env.example` files win.

Target architecture (see `STATUS.md` § Topology decision for the full
rationale): **one** Go backend instance, one managed Postgres, Caddy as the
TLS-terminating reverse proxy, frontend served as a static bundle. Do not
scale the backend to multiple replicas without first solving distributed
locking + distributed SSE — this app is deliberately architected for one
instance at this scale (~2000 students).

---

## 1. Provision managed Postgres

Pick one (all three offer a free/cheap tier suitable for this scale and hand
you a ready-made `DATABASE_URL` connection string):

- **Supabase** — supabase.com → New project → Project Settings → Database →
  "Connection string" (URI tab).
- **Neon** — neon.tech → New project → the dashboard shows the connection
  string immediately.
- **Railway** — railway.app → New Project → Add PostgreSQL → Variables tab →
  `DATABASE_URL`.

Steps:

1. Create the database/project.
2. **Confirm the `citext` extension is available.** Khaao uses `citext` for
   case-insensitive email columns (`users.email`, `shopkeeper_emails.email`
   — see `backend/internal/database/database.go`, which runs
   `CREATE EXTENSION IF NOT EXISTS citext` as part of `Open()`). All three
   providers above support it on Postgres 15+, but confirm before relying on
   it — some restrictive managed-Postgres tiers block `CREATE EXTENSION` for
   non-superusers. If it's blocked, you'll see the error at first boot; ask
   the provider's support/docs how to enable `citext` for your plan.
3. Copy the connection string into `DATABASE_URL` (used in `/etc/khaao/backend.env`,
   see § 4). It must end with `?sslmode=require` for a hosted provider (not
   `disable` — that's only for local dev against a Postgres with no TLS).
4. **Set up daily backups.** All three providers above have this as a
   dashboard toggle (Supabase: Database → Backups; Neon: point-in-time
   restore is on by default on paid plans, confirm your tier; Railway:
   Postgres plugin → Backups tab). Turn it on now, not after an incident.
5. **Test a restore once, before go-live.** Not a drill you want to discover
   is broken during a real outage. Trigger a manual restore-to-a-new-database
   flow (every provider above supports this from the dashboard) and confirm
   you can connect to the restored copy and see real rows.

There are no versioned SQL migrations yet (`AutoMigrate` runs at every boot —
see `STATUS.md` § 9, item WP4, P0). This means: don't run two backend
instances against the same DB pointed at different code versions during a
deploy, and don't roll back the binary without checking whether the schema
`AutoMigrate` already changed is still compatible with the older code.

---

## 2. Firebase project setup

Backend needs `FIREBASE_PROJECT_ID`; frontend needs `VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
— all sourced from the **same** Firebase project (see
`backend/.env.example` and `frontend/.env.example` for the exact
step-by-step console navigation to find each value; summarized here):

1. console.firebase.google.com → create or open the project → note the
   **Project ID** (Project settings → General, first field) →
   `FIREBASE_PROJECT_ID` / `VITE_FIREBASE_PROJECT_ID`.
2. Authentication → Sign-in method → enable **Google** as a provider. Without
   this, sign-in fails even with a correct project ID.
3. Project settings → General → "Your apps" → add a Web app (skip Firebase
   Hosting and Analytics, neither is used) → copy `apiKey`, `authDomain`,
   `appId` into the matching `VITE_FIREBASE_*` vars.
4. **The #1 launch gotcha: Authentication → Settings → "Authorized
   domains."** Add the real production domain (the same one in the Caddyfile,
   e.g. `khaao.example.com`) here **before** go-live. Google sign-in **fails
   silently** on an unlisted domain — no error dialog, the popup just closes
   or hangs, and it's easy to burn an hour assuming the bug is somewhere in
   application code when it's actually this one checkbox. `localhost` is
   allowed by default, which is why this never surfaces in local dev.
5. This is unrelated to (and in addition to) `ALLOWED_EMAIL_DOMAIN` in
   `backend/.env.example`, which restricts which **student email addresses**
   may register (server-side check in `internal/services/auth.go`), not
   which **websites** may host the sign-in popup. You need both configured
   correctly.

---

## 3. Cloudinary account check — REQUIRES DASHBOARD LOGIN, cannot be done by an agent

This step **cannot be verified or fixed by an AI agent** — it requires the
account owner to personally log into cloudinary.com and look at a dashboard
setting. Flagging prominently because it is a known open issue
(`STATUS.md` § 9, item D-3):

1. Log into console.cloudinary.com with the account that owns (or will own)
   the credentials going into `CLOUDINARY_CLOUD_NAME` / `_API_KEY` /
   `_API_SECRET`.
2. **Confirm the account is on the "Programmable Media" product, not "Media
   Optimizer."** Cloudinary has restructured their product lineup, and
   accounts provisioned under "Media Optimizer" **block the signed classic
   upload API** this integration uses (`backend/internal/controllers/cloudinary.go`
   signs a direct-to-Cloudinary upload so image bytes never touch the Gin
   server) with an HTTP 403 and the error body
   `"missing permissions (actions=[create])"`. There is no code-side fix for
   this — it's a product/plan setting on Cloudinary's side.
3. If you're not sure which product an existing account is on: check the
   dashboard's left nav / product switcher, or contact Cloudinary support and
   ask directly. If it's on Media Optimizer, you likely need a new
   account/environment provisioned under Programmable Media instead.
4. Once confirmed, get all three values from Dashboard → "Product
   Environment Credentials" card (Cloud name / API Key / API Secret — click
   to reveal the secret). Put them in `/etc/khaao/backend.env` (§ 4).
   **Never regenerate these once real menu photos exist** — regenerating
   the API secret doesn't delete existing images, but any signed-upload flow
   in flight with the old secret will fail; rotate deliberately, not
   casually.

Do this check **before** § 4-6 below, or you'll deploy a working app whose
"upload menu photo" button 403s the first time a shopkeeper tries it.

---

## 4. Build and deploy the backend

On the server (assumes a systemd-based Linux distro — Ubuntu/Debian
instructions shown, adapt package manager as needed):

```bash
# One-time: unprivileged service account + directories
sudo useradd --system --no-create-home --shell /usr/sbin/nologin khaao
sudo mkdir -p /opt/khaao/bin /etc/khaao
sudo chown root:root /etc/khaao        # env file stays root-owned, see below

# One-time: raise the OS-level fd ceiling so the systemd LimitNOFILE=
# override in the unit file (65536) is actually reachable — systemd can
# only raise a process's soft limit up to whatever hard limit the kernel/
# distro allows. On most modern distros the default hard limit is already
# high enough (check: `ulimit -Hn`), but if it's low (some minimal cloud
# images ship with a hard limit of 4096 or similar), raise it in
# /etc/security/limits.conf:
#   khaao soft nofile 65536
#   khaao hard nofile 65536
# This matters because each SSE connection (student /api/stream, shopkeeper
# /api/shop/stream) holds one open file descriptor for as long as the
# tab/app stays connected — at the ~2000-student / ~1-2k concurrent SSE
# scale target (STATUS.md § Topology decision), the common default of 1024
# is exhausted well before capacity is reached.

# Build (run from a machine with Go 1.23, e.g. the server itself or CI —
# then copy the resulting binary over):
cd backend
go build -o khaao-backend ./cmd/server
sudo cp khaao-backend /opt/khaao/bin/khaao-backend
sudo chown root:root /opt/khaao/bin/khaao-backend
sudo chmod 755 /opt/khaao/bin/khaao-backend

# Real env file — copy the template, then fill in every value using the
# steps from backend/.env.example's own "HOW TO GET EACH KEY" header
# comments, § 1-3 of this runbook, and the notes below.
sudo cp backend/.env.example /etc/khaao/backend.env
sudo chown root:root /etc/khaao/backend.env
sudo chmod 600 /etc/khaao/backend.env
sudo $EDITOR /etc/khaao/backend.env
```

In `/etc/khaao/backend.env`, at minimum change these from their
`.env.example` dev defaults — `config.Validate()` (`backend/internal/config/config.go`)
**refuses to boot in production** if any of these are still wrong, so
getting them right isn't optional:

| Var | Must be, in production |
|---|---|
| `APP_ENV` | `production` (this is what turns on the fail-closed checks below) |
| `DATABASE_URL` | The real Postgres URL from § 1 — must not be empty, the dev default, or point at `localhost`/`127.0.0.1`/`::1` |
| `JWT_SECRET` | A strong random secret, **≥ 32 characters**, not the literal string `dev-secret-change-me`. Generate with `openssl rand -base64 48`. |
| `FIREBASE_PROJECT_ID` | The real project ID from § 2 — required (non-empty) in production |
| `FRONTEND_ORIGIN` | The real `https://` frontend origin, e.g. `https://khaao.example.com` — must parse as a valid `https://` URL |
| `AUTH_FAKE` | `false` (the server also refuses to boot if this is `true` and `APP_ENV=production`, so leaving it `true` isn't a silent risk — it's a boot failure — but set it correctly anyway) |
| `SHOPKEEPER_EMAILS` | Real shopkeeper Google account email(s), comma-separated |
| `CLOUDINARY_*` | From § 3, only after confirming the Programmable Media product |
| `VAPID_*` | Generate once (any VAPID keypair generator, e.g. `npx web-push generate-vapid-keys`), then **never regenerate** — rotating invalidates every existing push subscription |
| `SEED_SAMPLE_MENU` | `false` once you've entered a real menu — leave `true` for the very first boot if you want the sample menu as a starting point, then flip it off |

Then install and start the systemd unit:

```bash
sudo cp deploy/khaao-backend.service /etc/systemd/system/khaao-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now khaao-backend
sudo systemctl status khaao-backend      # confirm it's "active (running)"
journalctl -u khaao-backend -f           # tail logs, confirm "listening on :8080"
```

The unit file itself already sets `LimitNOFILE=65536`, runs as the
unprivileged `khaao` user/group, reads secrets from `/etc/khaao/backend.env`
(not the repo), and restarts on failure — see `deploy/khaao-backend.service`
for the annotated detail on each of those.

---

## 5. Build and deploy the frontend

Build-time env vars are baked into the static bundle at build time (Vite),
so they must be set **before** `npm run build`, not after:

```bash
cd frontend
cp .env.example .env      # if not already done
$EDITOR .env               # fill in VITE_FIREBASE_* from § 2 above
npm install
npm run build               # outputs to frontend/dist
```

Deploy `frontend/dist` to wherever Caddy will serve it from — the Caddyfile
in this repo (`deploy/Caddyfile`) expects it at `/var/www/khaao/frontend/dist`
on the same box as Caddy:

```bash
sudo mkdir -p /var/www/khaao/frontend
sudo rsync -a --delete frontend/dist/ /var/www/khaao/frontend/dist/
```

(If instead you serve the frontend from a separate static host — Netlify /
Vercel / Cloudflare Pages, as `STATUS.md` § 9 item D-5 also allows — set the
same `VITE_FIREBASE_*` vars in that host's build-time environment config, and
skip the Caddy static-file block in § 6 below, pointing `FRONTEND_ORIGIN` in
the backend's env at whatever domain that host gives you instead.)

---

## 6. Install Caddy and reload

```bash
# Install Caddy (Debian/Ubuntu — see caddyserver.com/docs/install for others)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Edit deploy/Caddyfile FIRST: replace the khaao.example.com placeholder
# with the real production domain (must match what you added to Firebase's
# Authorized domains in § 2, and what FRONTEND_ORIGIN is set to in § 4).
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

Confirm HTTPS actually came up (Caddy requests the cert on first request to
the real domain — DNS for that domain must already point at this server's
public IP before this step, or the ACME challenge fails):

```bash
curl -I https://khaao.example.com/api/health
```

**Verify SSE isn't being buffered** — this is the one thing in the whole
proxy chain that fails silently if misconfigured. From a shell that can reach
the deployed domain:

```bash
curl -N https://khaao.example.com/api/stream   # will 401 without a real
                                                 # student JWT, but you should
                                                 # see the response HANG
                                                 # (not return instantly) —
                                                 # confirms the connection
                                                 # itself isn't buffered
                                                 # closed early by the proxy
```

For a real check, log in as a real student/shopkeeper account and confirm
order-status changes / new-order alerts appear within ~1 second, not
delayed or only-on-refresh — see the end-to-end checklist in § 7.

---

## 7. End-to-end production verification

Do this with **real accounts** on the real production domain before calling
the deploy done — do not skip to "looks fine" from local/staging testing
alone, since Firebase Authorized domains, Cloudinary product tier, and Caddy
SSE buffering are all things that only fail in the real production
environment:

- [ ] One real student account (`@<your ALLOWED_EMAIL_DOMAIN>` address) can
      sign in with Google (confirms Firebase Authorized domains is correct)
- [ ] Student sees the live menu, including any diet/tag filters
- [ ] Student places an order
- [ ] One real shopkeeper account (an email in `SHOPKEEPER_EMAILS`) can sign
      in and immediately sees the new order on the Orders screen **without
      refreshing** (confirms `/api/shop/stream` SSE is not buffered by Caddy)
- [ ] Shopkeeper accepts the order (optionally trims an item)
- [ ] Shopkeeper marks prep-pool units done; student sees status progress
      live (confirms `/api/stream` SSE is not buffered)
- [ ] Shopkeeper hands over item(s); student's status reaches "ready" and
      the student's device chimes/vibrates/shows a notification
- [ ] Shopkeeper marks the order paid; it moves into shop history with
      correct insights
- [ ] Student rates at least one item post-completion
- [ ] Shopkeeper uploads a new menu-item photo (confirms Cloudinary is
      correctly on Programmable Media, not Media Optimizer — § 3)
- [ ] Shopkeeper subscribes to Web Push and receives a push notification for
      a subsequent test order sent with the shop's tab/app closed

If any SSE-dependent step above only works after a manual page refresh, stop
and re-check `deploy/Caddyfile`'s `flush_interval -1` blocks (§ 6) before
considering the deploy complete.

---

## 8. Ongoing ops

### Rotate `JWT_SECRET`

`JWT_SECRET` signs Khaao's own session tokens (HS256, separate from
Firebase). **Rotating it immediately invalidates every currently active
session** — every signed-in student and the shopkeeper get logged out and
must sign in again with Google (which re-issues a fresh Khaao JWT). There is
no graduated/dual-secret rollover in this codebase today, so:

1. Pick a low-traffic window if possible (not mid-lunch-rush).
2. Generate a new secret: `openssl rand -base64 48`.
3. Update `JWT_SECRET` in `/etc/khaao/backend.env`.
4. `sudo systemctl restart khaao-backend`.
5. Expect every active user to be bounced to the sign-in screen on their
   next request/reconnect — this is expected, not a bug.

### Add a shopkeeper

No admin API endpoint exists for this (checked `backend/internal/routes/routes.go`
— there is no `/api/admin/*` or similar route). Two options:

- **Env var (additive, requires a restart):** add the email to
  `SHOPKEEPER_EMAILS` in `/etc/khaao/backend.env` and
  `sudo systemctl restart khaao-backend`. `database.Seed()` (`backend/internal/database/database.go`)
  inserts any email in that comma-separated list that isn't already a row in
  the `shopkeeper_emails` table — it is **additive only**, it never deletes
  a row for an email that's been removed from the var (see next section).
- **Direct DB insert (no restart needed):** the role check re-reads the DB
  on every request (`STATUS.md` § 8: "removing a shopkeeper locks them out
  immediately"), so a direct insert takes effect on that person's very next
  request:
  ```sql
  INSERT INTO shopkeeper_emails (email, note, created_at)
  VALUES ('newperson@gmail.com', 'Added manually 2026-xx-xx', now())
  ON CONFLICT (email) DO NOTHING;
  ```
  (`email` is a `citext` primary key, so this is case-insensitive already.)

### Remove a shopkeeper

Editing `SHOPKEEPER_EMAILS` alone does **not** remove access (seeding is
additive-only, see above) — you must delete the row directly:

```sql
DELETE FROM shopkeeper_emails WHERE email = 'former.shopkeeper@gmail.com';
```

Also remove the email from `SHOPKEEPER_EMAILS` in `/etc/khaao/backend.env`
so a future restart doesn't reintroduce it. Takes effect on that person's
very next request — no restart needed, since the role is re-read from the DB
per-request rather than cached in the JWT.

### Check logs

```bash
journalctl -u khaao-backend -f              # follow live backend logs
journalctl -u khaao-backend --since "1 hour ago"
sudo tail -f /var/log/caddy/khaao-access.log   # Caddy access log (see deploy/Caddyfile)
sudo journalctl -u caddy -f                    # Caddy's own service log
```

### Restore Postgres from backup

Exact steps depend on which provider you picked in § 1 — all three
(Supabase/Neon/Railway) expose a "restore to point in time" or "restore from
snapshot" action in their dashboard that produces either a fresh
database/branch or restores in place. General shape:

1. In the provider dashboard, trigger a restore (to a new database if you
   want to inspect before cutting over, which is safer than in-place for
   anything except a genuine emergency).
2. Point a **copy** of `/etc/khaao/backend.env`'s `DATABASE_URL` at the
   restored database and confirm the app boots cleanly and data looks right
   (`SELECT count(*) FROM orders;` sanity checks, spot-check a few known
   rows) before touching the real `DATABASE_URL`.
3. Once confirmed, update the real `/etc/khaao/backend.env` `DATABASE_URL`
   (if the restore created a new endpoint) and
   `sudo systemctl restart khaao-backend`.
4. If you tested this restore flow already in § 1 step 5, this is the same
   procedure under less pressure — that's the point of testing it early.

---

## Reminder for whoever picks this up

This runbook and the files alongside it
(`deploy/Caddyfile`, `deploy/khaao-backend.service`) are **configuration
artifacts only** — nothing has actually been provisioned or deployed. Real
deployment still requires a human with:

- A registered domain (to replace the `khaao.example.com` placeholder)
- A server/VM to run Caddy + the Go binary
- Dashboard access to create the Firebase project and Cloudinary account
  (§ 3 in particular cannot be checked by an agent — it needs a human login)
- A managed Postgres account

Follow §§ 1-7 above in order; § 8 is ongoing reference, not a one-time step.
