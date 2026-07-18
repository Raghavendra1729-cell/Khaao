# Khaao Backend

Go 1.23 + Gin + GORM + Postgres backend for the Khaao canteen pre-order app.
See [`STATUS.md`](../STATUS.md) at the repo root for the full picture
(architecture, API surface, what's done, what's next) and
[`docs/SPEC.md`](../docs/SPEC.md) for the frozen core API contract. This file
only covers running the backend locally — everything else lives in STATUS.md
to avoid two docs drifting out of sync with each other.

## Run locally

```bash
createdb khaao
cp .env.example .env
# At minimum set FIREBASE_PROJECT_ID (or AUTH_FAKE=true for dev)
go run ./cmd/server
```

Runs versioned SQL migrations (`migrations/`) and seeds shopkeeper emails
(from `SHOPKEEPER_EMAILS`) and a sample menu on first boot. Listens on `PORT`
(default `8080`). See `.env.example` for the full list of environment
variables.

## Verify

```bash
go build ./... && go vet ./... && go test ./... -race
```

Integration tests against a real Postgres (not the mocked unit suite above):

```bash
createdb khaao_test
TEST_DATABASE_URL="postgres://$(whoami)@localhost:5432/khaao_test?sslmode=disable" \
  go test -tags=integration -p 1 ./... -race
```
