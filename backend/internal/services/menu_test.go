package services_test

import (
	"context"
	"testing"

	"khaao/internal/services"
)

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
