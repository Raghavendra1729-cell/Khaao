package services

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"khaao/internal/authn"
	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/repository"
)

const tokenTTL = 7 * 24 * time.Hour

type Claims struct {
	jwt.RegisteredClaims
	Role string `json:"role"`
}

func GenerateToken(user models.User, secret string) (string, error) {
	now := time.Now()
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatUint(uint64(user.ID), 10),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(tokenTTL)),
		},
		Role: string(user.Role),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func ParseToken(tokenStr, secret string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Name}))
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, ErrUnauthorized("invalid token")
	}
	return claims, nil
}

type UserResponse struct {
	ID       uint   `json:"id"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	PhotoURL string `json:"photo_url"`
}

func ToUserResponse(u models.User) UserResponse {
	return UserResponse{ID: u.ID, Name: u.Name, Email: u.Email, Role: string(u.Role), PhotoURL: u.PhotoURL}
}

type AuthService struct {
	userRepo      repository.UserRepo
	emailRepo     repository.ShopkeeperEmailRepo
	tokenVerifier authn.TokenVerifier
	cfg           *config.Config
}

func NewAuthService(uRepo repository.UserRepo, eRepo repository.ShopkeeperEmailRepo, tv authn.TokenVerifier, cfg *config.Config) *AuthService {
	return &AuthService{
		userRepo:      uRepo,
		emailRepo:     eRepo,
		tokenVerifier: tv,
		cfg:           cfg,
	}
}

// GetUser loads the authenticated user for every request (RequireAuth,
// RequireSSEAuth). For a user whose stored role is shopkeeper, it also
// re-verifies their email is still on the live shopkeeper allowlist —
// without this, a removed shopkeeper's already-issued JWT would keep working
// with full shopkeeper access for up to its full 7-day life, since the
// allowlist is otherwise only ever consulted at FirebaseLogin time and the
// `role` column it writes is never re-derived on ordinary requests. A
// student's role has no equivalent revocation path (their email-domain check
// is a static config value, not a per-user list), so this only applies to
// shopkeeper.
func (s *AuthService) GetUser(ctx context.Context, id uint) (models.User, error) {
	user, err := s.userRepo.FindByID(ctx, id)
	if err != nil {
		return models.User{}, err
	}
	if user == nil {
		return models.User{}, ErrNotFound("user not found")
	}
	if user.Role == models.RoleShopkeeper {
		stillAllowed, err := s.emailRepo.Exists(ctx, user.Email)
		if err != nil {
			return models.User{}, err
		}
		if !stillAllowed {
			return models.User{}, ErrNotFound("user not found")
		}
	}
	return *user, nil
}

func (s *AuthService) FirebaseLogin(ctx context.Context, idToken string) (models.User, string, error) {
	identity, err := s.tokenVerifier.Verify(ctx, idToken)
	if err != nil {
		return models.User{}, "", ErrUnauthorized("invalid token: " + err.Error())
	}

	if identity.Email == "" {
		return models.User{}, "", ErrUnauthorized("token missing email")
	}
	if !identity.EmailVerified {
		return models.User{}, "", ErrUnauthorized("email not verified")
	}

	email := strings.ToLower(identity.Email)
	var role models.Role

	isShopkeeper, err := s.emailRepo.Exists(ctx, email)
	if err != nil {
		return models.User{}, "", err
	}

	if isShopkeeper {
		role = models.RoleShopkeeper
	} else {
		domain := ""
		parts := strings.SplitN(email, "@", 2)
		if len(parts) == 2 {
			domain = parts[1]
		}
		if domain != strings.ToLower(s.cfg.AllowedEmailDomain) {
			return models.User{}, "", ErrForbidden("Sign in with your @" + s.cfg.AllowedEmailDomain + " Google account")
		}
		role = models.RoleStudent
	}

	user, err := s.userRepo.FindByFirebaseUID(ctx, identity.UID)
	if err != nil {
		return models.User{}, "", err
	}
	if user == nil {
		user, err = s.userRepo.FindByEmail(ctx, email)
		if err != nil {
			return models.User{}, "", err
		}
		if user == nil {
			user = &models.User{
				FirebaseUID: identity.UID,
				Email:       email,
				Name:        identity.Name,
				PhotoURL:    identity.PhotoURL,
				Role:        role,
			}
		} else {
			user.FirebaseUID = identity.UID
			user.Name = identity.Name
			user.PhotoURL = identity.PhotoURL
			user.Role = role
		}
	} else {
		user.Email = email
		user.Name = identity.Name
		user.PhotoURL = identity.PhotoURL
		user.Role = role
	}

	if err := s.userRepo.Save(ctx, user); err != nil {
		return models.User{}, "", err
	}

	token, err := GenerateToken(*user, s.cfg.JWTSecret)
	if err != nil {
		return models.User{}, "", err
	}

	return *user, token, nil
}

type AuthConfigResponse struct {
	AllowedEmailDomain string `json:"allowed_email_domain"`
}

func (s *AuthService) AuthConfig() AuthConfigResponse {
	return AuthConfigResponse{
		AllowedEmailDomain: s.cfg.AllowedEmailDomain,
	}
}
