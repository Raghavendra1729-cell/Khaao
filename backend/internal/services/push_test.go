package services_test

import (
	"context"
	"testing"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/services"
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
			err := svc.Subscribe(ctx, 1, tc.endpoint, "p256dh-key", "auth-key")
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
			if err := svc.Subscribe(ctx, 1, endpoint, "p256dh-key", "auth-key"); err != nil {
				t.Fatalf("expected success, got %v", err)
			}
			if len(repo.subs) != 1 || repo.subs[0].Endpoint != endpoint {
				t.Fatalf("expected endpoint %q saved, got %+v", endpoint, repo.subs)
			}
		})
	}
}
