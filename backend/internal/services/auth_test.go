package services_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"testing"

	"github.com/golang-jwt/jwt/v5"

	"khaao/internal/authn"
	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/services"
)

type mockUserRepo struct {
	users []*models.User
}

func (m *mockUserRepo) FindByID(ctx context.Context, id uint) (*models.User, error) {
	for _, u := range m.users {
		if u.ID == id {
			return u, nil
		}
	}
	return nil, nil
}
func (m *mockUserRepo) FindByEmail(ctx context.Context, email string) (*models.User, error) {
	for _, u := range m.users {
		if u.Email == email {
			return u, nil
		}
	}
	return nil, nil
}
func (m *mockUserRepo) FindByFirebaseUID(ctx context.Context, uid string) (*models.User, error) {
	for _, u := range m.users {
		if u.FirebaseUID == uid {
			return u, nil
		}
	}
	return nil, nil
}
func (m *mockUserRepo) Save(ctx context.Context, user *models.User) error {
	if user.ID == 0 {
		user.ID = uint(len(m.users) + 1)
		m.users = append(m.users, user)
	}
	return nil
}

type mockEmailRepo struct {
	emails map[string]bool
}

func (m *mockEmailRepo) Exists(ctx context.Context, email string) (bool, error) {
	return m.emails[email], nil
}

type mockVerifier struct {
	identities map[string]*authn.Identity
}

func (m *mockVerifier) Verify(ctx context.Context, token string) (*authn.Identity, error) {
	if id, ok := m.identities[token]; ok {
		return id, nil
	}
	return nil, nil
}

func TestAuthRules(t *testing.T) {
	uRepo := &mockUserRepo{users: []*models.User{}}
	eRepo := &mockEmailRepo{emails: map[string]bool{"shop@shop.com": true}}
	verifier := &mockVerifier{
		identities: map[string]*authn.Identity{
			"shop-token":    {UID: "1", Email: "shop@shop.com", EmailVerified: true},
			"student-token": {UID: "2", Email: "student@college.edu", EmailVerified: true},
			"bad-token":     {UID: "3", Email: "bad@gmail.com", EmailVerified: true},
			"unverified":    {UID: "4", Email: "student@college.edu", EmailVerified: false},
		},
	}

	cfg := &config.Config{
		AllowedEmailDomain: "college.edu",
		JWTSecret:          "secret",
	}

	svc := services.NewAuthService(uRepo, eRepo, verifier, cfg)

	// Shopkeeper login (in allowlist, domain doesn't match)
	user, _, err := svc.FirebaseLogin(context.Background(), "shop-token")
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if user.Role != models.RoleShopkeeper {
		t.Fatalf("expected shopkeeper, got %v", user.Role)
	}

	// Student login (domain matches)
	user, _, err = svc.FirebaseLogin(context.Background(), "student-token")
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if user.Role != models.RoleStudent {
		t.Fatalf("expected student, got %v", user.Role)
	}

	// Bad domain login
	_, _, err = svc.FirebaseLogin(context.Background(), "bad-token")
	if err == nil {
		t.Fatalf("expected failure for bad domain")
	}

	// Unverified email
	_, _, err = svc.FirebaseLogin(context.Background(), "unverified")
	if err == nil {
		t.Fatalf("expected failure for unverified email")
	}
}

// TestGetUserRevalidatesShopkeeperAllowlist: a de-provisioned shopkeeper
// (removed from the email allowlist, e.g. staff turnover) must be locked out
// on their very next request even though they already hold a valid,
// unexpired JWT and their stored user.Role column still says "shopkeeper" —
// the allowlist is otherwise only ever consulted at login. A student's
// access must be unaffected by a change to this unrelated allowlist.
func TestGetUserRevalidatesShopkeeperAllowlist(t *testing.T) {
	uRepo := &mockUserRepo{users: []*models.User{}}
	eRepo := &mockEmailRepo{emails: map[string]bool{"shop@shop.com": true}}
	verifier := &mockVerifier{
		identities: map[string]*authn.Identity{
			"shop-token":    {UID: "1", Email: "shop@shop.com", EmailVerified: true},
			"student-token": {UID: "2", Email: "student@college.edu", EmailVerified: true},
		},
	}
	cfg := &config.Config{AllowedEmailDomain: "college.edu", JWTSecret: "secret"}
	svc := services.NewAuthService(uRepo, eRepo, verifier, cfg)

	shopUser, _, err := svc.FirebaseLogin(context.Background(), "shop-token")
	if err != nil {
		t.Fatalf("expected shopkeeper login to succeed, got %v", err)
	}
	studentUser, _, err := svc.FirebaseLogin(context.Background(), "student-token")
	if err != nil {
		t.Fatalf("expected student login to succeed, got %v", err)
	}

	if _, err := svc.GetUser(context.Background(), shopUser.ID); err != nil {
		t.Fatalf("expected shopkeeper still on the allowlist to load, got %v", err)
	}
	if _, err := svc.GetUser(context.Background(), studentUser.ID); err != nil {
		t.Fatalf("expected student to load, got %v", err)
	}

	// Simulate an admin de-provisioning the shopkeeper without them logging
	// in again — their JWT/session is still otherwise perfectly valid.
	delete(eRepo.emails, "shop@shop.com")

	if _, err := svc.GetUser(context.Background(), shopUser.ID); err == nil {
		t.Fatal("expected a removed shopkeeper's existing session to be locked out immediately")
	}
	if _, err := svc.GetUser(context.Background(), studentUser.ID); err != nil {
		t.Fatalf("expected student access to be unaffected by the shopkeeper allowlist change, got %v", err)
	}
}

// TestFirebaseLoginRefreshesStoredEmailOnRepeatLogin: FirebaseLogin recomputes
// `role` from the freshly-verified identity.Email on every login (shopkeeper
// allowlist / student domain check), but on the repeat-login path (an
// existing user found by FirebaseUID) it only ever refreshed Name/PhotoURL —
// never Email. A Google account's primary email can change (Workspace admin
// rename, alias switch); FirebaseUID is the stable identity across that
// change, so this path is exactly how a real email change would be noticed.
// Leaving the old email frozen in `users.email` means every later
// allowlist re-check (AuthService.GetUser, see the 2026-07-21 instant-
// revocation fix) keys off a value that no longer matches this person's
// real identity — an admin removing their *current* email from
// SHOPKEEPER_EMAILS does not revoke them if their stale stored email is
// still (or again) on the list, and conversely a legitimate email change
// can spuriously lock them out. Name/PhotoURL already prove the intent to
// keep the profile fresh on every login; Email was the one field left
// behind.
func TestFirebaseLoginRefreshesStoredEmailOnRepeatLogin(t *testing.T) {
	uRepo := &mockUserRepo{users: []*models.User{
		{ID: 1, FirebaseUID: "1", Email: "old@shop.com", Name: "Old Name", Role: models.RoleShopkeeper},
	}}
	eRepo := &mockEmailRepo{emails: map[string]bool{"new@shop.com": true}}
	verifier := &mockVerifier{
		identities: map[string]*authn.Identity{
			// Same Firebase UID as the existing user, but the account's email
			// has since changed — this is the repeat-login path.
			"shop-token": {UID: "1", Email: "new@shop.com", Name: "New Name", EmailVerified: true},
		},
	}
	cfg := &config.Config{AllowedEmailDomain: "college.edu", JWTSecret: "secret"}
	svc := services.NewAuthService(uRepo, eRepo, verifier, cfg)

	user, _, err := svc.FirebaseLogin(context.Background(), "shop-token")
	if err != nil {
		t.Fatalf("expected login to succeed, got %v", err)
	}
	if user.Email != "new@shop.com" {
		t.Fatalf("expected stored email to refresh to new@shop.com, got %q", user.Email)
	}
}

// TestParseTokenRejectsWrongAlgorithm pins ParseToken to HS256 — without
// jwt.WithValidMethods, the library happily verifies whatever alg the token
// header claims, including "none" (no signature at all) or an attacker-
// supplied RS256 token, as long as the "signature" satisfies that
// algorithm's check. Not practically exploitable today ([]byte HS256 key is
// type-incompatible with RSA/ECDSA verification), but this makes the
// HS256-only claim actually true in code.
func TestParseTokenRejectsWrongAlgorithm(t *testing.T) {
	secret := "test-secret-at-least-32-bytes-long!"

	claims := &services.Claims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: "1"},
		Role:             string(models.RoleStudent),
	}

	t.Run("valid HS256 token is accepted", func(t *testing.T) {
		signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
		if err != nil {
			t.Fatalf("failed to sign token: %v", err)
		}
		if _, err := services.ParseToken(signed, secret); err != nil {
			t.Fatalf("expected valid HS256 token to be accepted, got %v", err)
		}
	})

	t.Run("alg none is rejected", func(t *testing.T) {
		token := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
		signed, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
		if err != nil {
			t.Fatalf("failed to sign none-alg token: %v", err)
		}
		if _, err := services.ParseToken(signed, secret); err == nil {
			t.Fatal("expected alg=none token to be rejected")
		}
	})

	t.Run("alg RS256 is rejected", func(t *testing.T) {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			t.Fatalf("failed to generate RSA key: %v", err)
		}
		signed, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
		if err != nil {
			t.Fatalf("failed to sign RS256 token: %v", err)
		}
		if _, err := services.ParseToken(signed, secret); err == nil {
			t.Fatal("expected alg=RS256 token to be rejected")
		}
	})
}
