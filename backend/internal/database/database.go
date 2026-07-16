// Package database opens the GORM connection, sets up postgres extensions,
// runs versioned SQL migrations, and seeds on boot.
package database

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	migratepg "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/migrations"
)

// Open opens the postgres connection, creates extensions, and runs the
// versioned SQL migrations in backend/migrations (embedded into the binary
// — see migrations.FS).
//
// Migrations run automatically on every boot, same convenience AutoMigrate
// used to provide. That's the right default in dev/test, and it's arguably
// fine in production too *for now*: golang-migrate's Up() is idempotent (a
// fully-migrated DB is a fast no-op check against schema_migrations) and
// this app is deliberately single-replica (see STATUS.md § Topology
// decision), so there's no multi-instance boot race to worry about. The
// thing to revisit before/at first real deploy: once there are real users
// and real migrations with real consequences, consider gating auto-run
// behind APP_ENV (e.g. only auto-run in dev/test, require an explicit
// `migrate` CLI step — or a one-off `--migrate-only` server flag — in
// production) so a bad migration can't take down boot of an already-running
// service, and so schema changes are a deliberate, reviewed step rather than
// a side effect of restarting the process. Not implemented here: there is
// no production deployment yet to actually need the gate (see STATUS.md
// § Deployment), so adding it now would be speculative.
func Open(cfg *config.Config) (*gorm.DB, error) {
	gormCfg := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}

	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), gormCfg)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// Tune the underlying sql.DB connection pool. For a single-instance server
	// handling ~2000 students, 25 open connections is generous; Postgres
	// default max_connections is 100 so this leaves headroom for migrations
	// and other tools.
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("get sql.DB: %w", err)
	}
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(time.Hour)

	if err := db.Exec("CREATE EXTENSION IF NOT EXISTS citext").Error; err != nil {
		return nil, fmt.Errorf("create citext extension: %w", err)
	}

	if err := runMigrations(sqlDB); err != nil {
		return nil, err
	}

	return db, nil
}

// runMigrations applies every pending migration in the embedded
// backend/migrations directory via golang-migrate, reusing the already-open
// *sql.DB (no second connection pool). A fully up-to-date database is a
// cheap no-op (migrate.ErrNoChange), not an error.
func runMigrations(sqlDB *sql.DB) error {
	driver, err := migratepg.WithInstance(sqlDB, &migratepg.Config{})
	if err != nil {
		return fmt.Errorf("init migrate postgres driver: %w", err)
	}

	src, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return fmt.Errorf("init migrate source: %w", err)
	}

	m, err := migrate.NewWithInstance("iofs", src, "postgres", driver)
	if err != nil {
		return fmt.Errorf("init migrate instance: %w", err)
	}

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("run migrations: %w", err)
	}
	return nil
}

// Seed upserts shopkeeper emails and seeds sample menu.
func Seed(db *gorm.DB, cfg *config.Config) error {
	if err := seedShopkeeperEmails(db, cfg.ShopkeeperEmails); err != nil {
		return fmt.Errorf("seed shopkeeper emails: %w", err)
	}
	if cfg.SeedSampleMenu {
		if err := seedSampleMenu(db); err != nil {
			return fmt.Errorf("seed sample menu: %w", err)
		}
	}
	if err := seedShopStatus(db); err != nil {
		return fmt.Errorf("seed shop status: %w", err)
	}
	return nil
}

// seedShopStatus ensures the singleton shop-status row (id=1) exists, defaulting
// to open. It never overwrites an existing row.
func seedShopStatus(db *gorm.DB) error {
	var count int64
	if err := db.Model(&models.ShopStatus{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	status := models.ShopStatus{ID: 1, State: string(models.ShopOpen)}
	if err := db.Create(&status).Error; err != nil {
		return err
	}
	slog.Info("khaao: seeded shop status", "state", "open")
	return nil
}

func seedShopkeeperEmails(db *gorm.DB, raw string) error {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	for _, p := range parts {
		email := strings.TrimSpace(p)
		if email == "" {
			continue
		}
		var se models.ShopkeeperEmail
		err := db.Where("email = ?", email).First(&se).Error
		if isNotFound(err) {
			se = models.ShopkeeperEmail{Email: email, Note: "Seeded from env"}
			if err := db.Create(&se).Error; err != nil {
				return err
			}
			slog.Info("khaao: seeded shopkeeper email", "email", email)
		} else if err != nil {
			return err
		}
	}
	return nil
}

func seedSampleMenu(db *gorm.DB) error {
	var count int64
	if err := db.Model(&models.MenuItem{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	items := []models.MenuItem{
		{Name: "Samosa", Price: 1500, IsAvailable: true},
		{Name: "Veg Puff", Price: 2000, IsAvailable: true},
		{Name: "Masala Dosa", Price: 4000, IsAvailable: true},
		{Name: "Chai", Price: 1000, IsAvailable: true},
		{Name: "Cold Coffee", Price: 3000, IsAvailable: true},
		{Name: "Veg Fried Rice", Price: 5000, IsAvailable: true},
	}
	if err := db.Create(&items).Error; err != nil {
		return err
	}
	slog.Info("khaao: seeded sample menu items", "count", len(items))
	return nil
}

func isNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
