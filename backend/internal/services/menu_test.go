package services_test

import (
	"context"
	"testing"

	"khaao/internal/models"
	"khaao/internal/services"
)

// TestMenuListAvailableCache verifies the short-TTL response cache added to
// guard against thundering-herd refetches at rush hour: a read within the
// TTL must be served from cache (not recomputed from the repo), and a
// mutation through the service must invalidate it immediately regardless of
// the TTL.
func TestMenuListAvailableCache(t *testing.T) {
	ctx := context.Background()
	svc, _, menuRepo := newMenuService()

	menuRepo.items = []models.MenuItem{
		{ID: 1, Name: "Chai", Price: 100, IsAvailable: true},
	}

	first, err := svc.ListAvailable(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(first) != 1 {
		t.Fatalf("expected 1 item, got %d", len(first))
	}

	// Simulate a DB change that bypasses the service entirely (a different
	// request in flight) — within the TTL, ListAvailable must still serve
	// the cached response instead of recomputing.
	menuRepo.items = append(menuRepo.items, models.MenuItem{ID: 2, Name: "Samosa", Price: 200, IsAvailable: true})

	cached, err := svc.ListAvailable(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cached) != 1 {
		t.Fatalf("expected cached response with 1 item, got %d", len(cached))
	}

	// A mutation through the service invalidates the cache immediately.
	if _, err := svc.SetStock(ctx, 1, true); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	fresh, err := svc.ListAvailable(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(fresh) != 2 {
		t.Fatalf("expected fresh response with 2 items after invalidation, got %d", len(fresh))
	}
}

func TestMenuAvailWindowWarning(t *testing.T) {
	ctx := context.Background()

	t.Run("both avail_from/avail_to nil", func(t *testing.T) {
		svc, _, _ := newMenuService()
		resp, err := svc.Create(ctx, services.MenuItemInput{
			Name:      "Chai",
			Price:     100,
			Diet:      "veg",
			AvailFrom: nil,
			AvailTo:   nil,
		})
		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		if resp.AvailWindowWarning != "" {
			t.Errorf("expected empty AvailWindowWarning, got %q", resp.AvailWindowWarning)
		}
	})

	t.Run("forward same-day window", func(t *testing.T) {
		svc, _, _ := newMenuService()
		from := "09:00"
		to := "18:00"
		resp, err := svc.Create(ctx, services.MenuItemInput{
			Name:      "Chai",
			Price:     100,
			Diet:      "veg",
			AvailFrom: &from,
			AvailTo:   &to,
		})
		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		if resp.AvailWindowWarning != "" {
			t.Errorf("expected empty AvailWindowWarning, got %q", resp.AvailWindowWarning)
		}
	})

	t.Run("backwards-looking window", func(t *testing.T) {
		svc, _, _ := newMenuService()
		from := "18:00"
		to := "09:00"
		resp, err := svc.Create(ctx, services.MenuItemInput{
			Name:      "Chai",
			Price:     100,
			Diet:      "veg",
			AvailFrom: &from,
			AvailTo:   &to,
		})
		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		if resp.AvailWindowWarning == "" {
			t.Error("expected non-empty AvailWindowWarning, got empty")
		}
	})

	t.Run("equal from and to", func(t *testing.T) {
		svc, _, _ := newMenuService()
		from := "10:00"
		to := "10:00"
		resp, err := svc.Create(ctx, services.MenuItemInput{
			Name:      "Chai",
			Price:     100,
			Diet:      "veg",
			AvailFrom: &from,
			AvailTo:   &to,
		})
		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		if resp.AvailWindowWarning == "" {
			t.Error("expected non-empty AvailWindowWarning, got empty")
		}
	})
}
