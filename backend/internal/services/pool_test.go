package services_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/services"
)

type mockUoW struct{}

// txMarkerKey lets a test assert a repo call happened from inside a WithTx
// callback (e.g. TestCreateOrderChecksShopStatusInsideTransaction, V2) —
// mirrors the real GormUnitOfWork's txKey pattern (repository/gorm.go)
// closely enough for that purpose without pulling GORM into these tests.
type txMarkerKey struct{}

func (m *mockUoW) WithTx(ctx context.Context, fn func(context.Context) error) error {
	return fn(context.WithValue(ctx, txMarkerKey{}, true))
}

// failingCommitUoW simulates a transaction whose callback runs to completion
// (so every mutation inside it "happened" from the callback's point of view)
// but whose commit itself then fails — e.g. a serialization failure or a
// dropped connection at COMMIT time. Used by TestReadyPushNotSentOnCommitFailure
// (V1) to prove a caller's post-commit push flush only fires when WithTx
// actually returns nil, not just because the callback returned nil.
type failingCommitUoW struct {
	commitErr error
}

func (m *failingCommitUoW) WithTx(ctx context.Context, fn func(context.Context) error) error {
	if err := fn(ctx); err != nil {
		return err
	}
	return m.commitErr
}

type mockOrderRepo struct {
	orders map[uint]*models.Order
	// terminalByDate lets a test stub FindTerminalByDate directly.
	terminalByDate map[string][]models.Order
	// sumOverride lets a test stub SumOrderedQtyByDate directly, bypassing the
	// in-memory computation over orders.
	sumOverride map[uint]int
	// findByIDCalls counts FindByID invocations — PoolEngine.broadcast calls
	// it exactly once per order broadcast, so a test can assert the engine
	// only reloaded/broadcast the orders it actually touched instead of
	// every in-progress order (see TestReject/RemoveItem broadcast-scope
	// tests).
	findByIDCalls int
	// findByIDIDs records every id passed to FindByID, in call order —
	// lets a test assert a *specific* order was never reloaded (e.g. an
	// unrelated order3 in the broadcast-scope tests) directly, rather than
	// through a raw count that also includes unrelated FindByID calls (e.g.
	// a mutation's own final re-fetch of the order it acted on, to build an
	// accurate response).
	findByIDIDs []uint
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
	m.findByIDCalls++
	m.findByIDIDs = append(m.findByIDIDs, id)
	return m.orders[id], nil
}
func (m *mockOrderRepo) FindByIDForUpdate(ctx context.Context, id uint) (*models.Order, error) {
	// Deliberately doesn't route through FindByID (and its findByIDCalls
	// counter) — FindByIDForUpdate is the locking read used pervasively
	// inside transactions, while findByIDCalls exists to isolate exactly
	// how many times PoolEngine.broadcast (which only ever calls the
	// non-locking FindByID) fired.
	return m.orders[id], nil
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
func (m *mockOrderRepo) FindIncoming(ctx context.Context) ([]models.Order, error) {
	var res []models.Order
	for _, o := range m.orders {
		if o.Status == models.OrderSubmitted {
			res = append(res, *o)
		}
	}
	return res, nil
}
func (m *mockOrderRepo) FindIncomingForUpdate(ctx context.Context) ([]models.Order, error) {
	return m.FindIncoming(ctx)
}
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
	var res []models.Order
	for _, o := range m.orders {
		if o.Status == models.OrderReady {
			res = append(res, *o)
		}
	}
	return res, nil
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
func (m *mockOrderRepo) CountAccepted(_ context.Context) (int, error) {
	acceptedStatuses := map[models.OrderStatus]bool{
		models.OrderPreparing:       true,
		models.OrderPartiallyReady:  true,
		models.OrderReady:           true,
		models.OrderAwaitingPayment: true,
	}
	n := 0
	for _, o := range m.orders {
		if acceptedStatuses[o.Status] {
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
	// blockFindAll, if set, is read from before FindAll returns — lets a
	// test deterministically pause a read mid-flight to interleave a
	// concurrent mutation/invalidation (see TestMenuListAvailableCacheRace).
	blockFindAll <-chan struct{}
	// findAllCalls counts FindAll invocations so a test can tell whether a
	// later ListAvailable call hit the cache or triggered a fresh repo read.
	findAllCalls int
	// deletedIDs mirrors a real soft delete: Delete marks the id rather than
	// removing it from items, and FindMapByIDs (like GORM's default scope)
	// excludes deleted ids from its result.
	deletedIDs map[uint]bool
}

func (m *mockMenuRepo) FindAll(ctx context.Context, avail bool) ([]models.MenuItem, error) {
	m.findAllCalls++
	if m.blockFindAll != nil {
		<-m.blockFindAll
	}
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
func (m *mockMenuRepo) FindByIDForUpdate(ctx context.Context, id uint) (*models.MenuItem, error) {
	return m.FindByID(ctx, id)
}
func (m *mockMenuRepo) FindMapByIDs(ctx context.Context, ids []uint) (map[uint]models.MenuItem, error) {
	out := make(map[uint]models.MenuItem)
	for _, it := range m.items {
		if m.deletedIDs[it.ID] {
			continue
		}
		for _, id := range ids {
			if id == it.ID {
				out[it.ID] = it
				break
			}
		}
	}
	return out, nil
}
func (m *mockMenuRepo) Save(ctx context.Context, mi *models.MenuItem) error { return nil }
func (m *mockMenuRepo) Delete(ctx context.Context, id uint) error {
	if m.deletedIDs == nil {
		m.deletedIDs = make(map[uint]bool)
	}
	m.deletedIDs[id] = true
	return nil
}
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
func (m *mockPoolRepo) Delete(ctx context.Context, itemID uint) error {
	delete(m.pool, itemID)
	return nil
}
func (m *mockPoolRepo) ZeroAll(ctx context.Context) error { return nil }

type mockEventRepo struct{}

func (m *mockEventRepo) Log(ctx context.Context, ev *models.OrderEvent) error { return nil }

type mockShopStatusRepo struct {
	status *models.ShopStatus
	// getCalls / getCalledInTx let a test assert exactly how many times Get
	// was called and whether at least one of those calls happened inside a
	// WithTx callback (via txMarkerKey) — see TestCreateOrderChecksShopStatusInsideTransaction (V2).
	getCalls      int
	getCalledInTx bool
}

func (m *mockShopStatusRepo) Get(ctx context.Context) (*models.ShopStatus, error) {
	m.getCalls++
	if ctx.Value(txMarkerKey{}) != nil {
		m.getCalledInTx = true
	}
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
			if err := repo.Create(context.Background(), order); err != nil {
				t.Fatalf("setup Create: %v", err)
			}

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
	if err := repo.Create(context.Background(), order1); err != nil {
		t.Fatalf("setup Create: %v", err)
	}

	// Handled by MarkDone which triggers allocation
	if err := engine.MarkDone(context.Background(), 10, 1); err != nil {
		t.Fatalf("MarkDone: %v", err)
	}

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

	if err := engine.MarkDone(context.Background(), 10, 1); err != nil {
		t.Fatalf("MarkDone: %v", err)
	}
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
	_ = repo.Create(context.Background(), order)

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
	_ = repo.Create(context.Background(), order)

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
	_ = repo.Create(context.Background(), order1)

	// order2 is waiting for 1 unit of the same item.
	order2 := &models.Order{
		ID:     2,
		Status: models.OrderPreparing,
		Items: []models.OrderItem{
			{ID: 2, MenuItemID: 10, Qty: 1, AllocatedQty: 0, Status: models.ItemQueued, PriceEach: 1000},
		},
	}
	_ = repo.Create(context.Background(), order2)

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
	_ = repo.Create(context.Background(), order)
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
	_ = repo.Create(context.Background(), order)

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
	_ = repo.Create(context.Background(), order)

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
	_ = repo.Create(context.Background(), order)

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
	_ = repo.Create(context.Background(), order)

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

// setupShopStatusSvc builds a ShopStatusService wired to a real PoolEngine backed
// by the same mock repos, so shop-status guard and auto-reject tests can use it.
func setupShopStatusSvc(engine *services.PoolEngine, orderRepo *mockOrderRepo) (*services.ShopStatusService, *mockShopStatusRepo) {
	shopStatusRepo := &mockShopStatusRepo{status: &models.ShopStatus{ID: 1, State: string(models.ShopOpen)}}
	hub := realtime.NewHub()
	svc := services.NewShopStatusService(shopStatusRepo, orderRepo, &mockUoW{}, hub)
	svc.SetPool(engine)
	return svc, shopStatusRepo
}

// TestShopStatusGuardBlockedOnlyByAcceptedOrders verifies Fix 1: a submitted
// order must NOT block a pause/close transition (shopkeeper hasn't committed to
// it yet), but an accepted order (preparing, etc.) must block it.
func TestShopStatusGuardBlockedOnlyByAcceptedOrders(t *testing.T) {
	engine, orderRepo, _ := setupEngine()
	svc, _ := setupShopStatusSvc(engine, orderRepo)
	ctx := context.Background()

	// Seed a submitted order only — pause must succeed.
	submitted := &models.Order{
		ID:     1,
		UserID: 1,
		Status: models.OrderSubmitted,
		Items:  []models.OrderItem{{ID: 1, MenuItemID: 10, Qty: 1, PriceEach: 1000, Status: models.ItemPending}},
	}
	_ = orderRepo.Create(ctx, submitted)

	_, err := svc.Set(ctx, "paused", nil)
	if err != nil {
		t.Errorf("pause must succeed when only submitted orders exist, got: %v", err)
	}

	// Reset shop status to open for the next sub-test.
	_, _ = svc.Set(ctx, "open", nil)

	// Now add a preparing order — pause must be refused.
	preparing := &models.Order{
		ID:     2,
		UserID: 2,
		Status: models.OrderPreparing,
		Items:  []models.OrderItem{{ID: 2, MenuItemID: 10, Qty: 1, PriceEach: 1000, Status: models.ItemQueued}},
	}
	_ = orderRepo.Create(ctx, preparing)

	_, err = svc.Set(ctx, "paused", nil)
	if err == nil {
		t.Errorf("pause must be refused when a preparing order exists")
	}
}

// TestAutoRejectSubmittedOnClose verifies Fix 2: transitioning to closed/paused
// auto-rejects any still-submitted orders and broadcasts them.
func TestAutoRejectSubmittedOnClose(t *testing.T) {
	engine, orderRepo, _ := setupEngine()
	svc, _ := setupShopStatusSvc(engine, orderRepo)
	ctx := context.Background()

	// Two submitted orders, no accepted orders (so pause is allowed).
	for i := 1; i <= 2; i++ {
		_ = orderRepo.Create(ctx, &models.Order{
			ID:     uint(i),
			UserID: uint(i),
			Status: models.OrderSubmitted,
			Items:  []models.OrderItem{{ID: uint(i), MenuItemID: 10, Qty: 1, PriceEach: 500, Status: models.ItemPending}},
		})
	}

	_, err := svc.Set(ctx, "closed", nil)
	if err != nil {
		t.Fatalf("close must succeed with only submitted orders, got: %v", err)
	}

	// Both orders must now be rejected with zeroed totals.
	for i := 1; i <= 2; i++ {
		o, _ := orderRepo.FindByID(ctx, uint(i))
		if o.Status != models.OrderRejected {
			t.Errorf("order %d: expected rejected after auto-reject sweep, got %v", i, o.Status)
		}
		if o.TotalPrice != 0 {
			t.Errorf("order %d: expected TotalPrice 0 after auto-reject, got %d", i, o.TotalPrice)
		}
	}
}

// TestCancelRefusedAfterHandover verifies Fix 3 (guard): cancel must be refused
// with 409 once any item has handed_qty > 0, regardless of order status.
func TestCancelRefusedAfterHandover(t *testing.T) {
	engine, repo, _ := setupEngine()
	ctx := context.Background()

	// Order in partially_ready with one unit already handed over.
	order := &models.Order{
		ID:     1,
		UserID: 42,
		Status: models.OrderPartiallyReady,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, AllocatedQty: 1, HandedQty: 1, Status: models.ItemAllocated, PriceEach: 1000},
		},
	}
	_ = repo.Create(ctx, order)

	_, err := engine.Cancel(ctx, 1, 42)
	if err == nil {
		t.Errorf("expected cancel to be refused once a unit has been handed over")
	}
}

// TestCancelThroughReadyReallocates verifies Fix 3 (happy path): a student can
// cancel an order in 'ready' status (nothing handed over), and the freed
// allocated units are re-distributed FCFS to another waiting order.
// Cancel is student-initiated and only ever legal pre-accept — this is the
// direct fix for a real loss incident (a student cancelled after the
// shopkeeper had already cooked part of the order).
func TestCancelRefusedOnceAccepted(t *testing.T) {
	engine, repo, _ := setupEngine()
	ctx := context.Background()

	order := &models.Order{
		ID:     1,
		UserID: 42,
		Status: models.OrderReady,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, AllocatedQty: 2, HandedQty: 0, Status: models.ItemAllocated, PriceEach: 1000},
		},
	}
	_ = repo.Create(ctx, order)

	_, err := engine.Cancel(ctx, 1, 42)
	if err == nil {
		t.Fatal("expected Cancel to be refused once the order is past submitted")
	}
}

// Reject is the shopkeeper's escape hatch, legal even after accepting — the
// "found something unexpected" case — and reallocates freed pool units to the
// next FCFS-waiting order, same as the pre-accept path.
func TestRejectAfterAcceptReallocates(t *testing.T) {
	engine, repo, pool := setupEngine()
	ctx := context.Background()

	// order1: accepted, status=ready, 2 units of menu item 10 allocated.
	order1 := &models.Order{
		ID:         1,
		UserID:     42,
		Status:     models.OrderReady,
		TotalPrice: 2000,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, AllocatedQty: 2, HandedQty: 0, Status: models.ItemAllocated, PriceEach: 1000},
		},
	}
	_ = repo.Create(ctx, order1)

	// order2: a second student waiting for 1 unit of the same item.
	order2 := &models.Order{
		ID:     2,
		UserID: 99,
		Status: models.OrderPreparing,
		Items: []models.OrderItem{
			{ID: 2, MenuItemID: 10, Qty: 1, AllocatedQty: 0, Status: models.ItemQueued, PriceEach: 1000},
		},
	}
	_ = repo.Create(ctx, order2)

	_, err := engine.Reject(ctx, 1)
	if err != nil {
		t.Fatalf("Reject after accept: %v", err)
	}

	o1, _ := repo.FindByID(ctx, 1)
	if o1.Status != models.OrderRejected {
		t.Errorf("expected rejected, got %v", o1.Status)
	}
	if o1.TotalPrice != 0 {
		t.Errorf("expected TotalPrice 0 after reject, got %d", o1.TotalPrice)
	}

	o2, _ := repo.FindByID(ctx, 2)
	if o2.Items[0].AllocatedQty != 1 {
		t.Errorf("order2: expected 1 unit reallocated after reject, got %d", o2.Items[0].AllocatedQty)
	}
	if o2.Status != models.OrderReady {
		t.Errorf("order2: expected ready after reallocation, got %v", o2.Status)
	}

	if pool.pool[10] != 1 {
		t.Errorf("expected 1 leftover unit in pool, got %d", pool.pool[10])
	}
}

// TestRejectBroadcastsOnlyTouchedOrders guards against the broadcast storm
// bug: Reject used to reload and broadcast every in-progress order whenever
// any pool units were returned, instead of just the ones FCFS reallocation
// actually touched. order3 here is unrelated (different menu item, no
// allocation change) and must never be reloaded/broadcast.
func TestRejectBroadcastsOnlyTouchedOrders(t *testing.T) {
	engine, repo, _ := setupEngine()
	ctx := context.Background()

	order1 := &models.Order{
		ID:         1,
		UserID:     42,
		Status:     models.OrderReady,
		TotalPrice: 2000,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, AllocatedQty: 2, HandedQty: 0, Status: models.ItemAllocated, PriceEach: 1000},
		},
	}
	_ = repo.Create(ctx, order1)

	order2 := &models.Order{
		ID:     2,
		UserID: 99,
		Status: models.OrderPreparing,
		Items: []models.OrderItem{
			{ID: 2, MenuItemID: 10, Qty: 1, AllocatedQty: 0, Status: models.ItemQueued, PriceEach: 1000},
		},
	}
	_ = repo.Create(ctx, order2)

	// Unrelated in-progress order — a different menu item, untouched by
	// item 10's reallocation. Must not be broadcast.
	order3 := &models.Order{
		ID:     3,
		UserID: 7,
		Status: models.OrderPreparing,
		Items: []models.OrderItem{
			{ID: 3, MenuItemID: 20, Qty: 1, AllocatedQty: 0, Status: models.ItemQueued, PriceEach: 500},
		},
	}
	_ = repo.Create(ctx, order3)

	before := len(repo.findByIDIDs)
	if _, err := engine.Reject(ctx, 1); err != nil {
		t.Fatalf("Reject: %v", err)
	}
	reloaded := repo.findByIDIDs[before:]

	// order3 must never be reloaded/broadcast — the old FindInProgress-based
	// fallback would have reloaded every in-progress order, including it.
	// Asserted directly on which ids were fetched, not a raw call count: a
	// mutation is also allowed to re-fetch the order it acted on again to
	// build an accurate response (see the includeStudent=true comment on
	// Reject's own final FindByID call) without that looking like a
	// regression here.
	for _, id := range reloaded {
		if id == order3.ID {
			t.Errorf("expected order3 (id=%d) never reloaded, but FindByID was called with it: %v", order3.ID, reloaded)
		}
	}
	if !slices.Contains(reloaded, order1.ID) {
		t.Errorf("expected the acted-on order (id=%d) to be reloaded, got %v", order1.ID, reloaded)
	}
	if !slices.Contains(reloaded, order2.ID) {
		t.Errorf("expected the FCFS-touched order (id=%d) to be reloaded, got %v", order2.ID, reloaded)
	}
}

// TestMarkDoneBroadcastsOnlyTouchedOrders guards against the same storm bug
// in MarkDone, which unconditionally reloaded/broadcast every in-progress
// order on every call regardless of how many orders the allocation actually
// reached — the most severe instance since it wasn't even gated on "did
// anything change".
func TestMarkDoneBroadcastsOnlyTouchedOrders(t *testing.T) {
	engine, repo, _ := setupEngine()
	ctx := context.Background()

	needsItem := &models.Order{
		ID:     1,
		UserID: 42,
		Status: models.OrderPreparing,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 1, AllocatedQty: 0, Status: models.ItemQueued, PriceEach: 1000},
		},
	}
	_ = repo.Create(ctx, needsItem)

	// Unrelated in-progress order waiting on a different menu item.
	unrelated := &models.Order{
		ID:     2,
		UserID: 7,
		Status: models.OrderPreparing,
		Items: []models.OrderItem{
			{ID: 2, MenuItemID: 20, Qty: 1, AllocatedQty: 0, Status: models.ItemQueued, PriceEach: 500},
		},
	}
	_ = repo.Create(ctx, unrelated)

	before := repo.findByIDCalls
	if err := engine.MarkDone(ctx, 10, 1); err != nil {
		t.Fatalf("MarkDone: %v", err)
	}
	broadcastCalls := repo.findByIDCalls - before

	// Exactly 1: the single order the allocator actually touched. The old
	// FindInProgress-based broadcast would have also reloaded `unrelated`,
	// making this 2.
	if broadcastCalls != 1 {
		t.Errorf("expected exactly 1 broadcast reload (touched order only), got %d", broadcastCalls)
	}
}

// Reject is refused once the customer has started collecting — you can't
// un-hand-over an item.
func TestRejectAfterAcceptRefusedWhenHandedOver(t *testing.T) {
	engine, repo, _ := setupEngine()
	ctx := context.Background()

	order := &models.Order{
		ID:     1,
		UserID: 42,
		Status: models.OrderPartiallyReady,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, AllocatedQty: 1, HandedQty: 1, Status: models.ItemAllocated, PriceEach: 1000},
		},
	}
	_ = repo.Create(ctx, order)

	_, err := engine.Reject(ctx, 1)
	if err == nil {
		t.Fatal("expected Reject to be refused once pickup has started")
	}
}

// TestMenuDeleteRemovesStrandedPoolRow guards the T4 fix: deleting a menu
// item is a soft delete (an UPDATE), so item_pool's ON DELETE CASCADE never
// fires. Cooked units can be sitting in the pool with no active order
// waiting on them (units returned by Reject/RemoveItem/ExpiryTick with
// nothing else queued) — reachable, not theoretical. Without the fix,
// PrepList unions that stranded pool row into its id set, resolves the name
// via FindMapByIDs (which respects the soft delete), and returns a
// permanent nameless ghost item on every GET /api/shop/prep.
func TestMenuDeleteRemovesStrandedPoolRow(t *testing.T) {
	ctx := context.Background()
	uow := &mockUoW{}
	orderRepo := &mockOrderRepo{orders: make(map[uint]*models.Order)}
	menuRepo := &mockMenuRepo{items: []models.MenuItem{{ID: 1, Name: "Samosa", Price: 1000, IsAvailable: true}}}
	poolRepo := &mockPoolRepo{pool: make(map[uint]int)}
	eventRepo := &mockEventRepo{}
	statusRepo := &mockShopStatusRepo{status: &models.ShopStatus{ID: 1, State: string(models.ShopOpen)}}
	ratingRepo := &mockRatingRepo{}
	hub := realtime.NewHub()
	cfg := &config.Config{}
	alloc := &services.FCFSAllocation{}

	menuSvc := services.NewMenuService(menuRepo, orderRepo, ratingRepo, poolRepo, uow, hub, cfg)
	engine := services.NewPoolEngine(uow, orderRepo, menuRepo, poolRepo, eventRepo, statusRepo, hub, cfg, alloc)

	// Cooked units already sitting in the pool, with no active order waiting.
	poolRepo.pool[1] = 3

	if err := menuSvc.Delete(ctx, 1); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	if _, stillPresent := poolRepo.pool[1]; stillPresent {
		t.Fatalf("item_pool row for the deleted item is still present, want gone")
	}

	prep, err := engine.PrepList(ctx)
	if err != nil {
		t.Fatalf("PrepList: %v", err)
	}
	for _, item := range prep {
		if item.MenuItemID == 1 {
			t.Fatalf("PrepList still returned a row for the deleted item: %+v", item)
		}
	}
}

// fakeOrderNotifier stands in for *services.PushService in tests — the real
// service only ever fires an outbound HTTP push when VAPID keys are
// configured, so it can't otherwise be used to observe exactly what
// CreateOrder passes it. Implements the same interface PoolEngine.SetPushService
// accepts.
type fakeOrderNotifier struct {
	newOrderCalls []struct{ orderNo, itemCount int }
	readyCalls    []struct {
		userID  uint
		orderNo int
	}
	rejectedCalls []struct {
		userID  uint
		orderNo int
		reason  string
	}
	expiredCalls []struct {
		userID  uint
		orderNo int
	}
}

func (f *fakeOrderNotifier) NotifyNewOrder(ctx context.Context, orderNo, itemCount int) {
	f.newOrderCalls = append(f.newOrderCalls, struct{ orderNo, itemCount int }{orderNo, itemCount})
}

func (f *fakeOrderNotifier) NotifyOrderReady(ctx context.Context, userID uint, orderNo int) {
	f.readyCalls = append(f.readyCalls, struct {
		userID  uint
		orderNo int
	}{userID, orderNo})
}

func (f *fakeOrderNotifier) NotifyOrderRejected(ctx context.Context, userID uint, orderNo int, reason string) {
	f.rejectedCalls = append(f.rejectedCalls, struct {
		userID  uint
		orderNo int
		reason  string
	}{userID, orderNo, reason})
}

func (f *fakeOrderNotifier) NotifyOrderExpired(ctx context.Context, userID uint, orderNo int) {
	f.expiredCalls = append(f.expiredCalls, struct {
		userID  uint
		orderNo int
	}{userID, orderNo})
}

// TestCreateOrderNotifiesPushWithCorrectItemCount guards STATUS.md § 9.6-U1:
// candidate.Items is never populated inside CreateOrder's transaction (items
// are persisted via a separate slice), so a caller reading order.Items after
// the transaction always saw nil/0 — every shopkeeper "New order" push read
// "0 item(s)" regardless of the real order. push_internal_test.go alone
// can't catch this: it exercises newOrderPayload directly with hand-built
// arguments, never CreateOrder's real call. This test goes through the real
// caller and asserts the actual item count reaches the push layer.
func TestCreateOrderNotifiesPushWithCorrectItemCount(t *testing.T) {
	engine, _, _ := setupEngine()
	fake := &fakeOrderNotifier{}
	engine.SetPushService(fake)

	resp, err := engine.CreateOrder(context.Background(), 1, []services.OrderItemInput{
		{MenuItemID: 10, Qty: 2},
		{MenuItemID: 11, Qty: 1},
	})
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}

	if len(fake.newOrderCalls) != 1 {
		t.Fatalf("expected exactly one NotifyNewOrder call, got %d", len(fake.newOrderCalls))
	}
	call := fake.newOrderCalls[0]
	if call.orderNo != resp.OrderNo {
		t.Errorf("orderNo = %d, want %d", call.orderNo, resp.OrderNo)
	}
	if call.itemCount != 2 {
		t.Errorf("itemCount = %d, want 2 (two distinct menu item lines)", call.itemCount)
	}
}

// ---- V1: ready push must only fire after the transaction actually commits ----

// TestReadyPushNotSentOnCommitFailure guards V1: recomputeStatus used to fire
// the "order ready" push from deep inside the WithTx callback, the instant it
// flipped an order to ready — before the transaction had actually committed.
// A rollback after that point (simulated here by failingCommitUoW, whose
// callback runs to completion but whose "commit" then fails) used to still
// leave the push sent, even though the DB never actually reached 'ready'.
func TestReadyPushNotSentOnCommitFailure(t *testing.T) {
	orderRepo := &mockOrderRepo{orders: make(map[uint]*models.Order)}
	menuRepo := &mockMenuRepo{}
	poolRepo := &mockPoolRepo{pool: make(map[uint]int)}
	eventRepo := &mockEventRepo{}
	statusRepo := &mockShopStatusRepo{status: &models.ShopStatus{ID: 1, State: string(models.ShopOpen)}}
	hub := realtime.NewHub()
	cfg := &config.Config{HoldMinutes: 10}
	alloc := &services.FCFSAllocation{}
	uow := &failingCommitUoW{commitErr: errors.New("simulated commit failure")}

	engine := services.NewPoolEngine(uow, orderRepo, menuRepo, poolRepo, eventRepo, statusRepo, hub, cfg, alloc)
	fake := &fakeOrderNotifier{}
	engine.SetPushService(fake)

	order := &models.Order{
		ID:     1,
		UserID: 42,
		Status: models.OrderPreparing,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 1, AllocatedQty: 0, Status: models.ItemQueued},
		},
	}
	_ = orderRepo.Create(context.Background(), order)

	// MarkDone's callback fully allocates the item (order -> ready) before
	// the simulated commit failure kicks in.
	err := engine.MarkDone(context.Background(), 10, 1)
	if err == nil {
		t.Fatal("expected MarkDone to surface the simulated commit failure")
	}
	if len(fake.readyCalls) != 0 {
		t.Errorf("expected NO NotifyOrderReady call when the commit fails, got %d: %+v", len(fake.readyCalls), fake.readyCalls)
	}
}

// TestReadyPushSentExactlyOnceOnSuccessfulCommit is the success-path mirror:
// a successful commit must still notify exactly once.
func TestReadyPushSentExactlyOnceOnSuccessfulCommit(t *testing.T) {
	engine, repo, _ := setupEngine()
	fake := &fakeOrderNotifier{}
	engine.SetPushService(fake)

	order := &models.Order{
		ID:     1,
		UserID: 42,
		Status: models.OrderPreparing,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 1, AllocatedQty: 0, Status: models.ItemQueued},
		},
	}
	_ = repo.Create(context.Background(), order)

	if err := engine.MarkDone(context.Background(), 10, 1); err != nil {
		t.Fatalf("MarkDone: %v", err)
	}

	if len(fake.readyCalls) != 1 {
		t.Fatalf("expected exactly 1 NotifyOrderReady call, got %d: %+v", len(fake.readyCalls), fake.readyCalls)
	}
	if fake.readyCalls[0].userID != 42 || fake.readyCalls[0].orderNo != order.OrderNo {
		t.Errorf("unexpected ready call: %+v", fake.readyCalls[0])
	}
}

// ---- V2: the shop-open check must run inside CreateOrder's transaction ----

// TestCreateOrderChecksShopStatusInsideTransaction guards V2: ensureShopOpen
// used to run unlocked, before e.mu.Lock() and entirely outside WithTx — a
// student could submit into a shop that closes in the gap between that check
// and the transaction. Asserts the shop-status read happens from inside the
// WithTx callback (via txMarkerKey, mirroring the real GormUnitOfWork's
// context-value pattern).
func TestCreateOrderChecksShopStatusInsideTransaction(t *testing.T) {
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

	if _, err := engine.CreateOrder(context.Background(), 1, []services.OrderItemInput{{MenuItemID: 10, Qty: 1}}); err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}

	if statusRepo.getCalls == 0 {
		t.Fatal("expected ShopStatusRepo.Get to be called at all")
	}
	if !statusRepo.getCalledInTx {
		t.Error("expected the shop-status read to happen inside CreateOrder's transaction, but it never observed the tx marker")
	}
}

// ---- V3: expected_total mismatch must surface as price_changed, never refuse/re-price ----

func TestCreateOrderReportsPriceChangedOnMismatch(t *testing.T) {
	engine, _, _ := setupEngine()
	// mockMenuRepo.FindByID always prices at 1000 regardless of ID.
	resp, err := engine.CreateOrder(context.Background(), 1, []services.OrderItemInput{{MenuItemID: 10, Qty: 1}}, 500)
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}
	if resp.TotalPrice != 1000 {
		t.Fatalf("expected order charged at the live price (1000), got %d", resp.TotalPrice)
	}
	if resp.PriceChanged == nil {
		t.Fatal("expected price_changed to be set on a mismatch")
	}
	if resp.PriceChanged.Expected != 500 || resp.PriceChanged.Charged != 1000 {
		t.Errorf("unexpected PriceChanged: %+v", resp.PriceChanged)
	}
}

func TestCreateOrderNoPriceChangedWhenExpectedMatches(t *testing.T) {
	engine, _, _ := setupEngine()
	resp, err := engine.CreateOrder(context.Background(), 1, []services.OrderItemInput{{MenuItemID: 10, Qty: 1}}, 1000)
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}
	if resp.PriceChanged != nil {
		t.Errorf("expected no price_changed when expected_total matches, got %+v", resp.PriceChanged)
	}
}

func TestCreateOrderNoPriceChangedWhenExpectedOmitted(t *testing.T) {
	engine, _, _ := setupEngine()
	resp, err := engine.CreateOrder(context.Background(), 1, []services.OrderItemInput{{MenuItemID: 10, Qty: 1}})
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}
	if resp.PriceChanged != nil {
		t.Errorf("expected identical old behavior (no price_changed) when expected_total is omitted, got %+v", resp.PriceChanged)
	}
}

// ---- V4: Accept must validate rejectedItemIDs belong to this order before mutating ----

// TestAcceptRejectsForeignItemID guards V4: rejectedItemIDs is caller-supplied
// and used to be only ever consulted (not validated) while looping over
// order.Items — an ID belonging to a different order (or none at all) was
// silently discarded. Accept must now fail the whole call and leave every
// item's status untouched.
func TestAcceptRejectsForeignItemID(t *testing.T) {
	engine, repo, _ := setupEngine()
	order := &models.Order{
		ID:     1,
		Status: models.OrderSubmitted,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 1, PriceEach: 1000, Status: models.ItemPending},
			{ID: 2, MenuItemID: 11, Qty: 1, PriceEach: 1000, Status: models.ItemPending},
		},
	}
	_ = repo.Create(context.Background(), order)

	// item ID 2 is valid; 999 belongs to no order.
	_, err := engine.Accept(context.Background(), 1, []uint{2, 999})
	appErr := asAppError(t, err)
	if appErr == nil || appErr.Status != 400 {
		t.Fatalf("expected 400 bad request for a foreign item id, got %v", err)
	}

	o, _ := repo.FindByID(context.Background(), 1)
	if o.Status != models.OrderSubmitted {
		t.Errorf("expected order status untouched (still submitted), got %v", o.Status)
	}
	for _, it := range o.Items {
		if it.Status != models.ItemPending {
			t.Errorf("expected item %d status untouched (still pending), got %v", it.ID, it.Status)
		}
	}
}

// ---- V6: ExpiryTick must mark every non-rejected item on an expiring order as rejected ----

// TestExpiryTickRejectsAllItems guards V6: item status used to walk
// backwards to 'queued' for an allocated-but-unclaimed item on an expiring
// order, even though the order itself became terminal ('expired') — claiming
// the item was still waiting to be cooked. 'rejected' is the correct
// terminal item status, mirroring what Cancel/Reject already use.
func TestExpiryTickRejectsAllItems(t *testing.T) {
	engine, repo, pool := setupEngine()
	order := &models.Order{
		ID:        1,
		UserID:    42,
		Status:    models.OrderReady,
		ExpiresAt: timePtr(time.Now().Add(-time.Minute)),
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 2, AllocatedQty: 2, Status: models.ItemAllocated, PriceEach: 1000},
			{ID: 2, MenuItemID: 11, Qty: 1, AllocatedQty: 0, Status: models.ItemQueued, PriceEach: 1000},
		},
	}
	_ = repo.Create(context.Background(), order)

	if err := engine.ExpiryTick(context.Background()); err != nil {
		t.Fatalf("ExpiryTick: %v", err)
	}

	o, _ := repo.FindByID(context.Background(), 1)
	if o.Status != models.OrderExpired {
		t.Fatalf("expected order expired, got %v", o.Status)
	}
	for _, it := range o.Items {
		if it.Status != models.ItemRejected {
			t.Errorf("item %d: expected status rejected after expiry, got %v", it.ID, it.Status)
		}
	}
	if pool.pool[10] != 2 {
		t.Errorf("expected the allocated item's 2 units returned to the pool, got %d", pool.pool[10])
	}
}

func timePtr(t time.Time) *time.Time { return &t }

// ---- V5: student must be notified on Reject and on ExpiryTick, post-commit only ----

func TestRejectNotifiesStudentExactlyOnce(t *testing.T) {
	engine, repo, _ := setupEngine()
	fake := &fakeOrderNotifier{}
	engine.SetPushService(fake)

	order := &models.Order{
		ID:     1,
		UserID: 42,
		Status: models.OrderSubmitted,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 1, PriceEach: 1000, Status: models.ItemPending},
		},
	}
	_ = repo.Create(context.Background(), order)

	if _, err := engine.Reject(context.Background(), 1); err != nil {
		t.Fatalf("Reject: %v", err)
	}

	if len(fake.rejectedCalls) != 1 {
		t.Fatalf("expected exactly 1 NotifyOrderRejected call, got %d: %+v", len(fake.rejectedCalls), fake.rejectedCalls)
	}
	if fake.rejectedCalls[0].userID != 42 || fake.rejectedCalls[0].orderNo != order.OrderNo {
		t.Errorf("unexpected rejected call: %+v", fake.rejectedCalls[0])
	}
}

func TestRejectDoesNotNotifyOnCommitFailure(t *testing.T) {
	orderRepo := &mockOrderRepo{orders: make(map[uint]*models.Order)}
	menuRepo := &mockMenuRepo{}
	poolRepo := &mockPoolRepo{pool: make(map[uint]int)}
	eventRepo := &mockEventRepo{}
	statusRepo := &mockShopStatusRepo{status: &models.ShopStatus{ID: 1, State: string(models.ShopOpen)}}
	hub := realtime.NewHub()
	cfg := &config.Config{HoldMinutes: 10}
	alloc := &services.FCFSAllocation{}
	uow := &failingCommitUoW{commitErr: errors.New("simulated commit failure")}

	engine := services.NewPoolEngine(uow, orderRepo, menuRepo, poolRepo, eventRepo, statusRepo, hub, cfg, alloc)
	fake := &fakeOrderNotifier{}
	engine.SetPushService(fake)

	order := &models.Order{
		ID:     1,
		UserID: 42,
		Status: models.OrderSubmitted,
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 1, PriceEach: 1000, Status: models.ItemPending},
		},
	}
	_ = orderRepo.Create(context.Background(), order)

	if _, err := engine.Reject(context.Background(), 1); err == nil {
		t.Fatal("expected Reject to surface the simulated commit failure")
	}
	if len(fake.rejectedCalls) != 0 {
		t.Errorf("expected NO NotifyOrderRejected call when the commit fails, got %d: %+v", len(fake.rejectedCalls), fake.rejectedCalls)
	}
}

func TestExpiryTickNotifiesStudentExactlyOnce(t *testing.T) {
	engine, repo, _ := setupEngine()
	fake := &fakeOrderNotifier{}
	engine.SetPushService(fake)

	order := &models.Order{
		ID:        1,
		UserID:    42,
		Status:    models.OrderReady,
		ExpiresAt: timePtr(time.Now().Add(-time.Minute)),
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 1, AllocatedQty: 1, Status: models.ItemAllocated, PriceEach: 1000},
		},
	}
	_ = repo.Create(context.Background(), order)

	if err := engine.ExpiryTick(context.Background()); err != nil {
		t.Fatalf("ExpiryTick: %v", err)
	}

	if len(fake.expiredCalls) != 1 {
		t.Fatalf("expected exactly 1 NotifyOrderExpired call, got %d: %+v", len(fake.expiredCalls), fake.expiredCalls)
	}
	if fake.expiredCalls[0].userID != 42 || fake.expiredCalls[0].orderNo != order.OrderNo {
		t.Errorf("unexpected expired call: %+v", fake.expiredCalls[0])
	}
}

func TestExpiryTickDoesNotNotifyOnCommitFailure(t *testing.T) {
	orderRepo := &mockOrderRepo{orders: make(map[uint]*models.Order)}
	menuRepo := &mockMenuRepo{}
	poolRepo := &mockPoolRepo{pool: make(map[uint]int)}
	eventRepo := &mockEventRepo{}
	statusRepo := &mockShopStatusRepo{status: &models.ShopStatus{ID: 1, State: string(models.ShopOpen)}}
	hub := realtime.NewHub()
	cfg := &config.Config{HoldMinutes: 10}
	alloc := &services.FCFSAllocation{}
	uow := &failingCommitUoW{commitErr: errors.New("simulated commit failure")}

	engine := services.NewPoolEngine(uow, orderRepo, menuRepo, poolRepo, eventRepo, statusRepo, hub, cfg, alloc)
	fake := &fakeOrderNotifier{}
	engine.SetPushService(fake)

	order := &models.Order{
		ID:        1,
		UserID:    42,
		Status:    models.OrderReady,
		ExpiresAt: timePtr(time.Now().Add(-time.Minute)),
		Items: []models.OrderItem{
			{ID: 1, MenuItemID: 10, Qty: 1, AllocatedQty: 1, Status: models.ItemAllocated, PriceEach: 1000},
		},
	}
	_ = orderRepo.Create(context.Background(), order)

	if err := engine.ExpiryTick(context.Background()); err == nil {
		t.Fatal("expected ExpiryTick to surface the simulated commit failure")
	}
	if len(fake.expiredCalls) != 0 {
		t.Errorf("expected NO NotifyOrderExpired call when the commit fails, got %d: %+v", len(fake.expiredCalls), fake.expiredCalls)
	}
}
