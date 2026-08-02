# Khaao — Handoff for the next AI / maintainer

Read this before changing production. It records the live deployment as of
2026-08-02, without storing credentials. For detailed operational commands,
also read [`deploy/RUNBOOK.md`](deploy/RUNBOOK.md).

## Project and local access

- Repository: `https://github.com/Raghavendra1729-cell/Khaao`
- Main branch: `main`
- Local macOS checkout: `/Users/lingaraghavendra/folders/Khaao`
- Open it locally:

  ```bash
  cd /Users/lingaraghavendra/folders/Khaao
  git status
  git log --oneline -5
  ```

- The normal release path is **commit and push to `main`**. GitHub Actions
  tests, builds, and deploys automatically. Check the result in GitHub →
  **Actions** → **Deploy production**. Never assume a `git push` alone means
  the live site changed.

## Azure VM access

The production server is an Azure Ubuntu 24.04 VM:

- Resource group: `Khaao`
- VM name: `khaao-api`
- Region: Central India
- SSH user: `khaao`
- Public IP at handoff: `20.219.0.113`
- Operator's private key path on this Mac:
  `~/Downloads/khaao-api-key.pem`

The private key is intentionally **not** in this repository. Do not ask the
owner to paste it into chat and do not commit it. From the owner's Mac:

```bash
chmod 400 ~/Downloads/khaao-api-key.pem
ssh -i ~/Downloads/khaao-api-key.pem khaao@20.219.0.113
```

Once connected, these commands are the first production checks:

```bash
sudo systemctl is-active khaao-backend caddy
curl -fsS http://localhost:8080/api/health && echo
curl -fsSI https://khaaos.app/api/health
git -C /opt/khaao/app rev-parse --short HEAD
readlink -f /var/www/khaao/frontend/current
```

Expected: both services are `active`, both health requests succeed, and the
last two values refer to the release from the latest successful Actions run.

## Live architecture

| Part | Current setup |
|---|---|
| Public site | `https://khaaos.app` |
| DNS | `khaaos.app` A record points to the Azure VM IP |
| TLS/reverse proxy | Caddy, `/etc/caddy/Caddyfile` |
| Backend source checkout | `/opt/khaao/app` |
| Backend executable | `/opt/khaao/bin/khaao-backend` |
| Backend service | `khaao-backend.service` via systemd |
| Backend production env | `/etc/khaao/backend.env` (root-owned, mode 600) |
| Database | Supabase Postgres using a **Session Pooler** URL |
| Frontend releases | `/var/www/khaao/frontend/releases/<git-sha>` |
| Live frontend | `/var/www/khaao/frontend/current` symlink |
| Authentication | Firebase project `khaao0`, Google provider enabled |
| Student email rule | `ALLOWED_EMAIL_DOMAIN=sst.scaler.com` |

The backend must use the Supabase **Session Pooler** host, not the direct
database hostname: the latter resolved to IPv6 and the Azure VM had no IPv6
route, causing `network is unreachable` on port 5432.

## GitHub Actions deployment

Workflow: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)

Required repository secrets already configured:

- `AZURE_HOST` — public VM IPv4
- `AZURE_SSH_PRIVATE_KEY` — full SSH PEM private key for user `khaao`

The workflow:

1. Runs Go format/build/vet/race tests plus frontend lint/type/test/build.
2. Builds a Linux backend binary and static frontend bundle.
3. Uploads artifacts to the VM through SSH.
4. Updates `/opt/khaao/app` to the exact commit, installs the binary, creates
   a frontend release directory, flips `current`, restarts the backend,
   reloads Caddy, and waits up to 30 seconds for backend health.

Important history: the original two deploy runs reported failure even though
they had deployed successfully, because the health check ran before Go had
opened port 8080. Commit `7800ae4` changed the workflow to wait/retry. Verify
the Actions run for that commit before treating automation as complete. That
run completed successfully on 2026-08-02, so automatic deployment is now
confirmed working.

## Firebase / Caddy facts

- Firebase Authorized domains contains `khaaos.app`.
- Google and Email/Password providers were enabled in Firebase; the live app
  uses Google sign-in.
- Google login initially failed because Caddy CSP blocked Firebase's dynamic
  `https://apis.google.com/js/api.js` bootstrap. The live Caddyfile and
  repository template now permit `https://apis.google.com` in `script-src`.
- Do not replace `/etc/caddy/Caddyfile` with `deploy/Caddyfile` verbatim: the
  repository file deliberately has `khaao.example.com` as a placeholder.
  Update/validate the live hostname before any manual Caddy replacement.

Validate/reload Caddy safely:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

## What has been verified

- Local frontend test suite passed (148 tests at the time of verification).
- Go format/build/vet/tests/race checks passed.
- A local lifecycle smoke test previously passed all 15 checks: student/shop
  auth, domain and role guards, menu/order, FCFS, preparation, handover,
  payment, trimming/re-pooling.
- Public `https://khaaos.app/api/health` returned HTTP 200.
- Static homepage returned HTTP 200 over HTTPS.
- Firebase Google login worked after a hard browser refresh.
- Student order creation was exercised on production.

## Expected messages that are not bugs

- `GET /api/orders/active` returning **404** means that student has no active
  order. The frontend explicitly converts this normal response into `null`.
- Chrome's AudioContext warning before a user gesture is normal autoplay
  protection.
- Firebase popup `Cross-Origin-Opener-Policy ... window.closed` console
  warnings are common when sign-in succeeds.
- `VibeExtract` content-script messages come from a browser extension, not
  Khaao.

## Remaining work, in order

1. Rotate any Supabase secret/API key ever exposed outside the dashboard.
   Khaao backend only needs `DATABASE_URL`; do not put unrelated Supabase API
   keys in `/etc/khaao/backend.env`.
2. Run real production acceptance testing with a student and shopkeeper:
   order → accept → prep → handover → payment; confirm SSE updates occur
   without refreshing; test photo upload and Web Push.
3. Test installation and sign-in on Android and iPhone (iOS uses Safari →
   Share → Add to Home Screen rather than an install popup).
4. In Azure NSG, restrict SSH port 22 to the owner's IP before broad launch.
   Keep an existing SSH session open while making that change.
5. Set Azure budget alerts ($10, $25, $50 suggested) and load-test before a
   full 2,000-student rollout. The small B2ats_v2 VM is reasonable for a
   pilot, not a proven 2,000-concurrent-user capacity.

## Incident commands

```bash
sudo systemctl status khaao-backend caddy --no-pager
sudo journalctl -u khaao-backend -n 100 --no-pager
sudo journalctl -u caddy -n 100 --no-pager
curl -i http://localhost:8080/api/health
sudo caddy validate --config /etc/caddy/Caddyfile
```

For application/database configuration, inspect variable *names* only; do
not echo or paste secret values:

```bash
sudo awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' /etc/khaao/backend.env
```

## Security rules

- Never commit `.env` files, PEM keys, database URLs, JWT secrets, Firebase
  credentials, Cloudinary secrets, or GitHub Actions secrets.
- `.gitignore` excludes local env files, `*.pem`, and generated deployment
  artifacts. Keep templates such as `backend/.env.example` tracked.
- Before destructive server/database work, verify the exact target and use a
  backup or a reversible action first.
