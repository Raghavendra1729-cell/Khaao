// Package migrations embeds the SQL migration files directly into the
// compiled server binary (via Go 1.16+ embed.FS), so a production deploy is
// still "ship one binary" — no separate migrations/ directory needs to be
// copied alongside it and no absolute path needs to be configured at
// runtime. internal/database/database.go reads FS through
// golang-migrate/migrate/v4's source/iofs driver.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
