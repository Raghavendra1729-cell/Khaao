package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/repository"
)

// allowedPushHosts is the fixed set of hostnames a browser can ever generate
// a real Web Push subscription endpoint for. `endpoint` is otherwise a fully
// client-supplied URL that the server itself later dereferences — send()
// below makes an outbound HTTPS POST to it via webpush-go — so without this
// allowlist, Subscribe is a textbook SSRF: any authenticated user (this
// route is requireAuth only, so any student) can call POST
// /api/push/subscribe with an internal or attacker-controlled `endpoint`
// paired with a self-generated P-256 keypair. That keypair doesn't need to
// come from a real browser subscription — webpush-go's encryption step only
// checks the key is a well-formed point on the curve, which a five-line
// script can produce — so "the client must supply valid encryption keys" is
// no barrier at all. The next time a push fires for that user (e.g. their
// own order reaching "ready", which they can engineer almost at will), the
// backend POSTs to whatever host they chose.
var allowedPushHosts = map[string]bool{
	"fcm.googleapis.com":                true, // Chrome, Edge, Android WebView
	"updates.push.services.mozilla.com": true, // Firefox
	"web.push.apple.com":                true, // Safari / iOS installed PWA
}

func validatePushEndpoint(endpoint string) error {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return ErrBadRequest("invalid push endpoint")
	}
	if !allowedPushHosts[u.Hostname()] {
		return ErrBadRequest("unrecognized push endpoint")
	}
	return nil
}

// base64URLPattern is the RFC 4648 §5 base64url alphabet, lenient on
// trailing '=' padding since real subscriptions are seen both padded and
// unpadded depending on the browser/library that generated them.
var base64URLPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+=*$`)

// A real Web Push p256dh is a 65-byte uncompressed P-256 point, base64url
// encoded; auth is 16 bytes. Both ranges below are generous around the
// unpadded/padded encoded lengths (87/88 and 22/24 chars respectively) to
// tolerate minor encoder differences without accepting arbitrary junk —
// V9: p256dh/auth were previously stored verbatim at any length/charset, so
// a malformed value fails only later, per row, per send, forever, inside
// webpush-go's encryption step.
const (
	minP256dhLen = 80
	maxP256dhLen = 92
	minAuthLen   = 18
	maxAuthLen   = 26
)

func validatePushKey(fieldName, value string, minLen, maxLen int) error {
	if len(value) < minLen || len(value) > maxLen {
		return ErrBadRequest(fmt.Sprintf("invalid push subscription %s", fieldName))
	}
	if !base64URLPattern.MatchString(value) {
		return ErrBadRequest(fmt.Sprintf("invalid push subscription %s", fieldName))
	}
	return nil
}

// pushHTTPClient replaces webpush-go's default *http.Client, which has no
// timeout — a hung push endpoint would otherwise strand goroutines forever
// (send() is fired via `go` per-subscription, so nothing else waits on it,
// but an unbounded goroutine leak on every hung push service is still real).
var pushHTTPClient = &http.Client{Timeout: 10 * time.Second}

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
	if err := validatePushEndpoint(endpoint); err != nil {
		return err
	}
	if err := validatePushKey("p256dh", p256dh, minP256dhLen, maxP256dhLen); err != nil {
		return err
	}
	if err := validatePushKey("auth", auth, minAuthLen, maxAuthLen); err != nil {
		return err
	}
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
	// URL is the app-relative path notificationclick should focus/open —
	// distinct destinations per notification type (a shopkeeper's
	// new-order alert vs a student's ready-alert), instead of always
	// landing on / (R30).
	URL string `json:"url,omitempty"`
}

// newOrderPayload and orderReadyPayload are pure so the exact bytes sent to
// webpush-go are directly unit-testable without a fake push endpoint. Scalar
// params (not *models.Order) so a caller can never hand over a
// half-populated model and have it silently degrade — see STATUS.md
// § 9.6-U1, where the previous *models.Order signature always received an
// order whose .Items was nil (persisted via a separate slice, never
// assigned back), so every push read "0 item(s)".
func newOrderPayload(orderNo, itemCount int) ([]byte, error) {
	return json.Marshal(pushPayload{
		Title: "New order",
		Body:  fmt.Sprintf("Order #%d — %d item(s)", orderNo, itemCount),
		URL:   "/shop",
	})
}

func orderReadyPayload(orderNo int) ([]byte, error) {
	return json.Marshal(pushPayload{
		Title: "Order ready!",
		Body:  fmt.Sprintf("Order #%d is ready — head to the counter.", orderNo),
		URL:   "/order",
	})
}

// rejectedPayload and expiredPayload are the V5 counterparts to
// orderReadyPayload: nothing previously told a student when the shopkeeper
// rejected their order or it timed out unclaimed in the hold window — the
// two outcomes decided by someone else while their phone is in their
// pocket. Copy states what happened and what to do next, with no apology or
// blame.
func rejectedPayload(orderNo int) ([]byte, error) {
	return json.Marshal(pushPayload{
		Title: "Order couldn't be prepared",
		Body:  fmt.Sprintf("Order #%d couldn't be prepared. Nothing to pay — order again when you're ready.", orderNo),
		URL:   "/order",
	})
}

func expiredPayload(orderNo int) ([]byte, error) {
	return json.Marshal(pushPayload{
		Title: "Order expired",
		Body:  fmt.Sprintf("Order #%d wasn't collected in time and has expired. Nothing to pay — order again when you're ready.", orderNo),
		URL:   "/order",
	})
}

// NotifyNewOrder fires a best-effort push to every shopkeeper subscription so
// a new order is noticed even with the app/tab closed, not just the in-tab
// SSE sound. Each subscription is sent on its own goroutine so one
// slow/unreachable endpoint can't delay order creation or block the others.
func (s *PushService) NotifyNewOrder(ctx context.Context, orderNo, itemCount int) {
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
	payload, err := newOrderPayload(orderNo, itemCount)
	if err != nil {
		slog.Error("khaao: push: could not marshal payload", "error", err)
		return
	}
	for _, sub := range subs {
		go s.send(sub, payload)
	}
}

// NotifyOrderReady fires a best-effort push to the ordering student when
// their order transitions to ready — this is the one moment a student
// absolutely needs to notice even with the screen off/locked, and on iOS the
// in-tab SSE chime/vibration/Notification() path can't reach a backgrounded
// tab at all. Same fire-and-forget-per-subscription shape as NotifyNewOrder.
func (s *PushService) NotifyOrderReady(ctx context.Context, userID uint, orderNo int) {
	if s.cfg.VapidPublicKey == "" || s.cfg.VapidPrivateKey == "" {
		return
	}
	subs, err := s.repo.FindByUserID(ctx, userID)
	if err != nil {
		slog.Error("khaao: push: could not load student subscriptions", "user_id", userID, "error", err)
		return
	}
	if len(subs) == 0 {
		return
	}
	payload, err := orderReadyPayload(orderNo)
	if err != nil {
		slog.Error("khaao: push: could not marshal payload", "error", err)
		return
	}
	for _, sub := range subs {
		go s.send(sub, payload)
	}
}

// NotifyOrderRejected fires a best-effort push to the ordering student when
// the shopkeeper rejects their order (submitted-through-accepted). reason is
// accepted for future logging/telemetry use but is deliberately not included
// in the push body — see rejectedPayload's doc comment on the copy choice.
// Same fire-and-forget-per-subscription shape as NotifyOrderReady.
func (s *PushService) NotifyOrderRejected(ctx context.Context, userID uint, orderNo int, reason string) {
	_ = reason
	if s.cfg.VapidPublicKey == "" || s.cfg.VapidPrivateKey == "" {
		return
	}
	subs, err := s.repo.FindByUserID(ctx, userID)
	if err != nil {
		slog.Error("khaao: push: could not load student subscriptions", "user_id", userID, "error", err)
		return
	}
	if len(subs) == 0 {
		return
	}
	payload, err := rejectedPayload(orderNo)
	if err != nil {
		slog.Error("khaao: push: could not marshal payload", "error", err)
		return
	}
	for _, sub := range subs {
		go s.send(sub, payload)
	}
}

// NotifyOrderExpired fires a best-effort push to the ordering student when
// their ready order times out unclaimed past its hold window.
func (s *PushService) NotifyOrderExpired(ctx context.Context, userID uint, orderNo int) {
	if s.cfg.VapidPublicKey == "" || s.cfg.VapidPrivateKey == "" {
		return
	}
	subs, err := s.repo.FindByUserID(ctx, userID)
	if err != nil {
		slog.Error("khaao: push: could not load student subscriptions", "user_id", userID, "error", err)
		return
	}
	if len(subs) == 0 {
		return
	}
	payload, err := expiredPayload(orderNo)
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
		HTTPClient:      pushHTTPClient,
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
