package services

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestNewOrderPayloadIncludesShopURL and TestOrderReadyPayloadIncludesOrderURL
// guard the R30 fix: notificationclick used to always open "/" regardless of
// which kind of alert was tapped. Each notification type must carry its own
// app-relative target so a shopkeeper's new-order alert opens /shop and a
// student's ready-alert opens /order.
func TestNewOrderPayloadIncludesShopURL(t *testing.T) {
	raw, err := newOrderPayload(42, 3)
	if err != nil {
		t.Fatalf("newOrderPayload: %v", err)
	}

	var got pushPayload
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}

	if got.URL != "/shop" {
		t.Errorf("URL = %q, want /shop", got.URL)
	}
	if got.Title == "" || got.Body == "" {
		t.Errorf("expected non-empty title/body, got %+v", got)
	}
	// STATUS.md § 9.6-U1: the caller used to always pass an order whose
	// .Items was nil, so this count was silently always 0 — assert the
	// count the function was actually given shows up verbatim, not just
	// that the body is non-empty.
	if !strings.Contains(got.Body, "3 item(s)") {
		t.Errorf("body = %q, want it to contain the item count %q", got.Body, "3 item(s)")
	}
}

func TestOrderReadyPayloadIncludesOrderURL(t *testing.T) {
	raw, err := orderReadyPayload(7)
	if err != nil {
		t.Fatalf("orderReadyPayload: %v", err)
	}

	var got pushPayload
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}

	if got.URL != "/order" {
		t.Errorf("URL = %q, want /order", got.URL)
	}
	if got.Title == "" || got.Body == "" {
		t.Errorf("expected non-empty title/body, got %+v", got)
	}
}
