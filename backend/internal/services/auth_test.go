package services_test

import (
	"context"
	"testing"

	"khaao/internal/authn"
	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/services"
)

type mockUserRepo struct {
	users []*models.User
}

func (m *mockUserRepo) FindByID(ctx context.Context, id uint) (*models.User, error) { return nil, nil }
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
			"shop-token": {UID: "1", Email: "shop@shop.com", EmailVerified: true},
			"student-token": {UID: "2", Email: "student@college.edu", EmailVerified: true},
			"bad-token": {UID: "3", Email: "bad@gmail.com", EmailVerified: true},
			"unverified": {UID: "4", Email: "student@college.edu", EmailVerified: false},
		},
	}
	
	cfg := &config.Config{
		AllowedEmailDomain: "college.edu",
		JWTSecret: "secret",
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
