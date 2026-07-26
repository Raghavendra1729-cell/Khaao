package services_test

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/services"
)

// validP256dh and validAuth are real-shaped (correct length, base64url
// charset) stand-ins for Web Push key material — a real p256dh is a 65-byte
// base64url-encoded P-256 point, auth is 16 bytes. They don't need to decode
// to an actual EC point: Subscribe's V9 validation only checks length and
// charset, not curve membership (webpush-go itself is what would reject a
// well-formed-but-invalid point, at send time).
var (
	validP256dh = base64.RawURLEncoding.EncodeToString(make([]byte, 65))
	validAuth   = base64.RawURLEncoding.EncodeToString(make([]byte, 16))
)

type mockPushRepo struct {
	subs []models.PushSubscription
}

func (m *mockPushRepo) Save(ctx context.Context, sub *models.PushSubscription) error {
	m.subs = append(m.subs, *sub)
	return nil
}

func (m *mockPushRepo) FindByRole(ctx context.Context, role models.Role) ([]models.PushSubscription, error) {
	return nil, nil
}

func (m *mockPushRepo) FindByUserID(ctx context.Context, userID uint) ([]models.PushSubscription, error) {
	return nil, nil
}

func (m *mockPushRepo) DeleteByEndpoint(ctx context.Context, endpoint string) error {
	return nil
}

func (m *mockPushRepo) FindByEndpoint(ctx context.Context, endpoint string) (*models.PushSubscription, error) {
	return nil, nil
}

// TestPushSubscribeRejectsUnrecognizedEndpoint guards against the SSRF this
// validation closes: Subscribe used to accept any client-supplied `endpoint`
// with zero checks, and send() later makes a real outbound HTTPS POST to it
// (via webpush-go) whenever a push fires for that user. A crafted-but-valid
// P-256 keypair is trivial to generate and isn't tied to any real browser,
// so "the client supplied valid encryption keys" was never a real barrier —
// only endpoint-host validation actually closes this.
func TestPushSubscribeRejectsUnrecognizedEndpoint(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name     string
		endpoint string
	}{
		{"cloud metadata endpoint", "http://169.254.169.254/latest/meta-data/"},
		{"internal https host", "https://internal.example.local:8080/webhook"},
		{"localhost", "https://localhost:9000/x"},
		{"not a url", "not-a-url"},
		{"http scheme even to a real push host", "http://fcm.googleapis.com/fcm/send/abc"},
		{"host-confusable lookalike", "https://fcm.googleapis.com.evil.example/x"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &mockPushRepo{}
			svc := services.NewPushService(&config.Config{}, repo)
			err := svc.Subscribe(ctx, 1, tc.endpoint, validP256dh, validAuth)
			appErr := asAppError(t, err)
			if appErr == nil || appErr.Status != 400 {
				t.Errorf("%s: expected 400 bad request, got %v", tc.name, err)
			}
			if len(repo.subs) != 0 {
				t.Errorf("%s: expected no subscription saved, got %d", tc.name, len(repo.subs))
			}
		})
	}
}

func TestPushSubscribeAllowsKnownPushHosts(t *testing.T) {
	ctx := context.Background()

	endpoints := []string{
		"https://fcm.googleapis.com/fcm/send/abc123",
		"https://updates.push.services.mozilla.com/wpush/v2/abc123",
		"https://web.push.apple.com/abc123",
	}

	for _, endpoint := range endpoints {
		t.Run(endpoint, func(t *testing.T) {
			repo := &mockPushRepo{}
			svc := services.NewPushService(&config.Config{}, repo)
			if err := svc.Subscribe(ctx, 1, endpoint, validP256dh, validAuth); err != nil {
				t.Fatalf("expected success, got %v", err)
			}
			if len(repo.subs) != 1 || repo.subs[0].Endpoint != endpoint {
				t.Fatalf("expected endpoint %q saved, got %+v", endpoint, repo.subs)
			}
		})
	}
}

// TestPushSubscribeValidatesKeyMaterial guards V9: p256dh/auth used to be
// stored verbatim at any length/charset, so a junk value only failed later —
// per subscription row, per send, forever — deep inside webpush-go's
// encryption step. Length and base64url-charset checks at Subscribe time
// catch it immediately instead, with a normal 400.
func TestPushSubscribeValidatesKeyMaterial(t *testing.T) {
	ctx := context.Background()
	const endpoint = "https://fcm.googleapis.com/fcm/send/abc123"

	cases := []struct {
		name         string
		p256dh, auth string
	}{
		{"p256dh far too short", "AAAA", validAuth},
		{"p256dh far too long", strings.Repeat("A", 300), validAuth},
		{"p256dh not base64url", strings.Repeat("!", 87), validAuth},
		{"auth far too short", validP256dh, "AA"},
		{"auth far too long", validP256dh, strings.Repeat("B", 100)},
		{"auth not base64url", validP256dh, strings.Repeat("*", 22)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &mockPushRepo{}
			svc := services.NewPushService(&config.Config{}, repo)
			err := svc.Subscribe(ctx, 1, endpoint, tc.p256dh, tc.auth)
			appErr := asAppError(t, err)
			if appErr == nil || appErr.Status != 400 {
				t.Errorf("%s: expected 400 bad request, got %v", tc.name, err)
			}
			if len(repo.subs) != 0 {
				t.Errorf("%s: expected no subscription saved, got %d", tc.name, len(repo.subs))
			}
		})
	}
}

// TestPushSubscribeAcceptsRealShapedKeys is the accept-path mirror of
// TestPushSubscribeValidatesKeyMaterial: a real-shaped 65-byte p256dh /
// 16-byte auth pair, base64url encoded, must still be accepted.
func TestPushSubscribeAcceptsRealShapedKeys(t *testing.T) {
	ctx := context.Background()
	repo := &mockPushRepo{}
	svc := services.NewPushService(&config.Config{}, repo)

	err := svc.Subscribe(ctx, 1, "https://fcm.googleapis.com/fcm/send/abc123", validP256dh, validAuth)
	if err != nil {
		t.Fatalf("expected success with real-shaped key material, got %v", err)
	}
	if len(repo.subs) != 1 {
		t.Fatalf("expected subscription saved, got %d", len(repo.subs))
	}
}
