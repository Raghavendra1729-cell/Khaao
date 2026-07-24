// Package config loads runtime configuration from the environment, applying
// the defaults documented in SPEC.md.
package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// devDefaultDatabaseURL is the local development fallback DSN. Production must
// override it — Validate() rejects a production boot that still uses it. No
// username in the URL — libpq/pgx default to the OS login user, so this
// isn't tied to any one developer's machine.
const devDefaultDatabaseURL = "postgres://localhost:5432/khaao?sslmode=disable"

// Config holds all environment-derived settings for the server.
type Config struct {
	Port                string
	AppEnv              string
	DatabaseURL         string
	JWTSecret           string
	FirebaseProjectID   string
	AllowedEmailDomain  string
	ShopkeeperEmails    string
	AuthFake            bool
	HoldMinutes         int
	FrontendOrigin      string
	SeedSampleMenu      bool
	BusinessTimezone    string
	CloudinaryCloudName string
	CloudinaryAPIKey    string
	CloudinaryAPISecret string
	VapidPublicKey      string
	VapidPrivateKey     string
	VapidSubject        string

	// loc/locOnce cache the loaded *time.Location. sync.Once (not a bare
	// nil-check) because Location() is called from ordinary request
	// handlers (services/menu.go's now(), services/pool.go's CreateOrder,
	// ...) which run on concurrent goroutines — see Location()'s doc
	// comment for why a bare nil-check here would be a real data race.
	locOnce sync.Once
	loc     *time.Location
	// envErrors collects env vars that were set but failed to parse (e.g.
	// HOLD_MINUTES=1O) — Validate() fails closed on these instead of
	// silently keeping the default, so a typo doesn't go unnoticed.
	envErrors []string
}

// Load reads env vars, falling back to spec-defined defaults.
func Load() *Config {
	loadDotEnv()
	var envErrors []string
	return &Config{
		Port:                envOr("PORT", "8080"),
		AppEnv:              strings.ToLower(strings.TrimSpace(envOr("APP_ENV", "dev"))),
		DatabaseURL:         envOr("DATABASE_URL", devDefaultDatabaseURL),
		JWTSecret:           envOr("JWT_SECRET", "dev-secret-change-me"),
		FirebaseProjectID:   envOr("FIREBASE_PROJECT_ID", ""),
		AllowedEmailDomain:  envOr("ALLOWED_EMAIL_DOMAIN", "sst.scaler.com"),
		ShopkeeperEmails:    envOr("SHOPKEEPER_EMAILS", ""),
		AuthFake:            envOrBool(&envErrors, "AUTH_FAKE", false),
		HoldMinutes:         envOrInt(&envErrors, "HOLD_MINUTES", 15),
		FrontendOrigin:      envOr("FRONTEND_ORIGIN", "http://localhost:5173"),
		SeedSampleMenu:      envOrBool(&envErrors, "SEED_SAMPLE_MENU", true),
		BusinessTimezone:    envOr("BUSINESS_TIMEZONE", "Asia/Kolkata"),
		CloudinaryCloudName: envOr("CLOUDINARY_CLOUD_NAME", ""),
		CloudinaryAPIKey:    envOr("CLOUDINARY_API_KEY", ""),
		CloudinaryAPISecret: envOr("CLOUDINARY_API_SECRET", ""),
		VapidPublicKey:      envOr("VAPID_PUBLIC_KEY", ""),
		VapidPrivateKey:     envOr("VAPID_PRIVATE_KEY", ""),
		VapidSubject:        envOr("VAPID_SUBJECT", ""),
		envErrors:           envErrors,
	}
}

// Location returns the configured business timezone, loading and caching it
// on first use. Falls back to UTC if the zone is invalid — Validate()
// rejects an invalid zone at boot, so this fallback only matters in tests.
// Guarded by sync.Once rather than a bare "if c.loc != nil" nil-check: this
// is called from concurrent request-handling goroutines (every menu/order
// read that touches "now" in the business timezone), so two goroutines
// racing to populate c.loc for the first time is a genuine data race, not a
// theoretical one — confirmed by `go test -race` the moment two callers ever
// overlap on an unwarmed Config (e.g. two concurrent service calls in a test
// that builds a bare &config.Config{} without calling Validate() first).
// Validate() already eagerly warms this at boot in every real server
// startup (see its own call to Location() below), so production traffic
// never actually contends on the sync.Once after boot — but relying purely
// on caller discipline for that was the bug; sync.Once makes it correct
// unconditionally.
func (c *Config) Location() *time.Location {
	c.locOnce.Do(func() {
		loc, err := time.LoadLocation(c.BusinessTimezone)
		if err != nil {
			loc = time.UTC
		}
		c.loc = loc
	})
	return c.loc
}

// Validate fails closed: in production it refuses to boot with development
// defaults or missing required settings, and any APP_ENV outside the known set
// is rejected rather than silently treated as development. Returns the first
// problem found.
func (c *Config) Validate() error {
	if len(c.envErrors) > 0 {
		return fmt.Errorf("invalid environment configuration: %s", strings.Join(c.envErrors, "; "))
	}
	if c.HoldMinutes <= 0 {
		return fmt.Errorf("HOLD_MINUTES must be greater than 0 (got %d)", c.HoldMinutes)
	}

	if _, err := time.LoadLocation(c.BusinessTimezone); err != nil {
		return fmt.Errorf("invalid BUSINESS_TIMEZONE %q: %w", c.BusinessTimezone, err)
	}
	c.Location() // eager-warm the sync.Once cache so boot pays the LoadLocation cost, not the first request

	if c.AuthFake && c.AppEnv != "dev" && c.AppEnv != "test" {
		return fmt.Errorf("AUTH_FAKE=true is only allowed when APP_ENV is dev or test (got %q)", c.AppEnv)
	}

	switch c.AppEnv {
	case "dev", "test":
		// development defaults are permitted
	case "production":
		if c.JWTSecret == "" || c.JWTSecret == "dev-secret-change-me" || len(c.JWTSecret) < 32 {
			return fmt.Errorf("JWT_SECRET must be a strong secret of at least 32 characters in production")
		}
		if err := validateProdDatabaseURL(c.DatabaseURL); err != nil {
			return err
		}
		if c.FirebaseProjectID == "" {
			return fmt.Errorf("FIREBASE_PROJECT_ID is required in production")
		}
		u, err := url.Parse(c.FrontendOrigin)
		if err != nil || u.Scheme != "https" || u.Host == "" {
			return fmt.Errorf("FRONTEND_ORIGIN must be a valid https:// URL in production (got %q)", c.FrontendOrigin)
		}
	default:
		return fmt.Errorf("APP_ENV must be one of dev, test, production (got %q)", c.AppEnv)
	}
	return nil
}

// validateProdDatabaseURL rejects the dev default and localhost targets in
// production. URL-form DSNs are host-checked; keyword-form DSNs are left alone
// (only the dev-default guard applies) to avoid false rejections.
func validateProdDatabaseURL(dsn string) error {
	if dsn == "" || dsn == devDefaultDatabaseURL {
		return fmt.Errorf("DATABASE_URL must point at a real database in production")
	}
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		if u, err := url.Parse(dsn); err == nil {
			switch u.Hostname() {
			case "localhost", "127.0.0.1", "::1":
				return fmt.Errorf("DATABASE_URL must not point at localhost in production")
			}
		}
	}
	return nil
}

// loadDotEnv reads KEY=VALUE lines from ./.env into the process environment
// so `go run ./cmd/server` picks up local settings. Real env vars win.
func loadDotEnv() {
	data, err := os.ReadFile(".env")
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		if k != "" && os.Getenv(k) == "" {
			_ = os.Setenv(k, v) // only fails on a NUL byte in k/v, not reachable from a real .env file
		}
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envOrInt(errs *[]string, key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
		*errs = append(*errs, fmt.Sprintf("%s=%q is not a valid integer", key, v))
	}
	return def
}

func envOrBool(errs *[]string, key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
		*errs = append(*errs, fmt.Sprintf("%s=%q is not a valid boolean (use true/false)", key, v))
	}
	return def
}
