// Package config loads runtime configuration from the environment, applying
// the defaults documented in SPEC.md.
package config

import (
	"os"
	"strconv"
	"strings"
)

// Config holds all environment-derived settings for the server.
type Config struct {
	Port                  string
	DBDriver              string
	DBDSN                 string
	JWTSecret             string
	AllowedEmailDomains   []string
	HoldMinutes           int
	FrontendOrigin        string
	ShopkeeperEmail       string
	ShopkeeperPassword    string
	ShopkeeperName        string
	SeedSampleMenu        bool
	GoogleClientID        string
	GoogleAllowedDomains  []string
	GuestEnabled          bool
	PasswordSignupEnabled bool
}

// Load reads env vars, falling back to spec-defined defaults.
func Load() *Config {
	allowedDomains := parseDomains(envOr("ALLOWED_EMAIL_DOMAINS", ""))
	googleDomains := parseDomains(envOr("GOOGLE_ALLOWED_DOMAINS", ""))
	if len(googleDomains) == 0 {
		// Fall back to the general domain allowlist so one env var can
		// restrict both auth paths.
		googleDomains = allowedDomains
	}
	return &Config{
		Port:                  envOr("PORT", "8080"),
		DBDriver:              envOr("DB_DRIVER", "sqlite"),
		DBDSN:                 envOr("DB_DSN", "khaao.db"),
		JWTSecret:             envOr("JWT_SECRET", "dev-secret-change-me"),
		AllowedEmailDomains:   allowedDomains,
		HoldMinutes:           envOrInt("HOLD_MINUTES", 15),
		FrontendOrigin:        envOr("FRONTEND_ORIGIN", "http://localhost:5173"),
		ShopkeeperEmail:       envOr("SHOPKEEPER_EMAIL", "shopkeeper@canteen.local"),
		ShopkeeperPassword:    envOr("SHOPKEEPER_PASSWORD", "admin123"),
		ShopkeeperName:        envOr("SHOPKEEPER_NAME", "Canteen"),
		SeedSampleMenu:        envOrBool("SEED_SAMPLE_MENU", true),
		GoogleClientID:        envOr("GOOGLE_CLIENT_ID", ""),
		GoogleAllowedDomains:  googleDomains,
		GuestEnabled:          envOrBool("GUEST_ENABLED", true),
		PasswordSignupEnabled: envOrBool("PASSWORD_SIGNUP_ENABLED", false),
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envOrInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envOrBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

func parseDomains(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(strings.ToLower(p))
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
