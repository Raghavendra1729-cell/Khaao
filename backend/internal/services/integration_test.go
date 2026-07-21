//go:build integration

// Package services_test (integration half) exercises PoolEngine against a
// real, disposable Postgres — not the hand-written mock repos used by
// pool_test.go. The unit suite proves the *application logic* is right; these
// tests prove the same logic is still right when the database's own
// mechanics are involved: real transactions, real row locks
// (SELECT ... FOR UPDATE), the advisory-lock backstop in
// repository.GormUnitOfWork, and the partial unique index / FK constraints
// created by database.Open().
//
// Excluded from the default `go test ./...` run by the `integration` build
// tag. Run explicitly:
//
//	createdb khaao_test
//	TEST_DATABASE_URL="postgres://$(whoami)@localhost:5432/khaao_test?sslmode=disable" \
//	  go test -tags=integration -p 1 ./internal/services/... -race
//
// -p 1 matters as soon as more than this one package is run against the same
// database (e.g. `go test -tags=integration ./...`, which also picks up
// internal/repository's integration tests) — see the longer explanation in
// internal/repository/integration_test.go's header comment. Every test here
// truncates every application table at the start; without -p 1, `go test
// ./...`'s default cross-package parallelism lets one package's truncate
// wipe data out from under a concurrently-running test in the other
// package.
//
// Several tests deliberately build TWO independent *services.PoolEngine
// values sharing one *gorm.DB. PoolEngine.mu is a plain sync.Mutex field, so
// two separate engine instances have two independent in-process locks —
// exactly modeling "an accidental second replica" (see the comment on
// GormUnitOfWork.WithTx in internal/repository/gorm.go). If the code's
// correctness depended on the in-process mutex alone, these tests would show
// over-allocation or double-booking; they don't, because the DB-level
// advisory lock + row locks are the real backstop.
package services_test

import (
	"context"
	"fmt"
	"os"
	"os/user"
	"sync"
	"testing"
	"time"

	"khaao/internal/config"
	"khaao/internal/database"
	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/repository"
	"khaao/internal/services"

	"gorm.io/gorm"
)

func integrationTestDatabaseURL() string {
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}
	username := "postgres"
	if u, err := user.Current(); err == nil && u.Username != "" {
		username = u.Username
	}
	return "postgres://" + username + "@localhost:5432/khaao_test?sslmode=disable"
}

var integrationTables = []string{
	"order_events",
	"item_ratings",
	"push_subscriptions",
	"order_items",
	"orders",
	"item_pool",
	"menu_items",
	"shopkeeper_emails",
	"shop_statuses",
	"users",
}

func openIntegrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := integrationTestDatabaseURL()
	cfg := &config.Config{DatabaseURL: dsn, HoldMinutes: 15, BusinessTimezone: "Asia/Kolkata"}
	db, err := database.Open(cfg)
	if err != nil {
		t.Fatalf("open integration test db %q: %v (create it first: createdb khaao_test)", dsn, err)
	}
	for _, tbl := range integrationTables {
		if err := db.Exec("TRUNCATE TABLE " + tbl + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", tbl, err)
		}
	}
	return db
}

// integrationRepos bundles every repo PoolEngine needs, all backed by the
// same real *gorm.DB.
type integrationRepos struct {
	uow        repository.UnitOfWork
	orderRepo  repository.OrderRepo
	menuRepo   repository.MenuRepo
	poolRepo   repository.PoolRepo
	eventRepo  repository.EventRepo
	statusRepo repository.ShopStatusRepo
}

func newIntegrationRepos(db *gorm.DB) integrationRepos {
	return integrationRepos{
		uow:        repository.NewUnitOfWork(db),
		orderRepo:  repository.NewOrderRepo(db),
		menuRepo:   repository.NewMenuRepo(db),
		poolRepo:   repository.NewPoolRepo(db),
		eventRepo:  repository.NewEventRepo(db),
		statusRepo: repository.NewShopStatusRepo(db),
	}
}

// newIntegrationEngine builds a fresh *services.PoolEngine (its own
// sync.Mutex) over the given repos/config. Call it more than once against the
// same repos to model two independent app instances sharing one database.
func newIntegrationEngine(repos integrationRepos, cfg *config.Config) *services.PoolEngine {
	hub := realtime.NewHub()
	alloc := &services.FCFSAllocation{}
	return services.NewPoolEngine(repos.uow, repos.orderRepo, repos.menuRepo, repos.poolRepo, repos.eventRepo, repos.statusRepo, hub, cfg, alloc)
}

func seedIntegrationUser(t *testing.T, db *gorm.DB, email string) models.User {
	t.Helper()
	u := models.User{FirebaseUID: "fb-" + email, Email: email, Name: email, Role: models.RoleStudent}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("seed user %s: %v", email, err)
	}
	return u
}

func seedIntegrationMenuItem(t *testing.T, db *gorm.DB, name string, price int) models.MenuItem {
	t.Helper()
	mi := models.MenuItem{Name: name, Price: price, IsAvailable: true}
	if err := db.Create(&mi).Error; err != nil {
		t.Fatalf("seed menu item %s: %v", name, err)
	}
	return mi
}

// acceptedItemQty sums AllocatedQty for menuItemID across a set of freshly
// reloaded orders.
func sumAllocatedQty(orders []*models.Order, menuItemID uint) int {
	total := 0
	for _, o := range orders {
		for _, it := range o.Items {
			if it.MenuItemID == menuItemID {
				total += it.AllocatedQty
			}
		}
	}
	return total
}

// TestIntegration_ConcurrentOrderCreate_OnlyOneActiveOrderSurvives races two
// independent PoolEngine instances (modeling two app replicas, each with its
// own in-process mutex) both trying to CreateOrder for the SAME student at
// the same instant. Exactly one must win; the DB (advisory lock serializing
// every WithTx transaction, plus the partial unique index as the ultimate
// backstop) must guarantee only one active order ever exists for that user —
// never both, never neither.
func TestIntegration_ConcurrentOrderCreate_OnlyOneActiveOrderSurvives(t *testing.T) {
	db := openIntegrationDB(t)
	repos := newIntegrationRepos(db)
	cfg := &config.Config{HoldMinutes: 15, BusinessTimezone: "Asia/Kolkata"}

	student := seedIntegrationUser(t, db, "racer@sst.scaler.com")
	mi := seedIntegrationMenuItem(t, db, "Chai", 1000)

	engine1 := newIntegrationEngine(repos, cfg)
	engine2 := newIntegrationEngine(repos, cfg)

	ctx := context.Background()
	items := []services.OrderItemInput{{MenuItemID: mi.ID, Qty: 1}}

	var wg sync.WaitGroup
	start := make(chan struct{})
	var err1, err2 error

	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		_, err1 = engine1.CreateOrder(ctx, student.ID, items)
	}()
	go func() {
		defer wg.Done()
		<-start
		_, err2 = engine2.CreateOrder(ctx, student.ID, items)
	}()
	close(start)
	wg.Wait()

	successes := 0
	conflicts := 0
	for _, err := range []error{err1, err2} {
		switch err {
		case nil:
			successes++
		default:
			if appErr, ok := err.(*services.AppError); ok && appErr.Status == 409 {
				conflicts++
			} else {
				t.Errorf("unexpected error type/status: %v", err)
			}
		}
	}
	if successes != 1 {
		t.Errorf("expected exactly 1 successful CreateOrder, got %d (err1=%v err2=%v)", successes, err1, err2)
	}
	if conflicts != 1 {
		t.Errorf("expected exactly 1 conflict (409) CreateOrder, got %d (err1=%v err2=%v)", conflicts, err1, err2)
	}

	var count int64
	if err := db.Model(&models.Order{}).
		Where("user_id = ? AND status IN ?", student.ID, []string{"submitted", "preparing", "partially_ready", "ready", "awaiting_payment"}).
		Count(&count).Error; err != nil {
		t.Fatalf("count active orders: %v", err)
	}
	if count != 1 {
		t.Errorf("expected exactly 1 active order to exist after the race, found %d", count)
	}
}

// TestIntegration_ConcurrentAllocation_NoOverAllocationAcrossTwoEngineInstances
// is the real-DB proof behind PoolEngine.mu's doc comment: 6 distinct
// students each order 1 unit of the same menu item and are accepted (all
// queued, none allocated). Two independent PoolEngine instances then race to
// MarkDone 3 units each (6 total, exactly matching demand) for that item.
// Without correct row-locking, this is exactly the shape of bug that causes
// over-allocation (both transactions reading the same "remaining demand" and
// both allocating against it) or a lost update on item_pool. With it, the
// outcome must be exact: all 6 orders end up allocated=1, nothing left in the
// pool, and total allocated across every order is exactly 6 — never 5, never
// 7.
func TestIntegration_ConcurrentAllocation_NoOverAllocationAcrossTwoEngineInstances(t *testing.T) {
	db := openIntegrationDB(t)
	repos := newIntegrationRepos(db)
	cfg := &config.Config{HoldMinutes: 15, BusinessTimezone: "Asia/Kolkata"}

	mi := seedIntegrationMenuItem(t, db, "Low Stock Vada Pav", 2500)
	setupEngine := newIntegrationEngine(repos, cfg)
	ctx := context.Background()

	const n = 6
	orderIDs := make([]uint, 0, n)
	for i := 0; i < n; i++ {
		student := seedIntegrationUser(t, db, fmt.Sprintf("demand-student-%d@sst.scaler.com", i))
		resp, err := setupEngine.CreateOrder(ctx, student.ID, []services.OrderItemInput{{MenuItemID: mi.ID, Qty: 1}})
		if err != nil {
			t.Fatalf("setup CreateOrder #%d: %v", i, err)
		}
		if _, err := setupEngine.Accept(ctx, resp.ID, nil); err != nil {
			t.Fatalf("setup Accept #%d: %v", i, err)
		}
		orderIDs = append(orderIDs, resp.ID)
	}

	engine1 := newIntegrationEngine(repos, cfg)
	engine2 := newIntegrationEngine(repos, cfg)

	var wg sync.WaitGroup
	start := make(chan struct{})
	var err1, err2 error

	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		err1 = engine1.MarkDone(ctx, mi.ID, 3)
	}()
	go func() {
		defer wg.Done()
		<-start
		err2 = engine2.MarkDone(ctx, mi.ID, 3)
	}()
	close(start)
	wg.Wait()

	if err1 != nil {
		t.Errorf("engine1.MarkDone: %v", err1)
	}
	if err2 != nil {
		t.Errorf("engine2.MarkDone: %v", err2)
	}

	orders := make([]*models.Order, 0, n)
	for _, id := range orderIDs {
		o, err := repos.orderRepo.FindByID(ctx, id)
		if err != nil {
			t.Fatalf("reload order %d: %v", id, err)
		}
		if o == nil {
			t.Fatalf("order %d vanished", id)
		}
		orders = append(orders, o)
		if len(o.Items) != 1 {
			t.Fatalf("order %d: expected 1 item, got %d", id, len(o.Items))
		}
		if o.Items[0].AllocatedQty > o.Items[0].Qty {
			t.Errorf("order %d: over-allocated: allocated=%d qty=%d", id, o.Items[0].AllocatedQty, o.Items[0].Qty)
		}
		if o.Status != models.OrderReady {
			t.Errorf("order %d: expected status ready (fully allocated), got %v", id, o.Status)
		}
	}

	total := sumAllocatedQty(orders, mi.ID)
	if total != n {
		t.Errorf("expected total allocated across all %d orders == %d, got %d", n, n, total)
	}

	pool, err := repos.poolRepo.FindAll(ctx)
	if err != nil {
		t.Fatalf("read pool: %v", err)
	}
	if got := pool[mi.ID]; got != 0 {
		t.Errorf("expected pool fully drained (0 leftover), got %d", got)
	}
}

// TestIntegration_RejectReallocatesFCFS proves the re-pooling requirement
// end-to-end against real transactions: when a shopkeeper rejects an
// already-allocated order, its allocated units return to item_pool and are
// immediately re-assigned FCFS to the next order still waiting on that menu
// item — all inside the real Postgres row-locking/allocation path, not a
// mock.
func TestIntegration_RejectReallocatesFCFS(t *testing.T) {
	db := openIntegrationDB(t)
	repos := newIntegrationRepos(db)
	cfg := &config.Config{HoldMinutes: 15, BusinessTimezone: "Asia/Kolkata"}
	engine := newIntegrationEngine(repos, cfg)
	ctx := context.Background()

	mi := seedIntegrationMenuItem(t, db, "Masala Dosa", 4000)

	s1 := seedIntegrationUser(t, db, "fcfs-first@sst.scaler.com")
	first, err := engine.CreateOrder(ctx, s1.ID, []services.OrderItemInput{{MenuItemID: mi.ID, Qty: 2}})
	if err != nil {
		t.Fatalf("CreateOrder s1: %v", err)
	}
	if _, err := engine.Accept(ctx, first.ID, nil); err != nil {
		t.Fatalf("Accept s1: %v", err)
	}

	s2 := seedIntegrationUser(t, db, "fcfs-second@sst.scaler.com")
	second, err := engine.CreateOrder(ctx, s2.ID, []services.OrderItemInput{{MenuItemID: mi.ID, Qty: 1}})
	if err != nil {
		t.Fatalf("CreateOrder s2: %v", err)
	}
	if _, err := engine.Accept(ctx, second.ID, nil); err != nil {
		t.Fatalf("Accept s2: %v", err)
	}

	// Cook exactly 2 units — FCFS gives them entirely to the older order (s1).
	if err := engine.MarkDone(ctx, mi.ID, 2); err != nil {
		t.Fatalf("MarkDone: %v", err)
	}
	o1, _ := repos.orderRepo.FindByID(ctx, first.ID)
	if o1.Status != models.OrderReady || o1.Items[0].AllocatedQty != 2 {
		t.Fatalf("precondition failed: s1 expected ready/allocated=2, got status=%v allocated=%d", o1.Status, o1.Items[0].AllocatedQty)
	}
	o2, _ := repos.orderRepo.FindByID(ctx, second.ID)
	if o2.Items[0].AllocatedQty != 0 {
		t.Fatalf("precondition failed: s2 expected allocated=0 before reject, got %d", o2.Items[0].AllocatedQty)
	}

	// Reject s1 (allowed: ready, nothing handed over yet). Its 2 allocated
	// units must return to the pool and be re-assigned FCFS to s2.
	if _, err := engine.Reject(ctx, first.ID); err != nil {
		t.Fatalf("Reject: %v", err)
	}

	o1After, _ := repos.orderRepo.FindByID(ctx, first.ID)
	if o1After.Status != models.OrderRejected {
		t.Errorf("expected s1 rejected, got %v", o1After.Status)
	}
	if o1After.TotalPrice != 0 {
		t.Errorf("expected s1 total_price zeroed after reject, got %d", o1After.TotalPrice)
	}

	o2After, _ := repos.orderRepo.FindByID(ctx, second.ID)
	if o2After.Items[0].AllocatedQty != 1 {
		t.Errorf("expected s2 to receive 1 re-pooled unit via FCFS, got allocated=%d", o2After.Items[0].AllocatedQty)
	}
	if o2After.Status != models.OrderReady {
		t.Errorf("expected s2 ready after re-allocation, got %v", o2After.Status)
	}

	pool, err := repos.poolRepo.FindAll(ctx)
	if err != nil {
		t.Fatalf("read pool: %v", err)
	}
	if got := pool[mi.ID]; got != 1 {
		t.Errorf("expected 1 leftover unit in pool (2 returned - 1 re-consumed), got %d", got)
	}
}

// TestIntegration_ExpiryTick_ExpiresAndReallocatesFCFS uses HOLD_MINUTES=0 (a
// real, if degenerate, config value — not a mock) so a freshly-allocated
// order becomes immediately eligible for expiry. It confirms ExpiryTick, run
// against the real DB, both expires the stale ready order AND re-pools +
// re-allocates its units FCFS to the next order still waiting — the same
// invariant as the Reject test, but via the timeout path instead of an
// explicit shopkeeper action.
func TestIntegration_ExpiryTick_ExpiresAndReallocatesFCFS(t *testing.T) {
	db := openIntegrationDB(t)
	repos := newIntegrationRepos(db)
	cfg := &config.Config{HoldMinutes: 0, BusinessTimezone: "Asia/Kolkata"} // expires immediately once ready
	engine := newIntegrationEngine(repos, cfg)
	ctx := context.Background()

	mi := seedIntegrationMenuItem(t, db, "Cold Coffee", 3000)

	s1 := seedIntegrationUser(t, db, "expiry-first@sst.scaler.com")
	first, err := engine.CreateOrder(ctx, s1.ID, []services.OrderItemInput{{MenuItemID: mi.ID, Qty: 2}})
	if err != nil {
		t.Fatalf("CreateOrder s1: %v", err)
	}
	if _, err := engine.Accept(ctx, first.ID, nil); err != nil {
		t.Fatalf("Accept s1: %v", err)
	}

	s2 := seedIntegrationUser(t, db, "expiry-second@sst.scaler.com")
	second, err := engine.CreateOrder(ctx, s2.ID, []services.OrderItemInput{{MenuItemID: mi.ID, Qty: 1}})
	if err != nil {
		t.Fatalf("CreateOrder s2: %v", err)
	}
	if _, err := engine.Accept(ctx, second.ID, nil); err != nil {
		t.Fatalf("Accept s2: %v", err)
	}

	if err := engine.MarkDone(ctx, mi.ID, 2); err != nil {
		t.Fatalf("MarkDone: %v", err)
	}
	o1, _ := repos.orderRepo.FindByID(ctx, first.ID)
	if o1.Status != models.OrderReady || o1.ExpiresAt == nil {
		t.Fatalf("precondition failed: s1 expected ready with expires_at set, got status=%v expires_at=%v", o1.Status, o1.ExpiresAt)
	}

	// HOLD_MINUTES=0 means expires_at == ready_at; give the wall clock a
	// moment to move past it so the "< now()" comparison in
	// FindReadyExpiredForUpdate is unambiguously true.
	time.Sleep(50 * time.Millisecond)

	if err := engine.ExpiryTick(ctx); err != nil {
		t.Fatalf("ExpiryTick: %v", err)
	}

	o1After, _ := repos.orderRepo.FindByID(ctx, first.ID)
	if o1After.Status != models.OrderExpired {
		t.Errorf("expected s1 expired, got %v", o1After.Status)
	}

	o2After, _ := repos.orderRepo.FindByID(ctx, second.ID)
	if o2After.Items[0].AllocatedQty != 1 {
		t.Errorf("expected s2 to receive 1 re-pooled unit via FCFS after expiry, got allocated=%d", o2After.Items[0].AllocatedQty)
	}
	if o2After.Status != models.OrderReady {
		t.Errorf("expected s2 ready after post-expiry re-allocation, got %v", o2After.Status)
	}

	pool, err := repos.poolRepo.FindAll(ctx)
	if err != nil {
		t.Fatalf("read pool: %v", err)
	}
	if got := pool[mi.ID]; got != 1 {
		t.Errorf("expected 1 leftover unit in pool (2 returned - 1 re-consumed), got %d", got)
	}
}

// TestIntegration_ConcurrentAcceptAndSetPaused_CheckNeverMissesConcurrentAccept
// is the real-DB proof behind R14's fix: ShopStatusService.Set's
// accepted-order check and its save now happen inside one uow.WithTx, taking
// the same Postgres advisory lock every PoolEngine mutation (including
// Accept) takes — so Set's check-then-save can no longer straddle a
// concurrent Accept that commits in the gap between them.
//
// Before the fix, CountAccepted() and the subsequent Save() were two
// separate, lock-free calls: a concurrent Accept could run to completion
// entirely inside that gap, so the check's "0 accepted" result would already
// be stale by the time Save() unconditionally persisted "paused" — leaving
// the shop paused with an accepted order the check never saw. After the
// fix, whichever of Set's transaction or Accept's transaction acquires the
// advisory lock first runs to completion before the other starts, so there
// is no gap left for this to happen in: either Accept has already fully
// committed before Set's check runs (Set must then see it and 409), or
// Accept hasn't started at all when Set's transaction commits (in which
// case it's a legitimate subsequent event, not a check that missed
// something happening concurrently underneath it).
//
// Run as a stress loop (fresh order/user each trial) rather than a single
// shot, since which side wins the real lock race is not something a test
// can force — repeating it samples different interleavings across trials.
// The one outcome pair that must never appear is (Set succeeds, Accept
// succeeds via an accept that had already committed before Set's check ran)
// — that specific case is unreachable given the lock, and every trial's
// outcome must be internally self-consistent (see assertions below).
func TestIntegration_ConcurrentAcceptAndSetPaused_CheckNeverMissesConcurrentAccept(t *testing.T) {
	db := openIntegrationDB(t)
	repos := newIntegrationRepos(db)
	cfg := &config.Config{HoldMinutes: 15, BusinessTimezone: "Asia/Kolkata"}
	hub := realtime.NewHub()

	engine := newIntegrationEngine(repos, cfg)
	statusSvc := services.NewShopStatusService(repos.statusRepo, repos.orderRepo, repos.uow, hub)
	statusSvc.SetPool(engine)

	mi := seedIntegrationMenuItem(t, db, "Race Vada Pav", 1500)
	ctx := context.Background()

	const trials = 15
	for i := 0; i < trials; i++ {
		// Reset the shop to open before each trial (Set(paused) is a no-op
		// success if it's already paused, which would break the outcome
		// bookkeeping below). Upsert since the singleton row doesn't exist
		// until the first-ever Set() call creates it.
		if err := db.Exec(`INSERT INTO shop_statuses (id, state, reopen_at, updated_at)
			VALUES (1, 'open', NULL, now())
			ON CONFLICT (id) DO UPDATE SET state = 'open', reopen_at = NULL`).Error; err != nil {
			t.Fatalf("trial %d: reset shop status: %v", i, err)
		}

		student := seedIntegrationUser(t, db, fmt.Sprintf("pause-race-%d@sst.scaler.com", i))
		order, err := engine.CreateOrder(ctx, student.ID, []services.OrderItemInput{{MenuItemID: mi.ID, Qty: 1}})
		if err != nil {
			t.Fatalf("trial %d: setup CreateOrder: %v", i, err)
		}

		var wg sync.WaitGroup
		start := make(chan struct{})
		var acceptErr, setErr error

		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			_, acceptErr = engine.Accept(ctx, order.ID, nil)
		}()
		go func() {
			defer wg.Done()
			<-start
			_, setErr = statusSvc.Set(ctx, "paused", nil)
		}()
		close(start)
		wg.Wait()

		acceptOK := acceptErr == nil
		setOK := setErr == nil

		if !acceptOK {
			if appErr, ok := acceptErr.(*services.AppError); !ok || appErr.Status != 409 {
				t.Fatalf("trial %d: unexpected Accept error: %v", i, acceptErr)
			}
		}
		if !setOK {
			if appErr, ok := setErr.(*services.AppError); !ok || appErr.Status != 409 {
				t.Fatalf("trial %d: unexpected Set error: %v", i, setErr)
			}
			// Set can only fail because it saw an accepted order — which
			// means Accept must have won the race and succeeded.
			if !acceptOK {
				t.Fatalf("trial %d: Set failed with 409 but Accept also failed (%v) — nothing should have been accepted for Set to see", i, acceptErr)
			}
		}

		// Whatever happened, the persisted state must be internally
		// consistent — no torn writes, no impossible combination.
		reloadedOrder, err := repos.orderRepo.FindByID(ctx, order.ID)
		if err != nil || reloadedOrder == nil {
			t.Fatalf("trial %d: reload order: %v", i, err)
		}
		var status models.ShopStatus
		if err := db.First(&status, 1).Error; err != nil {
			t.Fatalf("trial %d: reload shop status: %v", i, err)
		}

		if acceptOK && reloadedOrder.Status == models.OrderSubmitted {
			t.Errorf("trial %d: Accept succeeded but order is still submitted", i)
		}
		if setOK && status.State != string(models.ShopPaused) {
			t.Errorf("trial %d: Set succeeded but shop state is %q, not paused", i, status.State)
		}
		if !setOK && status.State == string(models.ShopPaused) {
			t.Errorf("trial %d: Set failed but shop ended up paused anyway", i)
		}
	}
}

// TestIntegration_MutationResponsesIncludeStudentName exercises Reject,
// Handover, and Paid against a real DB and checks their *returned*
// OrderResponse — not just the order's final state — carries the student's
// name/email. mockOrderRepo in pool_test.go can't catch a regression here: its
// FindByID and FindByIDForUpdate both just return the same in-memory pointer,
// so it doesn't model GORM's real behavior of FindByIDForUpdate deliberately
// skipping Preload("User") (only FindByID loads it) — a mutation that builds
// its includeStudent=true response from the transaction-scoped order instead
// of re-fetching via FindByID silently ships empty student_name/student_email
// to the shopkeeper UI, and only a real Preload exercises that gap.
func TestIntegration_MutationResponsesIncludeStudentName(t *testing.T) {
	db := openIntegrationDB(t)
	repos := newIntegrationRepos(db)
	cfg := &config.Config{HoldMinutes: 15, BusinessTimezone: "Asia/Kolkata"}
	engine := newIntegrationEngine(repos, cfg)
	ctx := context.Background()

	mi := seedIntegrationMenuItem(t, db, "Chai", 1000)

	// Reject: accept then immediately reject (the shopkeeper "escape hatch"
	// path — allowed since nothing's been handed over yet).
	rejecter := seedIntegrationUser(t, db, "reject-me@sst.scaler.com")
	toReject, err := engine.CreateOrder(ctx, rejecter.ID, []services.OrderItemInput{{MenuItemID: mi.ID, Qty: 1}})
	if err != nil {
		t.Fatalf("CreateOrder (reject case): %v", err)
	}
	if _, err := engine.Accept(ctx, toReject.ID, nil); err != nil {
		t.Fatalf("Accept (reject case): %v", err)
	}
	rejectResp, err := engine.Reject(ctx, toReject.ID)
	if err != nil {
		t.Fatalf("Reject: %v", err)
	}
	if rejectResp.StudentName != rejecter.Name || rejectResp.StudentEmail != rejecter.Email {
		t.Errorf("Reject response missing student info: got name=%q email=%q, want name=%q email=%q",
			rejectResp.StudentName, rejectResp.StudentEmail, rejecter.Name, rejecter.Email)
	}

	// Handover then Paid, on a second order, carried through the full
	// accept -> cook -> handover -> paid lifecycle.
	payer := seedIntegrationUser(t, db, "pay-me@sst.scaler.com")
	toPay, err := engine.CreateOrder(ctx, payer.ID, []services.OrderItemInput{{MenuItemID: mi.ID, Qty: 1}})
	if err != nil {
		t.Fatalf("CreateOrder (handover/paid case): %v", err)
	}
	if _, err := engine.Accept(ctx, toPay.ID, nil); err != nil {
		t.Fatalf("Accept (handover/paid case): %v", err)
	}
	if err := engine.MarkDone(ctx, mi.ID, 1); err != nil {
		t.Fatalf("MarkDone: %v", err)
	}
	loaded, err := repos.orderRepo.FindByID(ctx, toPay.ID)
	if err != nil || loaded == nil {
		t.Fatalf("reload before handover: %v", err)
	}
	itemID := loaded.Items[0].ID

	handoverResp, err := engine.Handover(ctx, toPay.ID, itemID, 1)
	if err != nil {
		t.Fatalf("Handover: %v", err)
	}
	if handoverResp.StudentName != payer.Name || handoverResp.StudentEmail != payer.Email {
		t.Errorf("Handover response missing student info: got name=%q email=%q, want name=%q email=%q",
			handoverResp.StudentName, handoverResp.StudentEmail, payer.Name, payer.Email)
	}

	paidResp, err := engine.Paid(ctx, toPay.ID)
	if err != nil {
		t.Fatalf("Paid: %v", err)
	}
	if paidResp.StudentName != payer.Name || paidResp.StudentEmail != payer.Email {
		t.Errorf("Paid response missing student info: got name=%q email=%q, want name=%q email=%q",
			paidResp.StudentName, paidResp.StudentEmail, payer.Name, payer.Email)
	}
}
