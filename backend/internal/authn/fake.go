package authn

import (
	"context"
	"errors"
	"strings"
)

type FakeVerifier struct{}

func NewFakeVerifier() *FakeVerifier {
	return &FakeVerifier{}
}

func (f *FakeVerifier) Verify(ctx context.Context, idToken string) (*Identity, error) {
	if !strings.HasPrefix(idToken, "fake:") {
		return nil, errors.New("fake verifier: token must start with 'fake:'")
	}
	parts := strings.Split(strings.TrimPrefix(idToken, "fake:"), ":")
	if len(parts) == 0 || parts[0] == "" {
		return nil, errors.New("fake verifier: missing email")
	}
	email := parts[0]
	name := "Fake User"
	if len(parts) > 1 {
		name = parts[1]
	}
	return &Identity{
		UID:           "fake-" + email,
		Email:         email,
		Name:          name,
		PhotoURL:      "https://fake.url/photo.jpg",
		EmailVerified: true,
	}, nil
}
