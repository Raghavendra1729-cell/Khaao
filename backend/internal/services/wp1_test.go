package services_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/repository"
	"khaao/internal/services"
)

// engineWithShopState builds a PoolEngine whose shop-status singleton is fixed
// to the given state, for the order-creation guard tests.
func engineWithShopState(state string) *services.PoolEngine {
	uow := &mockUoW{}
	orderRepo := &mockOrderRepo{orders: make(map[uint]*models.Order)}
	menuRepo := &mockMenuRepo{}
	poolRepo := &mockPoolRepo{pool: make(map[uint]int)}
	eventRepo := &mockEventRepo{}
	statusRepo := &mockShopStatusRepo{status: &models.ShopStatus{ID: 1, State: state}}
	hub := realtime.NewHub()
	cfg := &config.Config{HoldMinutes: 10}
	alloc := &services.FCFSAllocation{}
	return services.NewPoolEngine(uow, orderRepo, menuRepo, poolRepo, eventRepo, statusRepo, hub, cfg, alloc)
}

func asAppError(t *testing.T, err error) *services.AppError {
	t.Helper()
	var appErr *services.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("expected *services.AppError, got %T (%v)", err, err)
	}
	return appErr
}

func TestShopStatusGuard(t *testing.T) {
	ctx := context.Background()
	hub := realtime.NewHub()

	t.Run("allowed_when_no_active_orders", func(t *testing.T) {
		orderRepo := &mockOrderRepo{orders: make(map[uint]*models.Order)}
		statusRepo := &mockShopStatusRepo{status: &models.ShopStatus{ID: 1, State: string(models.ShopOpen)}}
		svc := services.NewShopStatusService(statusRepo, orderRepo, &mockUoW{}, hub)

		reopen := time.Now().Add(30 * time.Minute)
		resp, err := svc.Set(ctx, "paused", &reopen)
		if err != nil {
			t.Fatalf("pause should be allowed with no active orders, got %v", err)
		}
		if resp.State != "paused" {
			t.Errorf("state = %q, want paused", resp.State)
		}
		if resp.ReopenAt == nil {
			t.Errorf("reopen_at should be set for paused")
		}

		// Setting open must clear reopen_at.
		resp, err = svc.Set(ctx, "open", nil)
		if err != nil {
			t.Fatalf("open should always be allowed, got %v", err)
		}
		if resp.State != "open" || resp.ReopenAt != nil {
			t.Errorf("open should clear reopen_at, got state=%q reopen=%v", resp.State, resp.ReopenAt)
		}
	})

	t.Run("blocked_with_active_orders", func(t *testing.T) {
		orderRepo := &mockOrderRepo{orders: map[uint]*models.Order{
			1: {ID: 1, Status: models.OrderPreparing},
			2: {ID: 2, Status: models.OrderAwaitingPayment},
			3: {ID: 3, Status: models.OrderCompleted}, // terminal, not counted
		}}
		statusRepo := &mockShopStatusRepo{status: &models.ShopStatus{ID: 1, State: string(models.ShopOpen)}}
		svc := services.NewShopStatusService(statusRepo, orderRepo, &mockUoW{}, hub)

		_, err := svc.Set(ctx, "closed", nil)
		appErr := asAppError(t, err)
		if appErr.Status != 409 {
			t.Errorf("status = %d, want 409", appErr.Status)
		}
		if appErr.Message != "Finish or cancel the 2 accepted order(s) first." {
			t.Errorf("message = %q", appErr.Message)
		}

		// pause is guarded the same way
		reopen := time.Now().Add(time.Hour)
		if _, err := svc.Set(ctx, "paused", &reopen); err == nil {
			t.Errorf("pause should be blocked with active orders")
		}
	})

	t.Run("invalid_state", func(t *testing.T) {
		orderRepo := &mockOrderRepo{orders: make(map[uint]*models.Order)}
		statusRepo := &mockShopStatusRepo{status: &models.ShopStatus{ID: 1, State: string(models.ShopOpen)}}
		svc := services.NewShopStatusService(statusRepo, orderRepo, &mockUoW{}, hub)
		_, err := svc.Set(ctx, "sleeping", nil)
		if appErr := asAppError(t, err); appErr.Status != 400 {
			t.Errorf("status = %d, want 400", appErr.Status)
		}
	})
}

func TestCreateOrderBlockedWhenNotOpen(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		state   string
		wantMsg string
	}{
		{"closed", "The canteen is closed."},
		{"paused", "The canteen is on a break."},
	}
	for _, tc := range cases {
		t.Run(tc.state, func(t *testing.T) {
			engine := engineWithShopState(tc.state)
			_, err := engine.CreateOrder(ctx, 1, []services.OrderItemInput{{MenuItemID: 10, Qty: 1}})
			appErr := asAppError(t, err)
			if appErr.Status != 409 {
				t.Errorf("status = %d, want 409", appErr.Status)
			}
			if appErr.Message != tc.wantMsg {
				t.Errorf("message = %q, want %q", appErr.Message, tc.wantMsg)
			}
		})
	}

	t.Run("open_allows", func(t *testing.T) {
		engine := engineWithShopState("open")
		if _, err := engine.CreateOrder(ctx, 1, []services.OrderItemInput{{MenuItemID: 10, Qty: 1}}); err != nil {
			t.Fatalf("open shop should allow order creation, got %v", err)
		}
	})
}

type mockRatingRepo struct {
	ratings []models.ItemRating
	aggs    map[uint]repository.MenuRatingAggregate
}

func (m *mockRatingRepo) SaveAll(ctx context.Context, ratings []models.ItemRating) error {
	m.ratings = append(m.ratings, ratings...)
	return nil
}

func (m *mockRatingRepo) GetMenuAggregates(ctx context.Context) (map[uint]repository.MenuRatingAggregate, error) {
	if m.aggs == nil {
		return make(map[uint]repository.MenuRatingAggregate), nil
	}
	return m.aggs, nil
}

func newMenuService() (*services.MenuService, *mockOrderRepo, *mockMenuRepo) {
	menuRepo := &mockMenuRepo{}
	orderRepo := &mockOrderRepo{orders: make(map[uint]*models.Order)}
	ratingRepo := &mockRatingRepo{}
	poolRepo := &mockPoolRepo{pool: make(map[uint]int)}
	hub := realtime.NewHub()
	cfg := &config.Config{}
	return services.NewMenuService(menuRepo, orderRepo, ratingRepo, poolRepo, &mockUoW{}, hub, cfg), orderRepo, menuRepo
}

func TestMenuCreateRequiresDiet(t *testing.T) {
	ctx := context.Background()
	svc, _, _ := newMenuService()

	if _, err := svc.Create(ctx, services.MenuItemInput{Name: "Chai", Price: 1000}); asAppError(t, err).Status != 400 {
		t.Errorf("missing diet must be 400")
	}
	if _, err := svc.Create(ctx, services.MenuItemInput{Name: "Chai", Price: 1000, Diet: "vegan"}); asAppError(t, err).Status != 400 {
		t.Errorf("invalid diet must be 400")
	}

	resp, err := svc.Create(ctx, services.MenuItemInput{
		Name: "Cold Coffee", Price: 3000, Diet: "veg",
		Tags: []string{" Juice ", "juice", "", "Cold"},
	})
	if err != nil {
		t.Fatalf("valid create failed: %v", err)
	}
	if resp.Diet != "veg" {
		t.Errorf("diet = %q, want veg", resp.Diet)
	}
	// trimmed, blank-dropped, case-insensitively de-duped, order preserved
	if len(resp.Tags) != 2 || resp.Tags[0] != "Juice" || resp.Tags[1] != "Cold" {
		t.Errorf("tags = %#v, want [Juice Cold]", resp.Tags)
	}
	if resp.OrderCountToday != 0 {
		t.Errorf("order_count_today = %d, want 0 for a new item", resp.OrderCountToday)
	}
}

func TestOrderCountTodayAggregation(t *testing.T) {
	ctx := context.Background()
	svc, orderRepo, menuRepo := newMenuService()
	menuRepo.items = []models.MenuItem{
		{ID: 1, Name: "A", Price: 1000, IsAvailable: true, Diet: "veg"},
		{ID: 2, Name: "B", Price: 2000, IsAvailable: true, Diet: "non_veg"},
		{ID: 3, Name: "C", Price: 1500, IsAvailable: true, Diet: "veg"},
	}
	orderRepo.sumOverride = map[uint]int{1: 5, 2: 0} // C absent -> 0

	items, err := svc.ListAll(ctx)
	if err != nil {
		t.Fatalf("ListAll: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("got %d items, want 3", len(items))
	}
	want := map[string]int{"A": 5, "B": 0, "C": 0}
	for _, it := range items {
		if it.OrderCountToday != want[it.Name] {
			t.Errorf("%s order_count_today = %d, want %d", it.Name, it.OrderCountToday, want[it.Name])
		}
		if it.Tags == nil {
			t.Errorf("%s tags must serialize as [] not nil", it.Name)
		}
		if it.Diet == "" {
			t.Errorf("%s diet must be non-empty", it.Name)
		}
	}
}

func TestHistoryInsightsMath(t *testing.T) {
	ctx := context.Background()
	const date = "2026-07-14"
	orderRepo := &mockOrderRepo{
		orders: make(map[uint]*models.Order),
		terminalByDate: map[string][]models.Order{
			date: {
				{
					ID: 1, Status: models.OrderCompleted, Paid: true, TotalPrice: 7000,
					User: models.User{Name: "Alice"},
					Items: []models.OrderItem{
						{Name: "Cold Coffee", Qty: 2, Status: models.ItemHandedOver},
						{Name: "Samosa", Qty: 1, Status: models.ItemHandedOver},
					},
				},
				{
					ID: 2, Status: models.OrderCompleted, Paid: true, TotalPrice: 3000,
					User: models.User{Name: "Bob"},
					Items: []models.OrderItem{
						{Name: "Cold Coffee", Qty: 1, Status: models.ItemHandedOver},
						{Name: "Chai", Qty: 5, Status: models.ItemRejected}, // trimmed, excluded
					},
				},
				{
					ID: 3, Status: models.OrderRejected, Paid: false, TotalPrice: 0,
					User:  models.User{Name: "Carol"},
					Items: []models.OrderItem{{Name: "Cold Coffee", Qty: 9, Status: models.ItemRejected}},
				},
				{
					ID: 4, Status: models.OrderCompleted, Paid: true, TotalPrice: 1000,
					User:  models.User{Name: "Alice"},
					Items: []models.OrderItem{{Name: "Chai", Qty: 1, Status: models.ItemHandedOver}},
				},
			},
		},
	}
	svc := services.NewOrderService(orderRepo)

	orders, totalPaid, insights, err := svc.ShopHistory(ctx, date)
	if err != nil {
		t.Fatalf("ShopHistory: %v", err)
	}
	if len(orders) != 4 {
		t.Errorf("orders len = %d, want 4 (all terminal)", len(orders))
	}
	if totalPaid != 11000 {
		t.Errorf("total_paid = %d, want 11000", totalPaid)
	}
	if insights.OrderCount != 3 {
		t.Errorf("order_count = %d, want 3 (completed only)", insights.OrderCount)
	}

	wantItems := []services.HistoryItemCount{
		{Name: "Cold Coffee", Qty: 3},
		{Name: "Chai", Qty: 1},
		{Name: "Samosa", Qty: 1},
	}
	if len(insights.ItemCounts) != len(wantItems) {
		t.Fatalf("item_counts = %#v, want %#v", insights.ItemCounts, wantItems)
	}
	for i, w := range wantItems {
		if insights.ItemCounts[i] != w {
			t.Errorf("item_counts[%d] = %#v, want %#v", i, insights.ItemCounts[i], w)
		}
	}

	wantCust := []services.HistoryCustomer{
		{Name: "Alice", OrderCount: 2},
		{Name: "Bob", OrderCount: 1},
	}
	if len(insights.Customers) != len(wantCust) {
		t.Fatalf("customers = %#v, want %#v", insights.Customers, wantCust)
	}
	for i, w := range wantCust {
		if insights.Customers[i] != w {
			t.Errorf("customers[%d] = %#v, want %#v", i, insights.Customers[i], w)
		}
	}
}

// TestShopHistoryResponseCappedButInsightsFull verifies the response-list
// cap (R13) only trims what's returned for display — totalPaid and
// insights.OrderCount must still reflect every order that day, not just the
// capped slice, or a busy day would silently under-report revenue/counts.
func TestShopHistoryResponseCappedButInsightsFull(t *testing.T) {
	ctx := context.Background()
	const date = "2026-07-14"
	const totalOrders = 250 // more than shopHistoryResponseLimit (200)

	orders := make([]models.Order, 0, totalOrders)
	for i := 0; i < totalOrders; i++ {
		orders = append(orders, models.Order{
			ID: uint(i + 1), Status: models.OrderCompleted, Paid: true, TotalPrice: 100,
			User:  models.User{Name: "Student"},
			Items: []models.OrderItem{{Name: "Chai", Qty: 1, Status: models.ItemHandedOver}},
		})
	}
	orderRepo := &mockOrderRepo{
		orders:         make(map[uint]*models.Order),
		terminalByDate: map[string][]models.Order{date: orders},
	}
	svc := services.NewOrderService(orderRepo)

	resp, totalPaid, insights, err := svc.ShopHistory(ctx, date)
	if err != nil {
		t.Fatalf("ShopHistory: %v", err)
	}
	if len(resp) != 200 {
		t.Errorf("response list len = %d, want capped to 200", len(resp))
	}
	if totalPaid != totalOrders*100 {
		t.Errorf("total_paid = %d, want %d (must cover every order, not just the capped list)", totalPaid, totalOrders*100)
	}
	if insights.OrderCount != totalOrders {
		t.Errorf("order_count = %d, want %d (must cover every order, not just the capped list)", insights.OrderCount, totalOrders)
	}
}
