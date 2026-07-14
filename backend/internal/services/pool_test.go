package services_test

import (
	"context"
	"testing"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/services"
)

type mockUoW struct{}

func (m *mockUoW) WithTx(ctx context.Context, fn func(context.Context) error) error {
	return fn(ctx)
}

type mockOrderRepo struct {
	orders map[uint]*models.Order
	// terminalByDate lets a test stub FindTerminalByDate directly.
	terminalByDate map[string][]models.Order
	// sumOverride lets a test stub SumOrderedQtyByDate directly, bypassing the
	// in-memory computation over orders.
	sumOverride map[uint]int
}

func (m *mockOrderRepo) Create(ctx context.Context, o *models.Order) error {
	o.ID = uint(len(m.orders) + 1)
	m.orders[o.ID] = o
	return nil
}
func (m *mockOrderRepo) Save(ctx context.Context, o *models.Order) error {
	m.orders[o.ID] = o
	return nil
}
func (m *mockOrderRepo) SaveItem(ctx context.Context, i *models.OrderItem) error { return nil }
func (m *mockOrderRepo) FindByID(ctx context.Context, id uint) (*models.Order, error) {
	return m.orders[id], nil
}
func (m *mockOrderRepo) FindByIDForUpdate(ctx context.Context, id uint) (*models.Order, error) {
	return m.FindByID(ctx, id)
}
func (m *mockOrderRepo) FindActiveByUserID(ctx context.Context, uid uint) (*models.Order, error) {
	return nil, nil
}
func (m *mockOrderRepo) FindActiveByUserIDForUpdate(ctx context.Context, uid uint) (*models.Order, error) {
	return m.FindActiveByUserID(ctx, uid)
}
func (m *mockOrderRepo) FindHistoryByUserID(ctx context.Context, uid uint) ([]models.Order, error) {
	return nil, nil
}
func (m *mockOrderRepo) FindIncoming(ctx context.Context) ([]models.Order, error) { return nil, nil }
func (m *mockOrderRepo) FindInProgress(ctx context.Context) ([]models.Order, error) {
	var res []models.Order
	for _, o := range m.orders {
		if o.Status == models.OrderPreparing || o.Status == models.OrderPartiallyReady {
			res = append(res, *o)
		}
	}
	return res, nil
}
func (m *mockOrderRepo) FindAwaitingPayment(ctx context.Context) ([]models.Order, error) {
	return nil, nil
}
func (m *mockOrderRepo) FindTerminalByDate(ctx context.Context, date string) ([]models.Order, error) {
	if m.terminalByDate != nil {
		return m.terminalByDate[date], nil
	}
	return nil, nil
}
func (m *mockOrderRepo) GetMaxOrderNo(ctx context.Context, date string) (int, error) { return 0, nil }
func (m *mockOrderRepo) FindPreparingOldest(ctx context.Context) ([]models.Order, error) {
	var res []models.Order
	for _, o := range m.orders {
		if o.Status == models.OrderPreparing || o.Status == models.OrderPartiallyReady {
			res = append(res, *o)
		}
	}
	return res, nil
}
func (m *mockOrderRepo) FindPreparingOldestForUpdate(ctx context.Context) ([]models.Order, error) {
	return m.FindPreparingOldest(ctx)
}
func (m *mockOrderRepo) FindReadyExpired(ctx context.Context) ([]models.Order, error) {
	return nil, nil
}
func (m *mockOrderRepo) FindNonTerminal(ctx context.Context) ([]models.Order, error) { return nil, nil }
func (m *mockOrderRepo) FindReadyExpiredForUpdate(ctx context.Context) ([]models.Order, error) {
	return m.FindReadyExpired(ctx)
}
func (m *mockOrderRepo) FindNonTerminalForUpdate(ctx context.Context) ([]models.Order, error) {
	return m.FindNonTerminal(ctx)
}
func (m *mockOrderRepo) HasActiveItemsForMenuItem(_ context.Context, _ uint) (bool, error) {
	return false, nil
}
func (m *mockOrderRepo) CountActive(_ context.Context) (int, error) {
	n := 0
	for _, o := range m.orders {
		if models.IsActiveOrderStatus(o.Status) {
			n++
		}
	}
	return n, nil
}
func (m *mockOrderRepo) SumOrderedQtyByDate(_ context.Context, date string) (map[uint]int, error) {
	if m.sumOverride != nil {
		return m.sumOverride, nil
	}
	out := make(map[uint]int)
	for _, o := range m.orders {
		if o.Status == models.OrderRejected || o.OrderDate != date {
			continue
		}
		for _, it := range o.Items {
			out[it.MenuItemID] += it.Qty
		}
	}
	return out, nil
}

type mockMenuRepo struct {
	items []models.MenuItem
}

func (m *mockMenuRepo) FindAll(ctx context.Context, avail bool) ([]models.MenuItem, error) {
	if avail {
		out := make([]models.MenuItem, 0, len(m.items))
		for _, it := range m.items {
			if it.IsAvailable {
				out = append(out, it)
			}
		}
		return out, nil
	}
	return m.items, nil
}
func (m *mockMenuRepo) FindByID(ctx context.Context, id uint) (*models.MenuItem, error) {
	return &models.MenuItem{ID: id, Name: "Test Item", Price: 1000, IsAvailable: true}, nil
}
func (m *mockMenuRepo) FindMapByIDs(ctx context.Context, ids []uint) (map[uint]models.MenuItem, error) {
	return nil, nil
}
func (m *mockMenuRepo) Save(ctx context.Context, mi *models.MenuItem) error      { return nil }
func (m *mockMenuRepo) Delete(ctx context.Context, id uint) error                { return nil }
func (m *mockMenuRepo) UpdateStock(ctx context.Context, id uint, oos bool) error { return nil }
func (m *mockMenuRepo) ResetStock(ctx context.Context) error                     { return nil }

type mockPoolRepo struct {
	pool map[uint]int
}

func (m *mockPoolRepo) FindAll(ctx context.Context) (map[uint]int, error) { return m.pool, nil }
func (m *mockPoolRepo) Lock(ctx context.Context, itemID uint) (int, error) {
	return m.pool[itemID], nil
}
func (m *mockPoolRepo) Add(ctx context.Context, itemID uint, qty int) error {
	m.pool[itemID] += qty
	return nil
}
func (m *mockPoolRepo) ZeroAll(ctx context.Context) error { return nil }

type mockEventRepo struct{}

func (m *mockEventRepo) Log(ctx context.Context, ev *models.OrderEvent) error { return nil }

type mockShopStatusRepo struct {
	status *models.ShopStatus
}

func (m *mockShopStatusRepo) Get(_ context.Context) (*models.ShopStatus, error) {
	return m.status, nil
}
func (m *mockShopStatusRepo) Save(_ context.Context, s *models.ShopStatus) error {
	m.status = s
	return nil
}

func setupEngine() (*services.PoolEngine, *mockOrderRepo, *mockPoolRepo) {
	uow := &mockUoW{}
	orderRepo := &mockOrderRepo{orders: make(map[uint]*models.Order)}
	menuRepo := &mockMenuRepo{}
	poolRepo := &mockPoolRepo{pool: make(map[uint]int)}
	eventRepo := &mockEventRepo{}
	statusRepo := &mockShopStatusRepo{status: &models.ShopStatus{ID: 1, State: string(models.ShopOpen)}}
	hub := realtime.NewHub()
	cfg := &config.Config{HoldMinutes: 10}
	alloc := &services.FCFSAllocation{}

	engine := services.NewPoolEngine(uow, orderRepo, menuRepo, poolRepo, eventRepo, statusRepo, hub, cfg, alloc)
	return engine, orderRepo, poolRepo
}

func TestStatusRecompute(t *testing.T) {
	engine, repo, _ := setupEngine()

	tests := []struct {
		name  string
		items []models.OrderItem
		want  models.OrderStatus
	}{
		{
			name:  "preparing",
			items: []models.OrderItem{{Qty: 2, AllocatedQty: 0, HandedQty: 0}},
			want:  models.OrderPreparing,
		},
		{
			name:  "partially_ready_allocated",
			items: []models.OrderItem{{Qty: 2, AllocatedQty: 1, HandedQty: 0}},
			want:  models.OrderPartiallyReady,
		},
		{
			name:  "partially_ready_handed",
			items: []models.OrderItem{{Qty: 2, AllocatedQty: 1, HandedQty: 1}},
			want:  models.OrderPartiallyReady,
		},
		{
			name:  "ready",
			items: []models.OrderItem{{Qty: 2, AllocatedQty: 2, HandedQty: 0}},
			want:  models.OrderReady,
		},
		{
			name:  "awaiting_payment",
			items: []models.OrderItem{{Qty: 2, AllocatedQty: 2, HandedQty: 2}},
			want:  models.OrderAwaitingPayment,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			order := &models.Order{ID: 1, Status: models.OrderSubmitted, Items: tc.items}
			repo.Create(context.Background(), order)

			_, _ = engine.Accept(context.Background(), 1, nil)

			o, _ := repo.FindByID(context.Background(), 1)
			if o.Status != tc.want {
				t.Errorf("got %v, want %v", o.Status, tc.want)
			}
			repo.orders = make(map[uint]*models.Order) // reset
		})
	}
}

func TestAllocation(t *testing.T) {
	engine, repo, pool := setupEngine()

	order1 := &models.Order{
		ID:     1,
		Status: models.OrderPreparing,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, Status: models.ItemQueued},
		},
	}
	repo.Create(context.Background(), order1)

	// Handled by MarkDone which triggers allocation
	engine.MarkDone(context.Background(), 10, 1)

	o, _ := repo.FindByID(context.Background(), 1)
	if o.Items[0].AllocatedQty != 1 {
		t.Errorf("expected 1 allocated, got %d", o.Items[0].AllocatedQty)
	}
	if pool.pool[10] != 0 {
		t.Errorf("expected pool empty, got %d", pool.pool[10])
	}
	if o.Status != models.OrderPartiallyReady {
		t.Errorf("expected partially ready, got %v", o.Status)
	}

	engine.MarkDone(context.Background(), 10, 1)
	o, _ = repo.FindByID(context.Background(), 1)
	if o.Items[0].AllocatedQty != 2 {
		t.Errorf("expected 2 allocated, got %d", o.Items[0].AllocatedQty)
	}
	if o.Status != models.OrderReady {
		t.Errorf("expected ready, got %v", o.Status)
	}
}

func TestMarkDoneCappedAtRemainingDemand(t *testing.T) {
	engine, repo, pool := setupEngine()

	order := &models.Order{
		ID:     1,
		Status: models.OrderPreparing,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, Status: models.ItemQueued},
		},
	}
	repo.Create(context.Background(), order)

	// Only 2 are actually needed — asking to mark 3 done must be refused,
	// not silently accepted into an unclaimed pool.
	if err := engine.MarkDone(context.Background(), 10, 3); err == nil {
		t.Fatal("expected an error when marking more done than is currently needed")
	}
	if pool.pool[10] != 0 {
		t.Errorf("pool must be untouched after a rejected MarkDone, got %d", pool.pool[10])
	}

	// Exactly the remaining amount is fine.
	if err := engine.MarkDone(context.Background(), 10, 2); err != nil {
		t.Fatalf("expected qty == remaining to succeed, got: %v", err)
	}

	// Now nothing is left to cook — even qty=1 must be refused.
	if err := engine.MarkDone(context.Background(), 10, 1); err == nil {
		t.Fatal("expected an error when marking done with zero remaining demand")
	}
}

func TestCreateOrderRejectsDuplicateMenuItems(t *testing.T) {
	engine, _, _ := setupEngine()
	_, err := engine.CreateOrder(context.Background(), 1, []services.OrderItemInput{
		{MenuItemID: 10, Qty: 1},
		{MenuItemID: 10, Qty: 1},
	})
	if err == nil {
		t.Fatal("expected duplicate menu item to be rejected")
	}
}

func TestAcceptFullTrimZeroesTotalPrice(t *testing.T) {
	engine, repo, _ := setupEngine()
	order := &models.Order{
		ID:         1,
		Status:     models.OrderSubmitted,
		TotalPrice: 6000,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, PriceEach: 1500, Status: models.ItemPending},
			{ID: 2, MenuItemID: 11, Qty: 3, PriceEach: 1000, Status: models.ItemPending},
		},
	}
	repo.Create(context.Background(), order)

	// Rejecting every line at accept time must behave like RemoveItem's
	// full-trim path: order rejected and TotalPrice reset to 0, not left at
	// the pre-trim sum.
	_, err := engine.Accept(context.Background(), 1, []uint{1, 2})
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}

	o, _ := repo.FindByID(context.Background(), 1)
	if o.Status != models.OrderRejected {
		t.Errorf("expected rejected, got %v", o.Status)
	}
	if o.TotalPrice != 0 {
		t.Errorf("expected TotalPrice 0 after full trim, got %d", o.TotalPrice)
	}
}

func TestRemoveItemRepools(t *testing.T) {
	engine, repo, pool := setupEngine()

	// order1 is fully allocated (ready): 2 prepared units of menu item 10.
	order1 := &models.Order{
		ID:     1,
		Status: models.OrderReady,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, AllocatedQty: 2, Status: models.ItemAllocated, PriceEach: 1000},
		},
	}
	repo.Create(context.Background(), order1)

	// order2 is waiting for 1 unit of the same item.
	order2 := &models.Order{
		ID:     2,
		Status: models.OrderPreparing,
		Items: []models.OrderItem{
			{ID: 2, MenuItemID: 10, Qty: 1, AllocatedQty: 0, Status: models.ItemQueued, PriceEach: 1000},
		},
	}
	repo.Create(context.Background(), order2)

	// Shopkeeper trims order1's line -> its 2 prepared units return to the pool
	// and the next FCFS order (order2) is served from them.
	if _, err := engine.RemoveItem(context.Background(), 1, 1); err != nil {
		t.Fatalf("RemoveItem: %v", err)
	}

	o1, _ := repo.FindByID(context.Background(), 1)
	if o1.Status != models.OrderRejected {
		t.Errorf("order1 expected rejected (all lines trimmed), got %v", o1.Status)
	}
	o2, _ := repo.FindByID(context.Background(), 2)
	if o2.Items[0].AllocatedQty != 1 {
		t.Errorf("order2 expected 1 allocated after re-pool, got %d", o2.Items[0].AllocatedQty)
	}
	if o2.Status != models.OrderReady {
		t.Errorf("order2 expected ready, got %v", o2.Status)
	}
	if pool.pool[10] != 1 {
		t.Errorf("expected 1 leftover unit in pool, got %d", pool.pool[10])
	}
}

func TestRemoveItemRefusedAfterHandover(t *testing.T) {
	engine, repo, _ := setupEngine()
	order := &models.Order{
		ID:     1,
		Status: models.OrderPartiallyReady,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, AllocatedQty: 2, HandedQty: 1, Status: models.ItemAllocated, PriceEach: 1000},
		},
	}
	repo.Create(context.Background(), order)
	if _, err := engine.RemoveItem(context.Background(), 1, 1); err == nil {
		t.Errorf("expected an error when removing an item the student has started collecting")
	}
}

func TestHandoverGuards(t *testing.T) {
	engine, repo, _ := setupEngine()
	order := &models.Order{
		ID:     1,
		Status: models.OrderSubmitted,
		Items:  []models.OrderItem{{ID: 1, Qty: 2, AllocatedQty: 1}},
	}
	repo.Create(context.Background(), order)

	// Submitted order cannot handover
	_, err := engine.Handover(context.Background(), 1, 1, 1)
	if err == nil {
		t.Errorf("expected err for handover on submitted order")
	}

	order.Status = models.OrderPreparing
	// Handover more than allocated
	_, err = engine.Handover(context.Background(), 1, 1, 2)
	if err == nil {
		t.Errorf("expected err for handover > allocated")
	}

	// Handover valid qty
	_, err = engine.Handover(context.Background(), 1, 1, 1)
	if err != nil {
		t.Errorf("unexpected err: %v", err)
	}
}

func TestRejectZeroesTotalPrice(t *testing.T) {
	engine, repo, _ := setupEngine()
	order := &models.Order{
		ID:         1,
		Status:     models.OrderSubmitted,
		TotalPrice: 6000,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, PriceEach: 1500, Status: models.ItemPending},
			{ID: 2, MenuItemID: 11, Qty: 3, PriceEach: 1000, Status: models.ItemPending},
		},
	}
	repo.Create(context.Background(), order)

	if _, err := engine.Reject(context.Background(), 1); err != nil {
		t.Fatalf("Reject: %v", err)
	}

	o, _ := repo.FindByID(context.Background(), 1)
	if o.Status != models.OrderRejected {
		t.Errorf("expected rejected, got %v", o.Status)
	}
	if o.TotalPrice != 0 {
		t.Errorf("expected TotalPrice 0 after reject, got %d", o.TotalPrice)
	}
}

func TestCancelZeroesTotalPrice(t *testing.T) {
	engine, repo, _ := setupEngine()
	order := &models.Order{
		ID:         1,
		UserID:     42,
		Status:     models.OrderSubmitted,
		TotalPrice: 4000,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, PriceEach: 2000, Status: models.ItemPending},
		},
	}
	repo.Create(context.Background(), order)

	if _, err := engine.Cancel(context.Background(), 1, 42); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	o, _ := repo.FindByID(context.Background(), 1)
	if o.Status != models.OrderCancelled {
		t.Errorf("expected cancelled, got %v", o.Status)
	}
	if o.TotalPrice != 0 {
		t.Errorf("expected TotalPrice 0 after cancel, got %d", o.TotalPrice)
	}
}

func TestPaidGuards(t *testing.T) {
	engine, repo, _ := setupEngine()
	order := &models.Order{
		ID:     1,
		Status: models.OrderReady, // Not awaiting payment
	}
	repo.Create(context.Background(), order)

	_, err := engine.Paid(context.Background(), 1)
	if err == nil {
		t.Errorf("expected err when marking paid before awaiting payment")
	}

	order.Status = models.OrderAwaitingPayment
	_, err = engine.Paid(context.Background(), 1)
	if err != nil {
		t.Errorf("unexpected err: %v", err)
	}
}
