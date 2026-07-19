package services

import (
	"encoding/json"
	"testing"

	"khaao/internal/models"
)

// TestNewOrderPayloadIncludesShopURL and TestOrderReadyPayloadIncludesOrderURL
// guard the R30 fix: notificationclick used to always open "/" regardless of
// which kind of alert was tapped. Each notification type must carry its own
// app-relative target so a shopkeeper's new-order alert opens /shop and a
// student's ready-alert opens /order.
func TestNewOrderPayloadIncludesShopURL(t *testing.T) {
	order := &models.Order{
		OrderNo: 42,
		Items:   []models.OrderItem{{}, {}},
	}

	raw, err := newOrderPayload(order)
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
