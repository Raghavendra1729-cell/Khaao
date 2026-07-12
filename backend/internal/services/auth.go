package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/api/idtoken"
	"gorm.io/gorm"

	"khaao/internal/config"
	"khaao/internal/models"
)

// tokenTTL is the JWT lifetime: +7 days per SPEC.md. Guest sessions are
// throwaway identities, so they expire within a day.
const (
	tokenTTL      = 7 * 24 * time.Hour
	guestTokenTTL = 24 * time.Hour
)

// Claims is the JWT payload: sub = user id, role = user role.
type Claims struct {
	jwt.RegisteredClaims
	Role string `json:"role"`
}

// GenerateToken signs a new HS256 JWT for the given user; guests get a
// shorter lifetime.
func GenerateToken(user models.User, secret string) (string, error) {
	ttl := tokenTTL
	if user.Role == models.RoleGuest {
		ttl = guestTokenTTL
	}
	now := time.Now()
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatUint(uint64(user.ID), 10),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
		Role: string(user.Role),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseToken validates and decodes a JWT produced by GenerateToken.
func ParseToken(tokenStr, secret string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// UserResponse is the JSON shape of a user in API responses.
type UserResponse struct {
	ID    uint   `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

// ToUserResponse converts a model to its API response shape.
func ToUserResponse(u models.User) UserResponse {
	return UserResponse{ID: u.ID, Name: u.Name, Email: u.Email, Role: string(u.Role)}
}

// AuthService handles signup/login/identity.
type AuthService struct {
	db  *gorm.DB
	cfg *config.Config
}

// NewAuthService builds an AuthService.
func NewAuthService(db *gorm.DB, cfg *config.Config) *AuthService {
	return &AuthService{db: db, cfg: cfg}
}

// Signup registers a new student account with a password. Disabled by
// default now that Google + guest are the primary student auth paths;
// re-enable with PASSWORD_SIGNUP_ENABLED=true.
func (s *AuthService) Signup(name, email, password string) (models.User, string, error) {
	if !s.cfg.PasswordSignupEnabled {
		return models.User{}, "", ErrForbidden("password signup is disabled; use Google sign-in or continue as guest")
	}
	name = strings.TrimSpace(name)
	email = strings.ToLower(strings.TrimSpace(email))

	if name == "" {
		return models.User{}, "", ErrBadRequest("name is required")
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return models.User{}, "", ErrBadRequest("invalid email address")
	}
	if len(password) < 6 {
		return models.User{}, "", ErrBadRequest("password must be at least 6 characters")
	}
	if len(s.cfg.AllowedEmailDomains) > 0 {
		domain := emailDomain(email)
		allowed := false
		for _, d := range s.cfg.AllowedEmailDomains {
			if d == domain {
				allowed = true
				break
			}
		}
		if !allowed {
			return models.User{}, "", ErrBadRequest("email domain not allowed")
		}
	}

	var existing models.User
	err := s.db.Where("email = ?", email).First(&existing).Error
	if err == nil {
		return models.User{}, "", ErrConflict("email already registered")
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.User{}, "", err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return models.User{}, "", err
	}

	user := models.User{Name: name, Email: email, PasswordHash: string(hash), Role: models.RoleStudent, Provider: models.ProviderPassword}
	if err := s.db.Create(&user).Error; err != nil {
		return models.User{}, "", err
	}

	token, err := GenerateToken(user, s.cfg.JWTSecret)
	if err != nil {
		return models.User{}, "", err
	}
	return user, token, nil
}

// Login authenticates a user by email/password.
func (s *AuthService) Login(email, password string) (models.User, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))

	var user models.User
	err := s.db.Where("email = ?", email).First(&user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return models.User{}, "", ErrUnauthorized("invalid email or password")
		}
		return models.User{}, "", err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return models.User{}, "", ErrUnauthorized("invalid email or password")
	}

	token, err := GenerateToken(user, s.cfg.JWTSecret)
	if err != nil {
		return models.User{}, "", err
	}
	return user, token, nil
}

// GetUser loads a user by id (used by GET /api/auth/me).
func (s *AuthService) GetUser(id uint) (models.User, error) {
	var user models.User
	if err := s.db.First(&user, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return models.User{}, ErrNotFound("user not found")
		}
		return models.User{}, err
	}
	return user, nil
}

// GoogleLogin verifies a Google Identity Services ID token server-side
// (signature against Google's published keys, audience must equal our client
// id, expiry) and signs the user in, creating the account on first login.
// Safety gates: the Google email must be verified, its domain must be on the
// GOOGLE_ALLOWED_DOMAINS allowlist (when set), and a Google login can never
// take over a staff account.
func (s *AuthService) GoogleLogin(ctx context.Context, credential string) (models.User, string, error) {
	if s.cfg.GoogleClientID == "" {
		return models.User{}, "", ErrConflict("google sign-in is not configured on this server")
	}
	if strings.TrimSpace(credential) == "" {
		return models.User{}, "", ErrBadRequest("credential is required")
	}

	payload, err := idtoken.Validate(ctx, credential, s.cfg.GoogleClientID)
	if err != nil {
		return models.User{}, "", ErrUnauthorized("google sign-in failed: invalid token")
	}

	email := strings.ToLower(strings.TrimSpace(claimString(payload.Claims, "email")))
	if email == "" {
		return models.User{}, "", ErrUnauthorized("google sign-in failed: no email in token")
	}
	if verified, ok := payload.Claims["email_verified"].(bool); !ok || !verified {
		return models.User{}, "", ErrUnauthorized("google sign-in failed: email not verified")
	}
	if len(s.cfg.GoogleAllowedDomains) > 0 {
		domain := emailDomain(email)
		allowed := false
		for _, d := range s.cfg.GoogleAllowedDomains {
			if d == domain {
				allowed = true
				break
			}
		}
		if !allowed {
			return models.User{}, "", ErrForbidden("this Google account's domain is not allowed; use your college account")
		}
	}

	name := strings.TrimSpace(claimString(payload.Claims, "name"))
	if name == "" {
		name = strings.SplitN(email, "@", 2)[0]
	}

	var user models.User
	err = s.db.Where("email = ?", email).First(&user).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		user = models.User{Name: name, Email: email, Role: models.RoleStudent, Provider: models.ProviderGoogle}
		if err := s.db.Create(&user).Error; err != nil {
			return models.User{}, "", err
		}
	case err != nil:
		return models.User{}, "", err
	default:
		if user.Role == models.RoleShopkeeper {
			return models.User{}, "", ErrForbidden("staff accounts must use the staff login")
		}
	}

	token, err := GenerateToken(user, s.cfg.JWTSecret)
	if err != nil {
		return models.User{}, "", err
	}
	return user, token, nil
}

// GuestLogin creates a throwaway guest identity so someone can book without
// an account. Guests get a 24h session and are labelled as guests to the
// shopkeeper.
func (s *AuthService) GuestLogin(name string) (models.User, string, error) {
	if !s.cfg.GuestEnabled {
		return models.User{}, "", ErrForbidden("guest booking is disabled")
	}
	name = strings.TrimSpace(name)
	if len(name) < 2 || len(name) > 40 {
		return models.User{}, "", ErrBadRequest("please enter your name (2–40 characters)")
	}

	suffix := make([]byte, 6)
	if _, err := rand.Read(suffix); err != nil {
		return models.User{}, "", err
	}
	user := models.User{
		Name:     name,
		Email:    "guest-" + hex.EncodeToString(suffix) + "@guest.khaao",
		Role:     models.RoleGuest,
		Provider: models.ProviderGuest,
	}
	if err := s.db.Create(&user).Error; err != nil {
		return models.User{}, "", err
	}

	token, err := GenerateToken(user, s.cfg.JWTSecret)
	if err != nil {
		return models.User{}, "", err
	}
	return user, token, nil
}

// AuthConfigResponse tells the login screen which sign-in methods to offer.
type AuthConfigResponse struct {
	GoogleEnabled         bool     `json:"google_enabled"`
	GoogleClientID        string   `json:"google_client_id"`
	GoogleAllowedDomains  []string `json:"google_allowed_domains"`
	GuestEnabled          bool     `json:"guest_enabled"`
	PasswordSignupEnabled bool     `json:"password_signup_enabled"`
}

// AuthConfig reports the enabled auth methods (public endpoint).
func (s *AuthService) AuthConfig() AuthConfigResponse {
	domains := s.cfg.GoogleAllowedDomains
	if domains == nil {
		domains = []string{}
	}
	return AuthConfigResponse{
		GoogleEnabled:         s.cfg.GoogleClientID != "",
		GoogleClientID:        s.cfg.GoogleClientID,
		GoogleAllowedDomains:  domains,
		GuestEnabled:          s.cfg.GuestEnabled,
		PasswordSignupEnabled: s.cfg.PasswordSignupEnabled,
	}
}

func claimString(claims map[string]any, key string) string {
	if v, ok := claims[key].(string); ok {
		return v
	}
	return ""
}

func emailDomain(email string) string {
	parts := strings.SplitN(email, "@", 2)
	if len(parts) != 2 {
		return ""
	}
	return strings.ToLower(parts[1])
}
