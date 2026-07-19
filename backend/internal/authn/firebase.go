package authn

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type FirebaseVerifier struct {
	projectID string
	client    *http.Client
	
	mu        sync.RWMutex
	keys      map[string]*x509.Certificate
	expiresAt time.Time
}

func NewFirebaseVerifier(projectID string) *FirebaseVerifier {
	return &FirebaseVerifier{
		projectID: projectID,
		client:    &http.Client{Timeout: 5 * time.Second},
	}
}

func (v *FirebaseVerifier) Verify(ctx context.Context, idToken string) (*Identity, error) {
	token, err := jwt.Parse(idToken, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		kid, ok := token.Header["kid"].(string)
		if !ok {
			return nil, errors.New("missing kid header")
		}
		cert, err := v.getCert(ctx, kid)
		if err != nil {
			return nil, err
		}
		return cert.PublicKey, nil
	}, jwt.WithAudience(v.projectID), jwt.WithIssuer("https://securetoken.google.com/"+v.projectID), jwt.WithExpirationRequired())
	
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token claims")
	}

	sub, _ := claims["sub"].(string)
	if sub == "" {
		return nil, errors.New("missing sub claim")
	}
	email, _ := claims["email"].(string)
	if email == "" {
		return nil, errors.New("missing email claim")
	}
	emailVerified, _ := claims["email_verified"].(bool)
	name, _ := claims["name"].(string)
	photoURL, _ := claims["picture"].(string)

	return &Identity{
		UID:           sub,
		Email:         email,
		Name:          name,
		PhotoURL:      photoURL,
		EmailVerified: emailVerified,
	}, nil
}

func (v *FirebaseVerifier) getCert(ctx context.Context, kid string) (*x509.Certificate, error) {
	v.mu.RLock()
	if time.Now().Before(v.expiresAt) && v.keys != nil {
		if cert, ok := v.keys[kid]; ok {
			v.mu.RUnlock()
			return cert, nil
		}
	}
	v.mu.RUnlock()

	v.mu.Lock()
	defer v.mu.Unlock()

	// Double check
	if time.Now().Before(v.expiresAt) && v.keys != nil {
		if cert, ok := v.keys[kid]; ok {
			return cert, nil
		}
	}

	req, err := http.NewRequestWithContext(ctx, "GET", "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com", nil)
	if err != nil {
		return nil, err
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch certs: status %d", resp.StatusCode)
	}

	var certMap map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&certMap); err != nil {
		return nil, err
	}

	parsedKeys := make(map[string]*x509.Certificate)
	for k, v := range certMap {
		block, _ := pem.Decode([]byte(v))
		if block == nil {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err == nil {
			parsedKeys[k] = cert
		}
	}
	v.keys = parsedKeys

	// Cache control
	cc := resp.Header.Get("Cache-Control")
	maxAge := time.Hour // fallback
	for _, p := range strings.Split(cc, ",") {
		p = strings.TrimSpace(p)
		if strings.HasPrefix(p, "max-age=") {
			var secs int
			// secs stays 0 on a parse failure, which the size check below
			// already treats as "ignore, keep the fallback" — no separate
			// error handling needed.
			_, _ = fmt.Sscanf(p, "max-age=%d", &secs)
			if secs > 0 {
				maxAge = time.Duration(secs) * time.Second
			}
		}
	}
	v.expiresAt = time.Now().Add(maxAge)

	if cert, ok := v.keys[kid]; ok {
		return cert, nil
	}
	return nil, errors.New("kid not found in Google certs")
}
