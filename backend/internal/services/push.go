package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	webpush "github.com/SherClockHolmes/webpush-go"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/repository"
)

type PushService struct {
	cfg  *config.Config
	repo repository.PushRepo
}

func NewPushService(cfg *config.Config, repo repository.PushRepo) *PushService {
	return &PushService{cfg: cfg, repo: repo}
}

// Subscribe saves a shopkeeper's Web Push subscription. Re-subscribing the
// same browser endpoint (e.g. after a reload) updates the existing row
// instead of violating the endpoint's unique index.
func (s *PushService) Subscribe(ctx context.Context, userID uint, endpoint, p256dh, auth string) error {
	existing, err := s.repo.FindByEndpoint(ctx, endpoint)
	if err != nil {
		return err
	}
	sub := &models.PushSubscription{
		UserID:   userID,
		Endpoint: endpoint,
		P256dh:   p256dh,
		Auth:     auth,
	}
	if existing != nil {
		sub.ID = existing.ID
	}
	return s.repo.Save(ctx, sub)
}

type pushPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// NotifyNewOrder fires a best-effort push to every shopkeeper subscription so
// a new order is noticed even with the app/tab closed, not just the in-tab
// SSE sound. Each subscription is sent on its own goroutine so one
// slow/unreachable endpoint can't delay order creation or block the others.
func (s *PushService) NotifyNewOrder(ctx context.Context, order *models.Order) {
	if s.cfg.VapidPublicKey == "" || s.cfg.VapidPrivateKey == "" {
		return
	}
	subs, err := s.repo.FindByRole(ctx, models.RoleShopkeeper)
	if err != nil {
		slog.Error("khaao: push: could not load shopkeeper subscriptions", "error", err)
		return
	}
	if len(subs) == 0 {
		return
	}
	payload, err := json.Marshal(pushPayload{
		Title: "New order",
		Body:  fmt.Sprintf("Order #%d — %d item(s)", order.OrderNo, len(order.Items)),
	})
	if err != nil {
		slog.Error("khaao: push: could not marshal payload", "error", err)
		return
	}
	for _, sub := range subs {
		go s.send(sub, payload)
	}
}

// send delivers one push message. It deliberately does not take the
// request's context — the goroutine must be able to finish after the HTTP
// handler that triggered it has already returned.
func (s *PushService) send(sub models.PushSubscription, payload []byte) {
	resp, err := webpush.SendNotification(payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256dh,
			Auth:   sub.Auth,
		},
	}, &webpush.Options{
		Subscriber:      s.cfg.VapidSubject,
		VAPIDPublicKey:  s.cfg.VapidPublicKey,
		VAPIDPrivateKey: s.cfg.VapidPrivateKey,
		TTL:             60,
	})
	if err != nil {
		slog.Warn("khaao: push: send to endpoint failed", "error", err)
		return
	}
	defer resp.Body.Close()
	// 404/410 mean the push service considers the subscription gone (the
	// browser unsubscribed or the endpoint expired) — stop wasting effort on
	// it rather than retrying forever.
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
		if delErr := s.repo.DeleteByEndpoint(context.Background(), sub.Endpoint); delErr != nil {
			slog.Warn("khaao: push: could not clean up dead subscription", "error", delErr)
		}
	}
}
