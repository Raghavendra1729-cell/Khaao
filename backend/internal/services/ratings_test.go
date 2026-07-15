package services_test

import (
	"context"
	"testing"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/repository"
	"khaao/internal/services"
)

func TestRatingsService(t *testing.T) {
	ctx := context.Background()

	t.Run("rating_completed_order", func(t *testing.T) {
		orderRepo := &mockOrderRepo{
			orders: map[uint]*models.Order{
				1: {
					ID: 1, UserID: 10, Status: models.OrderCompleted,
					Items: []models.OrderItem{
						{ID: 101, MenuItemID: 5},
						{ID: 102, MenuItemID: 6},
					},
				},
			},
		}
		ratingRepo := &mockRatingRepo{}
		svc := services.NewRatingsService(ratingRepo, orderRepo)

		err := svc.SubmitRatings(ctx, 1, 10, []services.RatingInput{
			{OrderItemID: 101, Stars: 5},
			{OrderItemID: 102, Stars: 4},
		})
		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		if len(ratingRepo.ratings) != 2 {
			t.Errorf("expected 2 ratings saved, got %d", len(ratingRepo.ratings))
		}
	})

	t.Run("rating_non_completed_order", func(t *testing.T) {
		orderRepo := &mockOrderRepo{
			orders: map[uint]*models.Order{
				2: {ID: 2, UserID: 10, Status: models.OrderReady},
			},
		}
		ratingRepo := &mockRatingRepo{}
		svc := services.NewRatingsService(ratingRepo, orderRepo)

		err := svc.SubmitRatings(ctx, 2, 10, []services.RatingInput{{OrderItemID: 101, Stars: 5}})
		appErr := asAppError(t, err)
		if appErr == nil || appErr.Status != 409 {
			t.Errorf("expected 409 conflict, got %v", err)
		}
	})

	t.Run("rating_someone_elses_order", func(t *testing.T) {
		orderRepo := &mockOrderRepo{
			orders: map[uint]*models.Order{
				3: {ID: 3, UserID: 10, Status: models.OrderCompleted},
			},
		}
		ratingRepo := &mockRatingRepo{}
		svc := services.NewRatingsService(ratingRepo, orderRepo)

		err := svc.SubmitRatings(ctx, 3, 11, []services.RatingInput{{OrderItemID: 101, Stars: 5}})
		appErr := asAppError(t, err)
		if appErr == nil || appErr.Status != 403 {
			t.Errorf("expected 403 forbidden, got %v", err)
		}
	})

	t.Run("invalid_stars", func(t *testing.T) {
		orderRepo := &mockOrderRepo{
			orders: map[uint]*models.Order{
				4: {
					ID: 4, UserID: 10, Status: models.OrderCompleted,
					Items: []models.OrderItem{{ID: 101, MenuItemID: 5}},
				},
			},
		}
		ratingRepo := &mockRatingRepo{}
		svc := services.NewRatingsService(ratingRepo, orderRepo)

		err := svc.SubmitRatings(ctx, 4, 10, []services.RatingInput{{OrderItemID: 101, Stars: 6}})
		appErr := asAppError(t, err)
		if appErr == nil || appErr.Status != 400 {
			t.Errorf("expected 400 bad request, got %v", err)
		}
	})

	t.Run("invalid_order_item", func(t *testing.T) {
		orderRepo := &mockOrderRepo{
			orders: map[uint]*models.Order{
				5: {
					ID: 5, UserID: 10, Status: models.OrderCompleted,
					Items: []models.OrderItem{{ID: 101, MenuItemID: 5}},
				},
			},
		}
		ratingRepo := &mockRatingRepo{}
		svc := services.NewRatingsService(ratingRepo, orderRepo)

		err := svc.SubmitRatings(ctx, 5, 10, []services.RatingInput{{OrderItemID: 999, Stars: 5}})
		appErr := asAppError(t, err)
		if appErr == nil || appErr.Status != 400 {
			t.Errorf("expected 400 bad request, got %v", err)
		}
	})
}

func TestMenuAggregatesQuery(t *testing.T) {
	// Let's test the aggregates inside MenuService instead,
	// because the SQL query for GetMenuAggregates is tested in integration tests,
	// but we can at least test the service correctly merges them.
	ctx := context.Background()

	menuRepo := &mockMenuRepo{
		items: []models.MenuItem{
			{ID: 1, Name: "Item 1"},
			{ID: 2, Name: "Item 2"},
		},
	}
	orderRepo := &mockOrderRepo{orders: make(map[uint]*models.Order)}
	ratingRepo := &mockRatingRepo{
		aggs: map[uint]repository.MenuRatingAggregate{
			1: {AvgRating: 4.5, RatingCount: 10},
			2: {AvgRating: 0, RatingCount: 0},
		},
	}

	// This is a bit hacky to use newMenuService since it expects mockRatingRepo inside it.
	svc := services.NewMenuService(menuRepo, orderRepo, ratingRepo, nil, &config.Config{})
	
	items, err := svc.ListAll(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	
	for _, it := range items {
		if it.ID == 1 {
			if it.AvgRating != 4.5 || it.RatingCount != 10 {
				t.Errorf("item 1 aggregates mismatch: %v", it)
			}
		}
		if it.ID == 2 {
			if it.AvgRating != 0 || it.RatingCount != 0 {
				t.Errorf("item 2 aggregates mismatch: %v", it)
			}
		}
	}
}
