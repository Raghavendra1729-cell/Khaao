package config

import "testing"

func TestValidate(t *testing.T) {
	const strongSecret = "0123456789abcdef0123456789abcdef" // 32 chars

	type envset struct {
		appEnv, jwt, dbURL, firebase, frontend, authFake, tz, holdMinutes string
	}
	base := envset{
		appEnv:      "production",
		jwt:         strongSecret,
		dbURL:       "postgres://user:pass@db.example.com:5432/khaao?sslmode=require",
		firebase:    "khaao-prod",
		frontend:    "https://khaao.example.com",
		authFake:    "false",
		tz:          "Asia/Kolkata",
		holdMinutes: "15",
	}

	cases := []struct {
		name    string
		mutate  func(e *envset)
		wantErr bool
	}{
		{"production all good", func(e *envset) {}, false},
		{"production missing firebase", func(e *envset) { e.firebase = "" }, true},
		{"production default jwt", func(e *envset) { e.jwt = "dev-secret-change-me" }, true},
		{"production short jwt", func(e *envset) { e.jwt = "tooshort" }, true},
		{"production default db", func(e *envset) { e.dbURL = devDefaultDatabaseURL }, true},
		{"production non-https origin", func(e *envset) { e.frontend = "http://x.example.com" }, true},
		{"unknown app env fails closed", func(e *envset) { e.appEnv = "staging" }, true},
		{"production localhost db rejected", func(e *envset) {
			e.dbURL = "postgres://someone@localhost:5432/otherdb?sslmode=disable"
		}, true},
		{"authfake in production", func(e *envset) { e.authFake = "true" }, true},
		{"authfake in dev", func(e *envset) { e.appEnv = "dev"; e.authFake = "true" }, false},
		{"invalid timezone", func(e *envset) { e.tz = "Not/AZone" }, true},
		{"unparseable HOLD_MINUTES fails closed", func(e *envset) { e.holdMinutes = "1O" }, true},
		{"zero HOLD_MINUTES rejected", func(e *envset) { e.holdMinutes = "0" }, true},
		{"negative HOLD_MINUTES rejected", func(e *envset) { e.holdMinutes = "-5" }, true},
		{"dev with all defaults", func(e *envset) {
			e.appEnv = "dev"
			e.jwt = "dev-secret-change-me"
			e.dbURL = devDefaultDatabaseURL
			e.firebase = ""
			e.frontend = "http://localhost:5173"
		}, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := base
			tc.mutate(&e)
			t.Setenv("APP_ENV", e.appEnv)
			t.Setenv("JWT_SECRET", e.jwt)
			t.Setenv("DATABASE_URL", e.dbURL)
			t.Setenv("FIREBASE_PROJECT_ID", e.firebase)
			t.Setenv("FRONTEND_ORIGIN", e.frontend)
			t.Setenv("AUTH_FAKE", e.authFake)
			t.Setenv("BUSINESS_TIMEZONE", e.tz)
			t.Setenv("HOLD_MINUTES", e.holdMinutes)

			err := Load().Validate()
			if tc.wantErr && err == nil {
				t.Fatalf("expected a validation error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("expected no error, got: %v", err)
			}
		})
	}
}
