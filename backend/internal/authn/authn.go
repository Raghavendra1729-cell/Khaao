package authn

import "context"

type Identity struct {
	UID           string
	Email         string
	Name          string
	PhotoURL      string
	EmailVerified bool
}

type TokenVerifier interface {
	Verify(ctx context.Context, idToken string) (*Identity, error)
}
