package middleware_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"khaao/internal/config"
	"khaao/internal/middleware"
	"khaao/internal/models"
	"khaao/internal/services"
)

// fakeUserRepo lets a test control exactly what AuthService.GetUser sees:
// either a genuinely-missing user (nil, nil) or an infrastructure failure
// (a bare, non-AppError error) — the two cases T1 requires the middleware
// to tell apart.
type fakeUserRepo struct {
	user *models.User
	err  error
}

func (f *fakeUserRepo) FindByID(ctx context.Context, id uint) (*models.User, error) {
	return f.user, f.err
}
func (f *fakeUserRepo) FindByEmail(ctx context.Context, email string) (*models.User, error) {
	return nil, nil
}
func (f *fakeUserRepo) FindByFirebaseUID(ctx context.Context, uid string) (*models.User, error) {
	return nil, nil
}
func (f *fakeUserRepo) Save(ctx context.Context, user *models.User) error { return nil }

type fakeEmailRepo struct{}

func (f *fakeEmailRepo) Exists(ctx context.Context, email string) (bool, error) { return false, nil }

func init() {
	gin.SetMode(gin.TestMode)
}

func newAuthTestRouter(userRepo *fakeUserRepo) (*gin.Engine, *config.Config, *services.AuthService) {
	cfg := &config.Config{JWTSecret: "test-secret"}
	authSvc := services.NewAuthService(userRepo, &fakeEmailRepo{}, nil, cfg)
	r := gin.New()
	r.GET("/protected", middleware.RequireAuth(cfg, authSvc), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})
	return r, cfg, authSvc
}

// TestRequireAuthInfraErrorIsRetryable guards the T1 fix: a transient
// database failure (connection-pool exhaustion, failover, timeout) must not
// be served as 401 — that destroys the client's token and force-logs-out
// every user hitting the same blip, when the session itself was fine.
func TestRequireAuthInfraErrorIsRetryable(t *testing.T) {
	userRepo := &fakeUserRepo{err: errors.New("connection refused")}
	r, cfg, _ := newAuthTestRouter(userRepo)
	token, err := services.GenerateToken(models.User{ID: 1}, cfg.JWTSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d (a transient DB error must not force a logout)", w.Code, http.StatusServiceUnavailable)
	}
}

// TestRequireAuthUnknownUserIsUnauthorized is the existing-behavior case:
// a genuinely missing user (or a shopkeeper dropped from the allowlist)
// must still hard-401, per the 2026-07-21 instant-revocation behavior.
func TestRequireAuthUnknownUserIsUnauthorized(t *testing.T) {
	userRepo := &fakeUserRepo{user: nil, err: nil}
	r, cfg, _ := newAuthTestRouter(userRepo)
	token, err := services.GenerateToken(models.User{ID: 1}, cfg.JWTSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d (a genuinely missing user must still be a hard logout)", w.Code, http.StatusUnauthorized)
	}
}

// TestRequireSSEAuthInfraErrorIsRetryable is T1's identical fix applied to
// the SSE ticket path — RequireSSEAuth must classify GetUser errors the
// same way RequireAuth does.
func TestRequireSSEAuthInfraErrorIsRetryable(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret"}
	userRepo := &fakeUserRepo{err: errors.New("connection refused")}
	authSvc := services.NewAuthService(userRepo, &fakeEmailRepo{}, nil, cfg)
	tickets := services.NewSSETicketService()
	ticket, err := tickets.Mint(1)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}

	r := gin.New()
	r.GET("/sse", middleware.RequireSSEAuth(authSvc, tickets), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/sse?ticket="+ticket, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d (a transient DB error must not force a logout)", w.Code, http.StatusServiceUnavailable)
	}
}
