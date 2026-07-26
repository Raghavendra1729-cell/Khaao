//go:build integration

// Package repository_test contains integration tests that run against a real,
// disposable Postgres instance — never against the mock repos used by the
// fast unit suite. These prove that Postgres itself (not just Go-level
// application logic) enforces the invariants the schema declares: unique
// constraints, partial unique indexes, and foreign keys.
//
// They are excluded from the default `go test ./...` run by the `integration`
// build tag. Run them explicitly:
//
//	createdb khaao_test
//	TEST_DATABASE_URL="postgres://$(whoami)@localhost:5432/khaao_test?sslmode=disable" \
//	  go test -tags=integration -p 1 ./internal/repository/... -race
//
// If TEST_DATABASE_URL is unset, it defaults to
// postgres://<current-user>@localhost:5432/khaao_test?sslmode=disable, which
// matches the convention already used for devDefaultDatabaseURL in
// internal/config/config.go.
//
// -p 1 matters when running more than this one package against the same
// database (e.g. `go test -tags=integration ./...`, which also picks up
// internal/services' integration tests): `go test ./...` runs different
// packages' test binaries concurrently by default, and every test here
// truncates every application table at the start of every test. Without
// -p 1, one package's truncate can wipe data mid-test out from under a test
// running concurrently in another package against the same shared
// khaao_test database — this was caught empirically, not theorized: running
// both packages together without -p 1 produced a spurious FK-violation
// failure from exactly this cross-package interference.
package repository_test

import (
	"context"
	"errors"
	"os"
	"os/user"
	"strings"
	"sync"
	"testing"
	"time"

	"khaao/internal/config"
	"khaao/internal/database"
	"khaao/internal/models"
	"khaao/internal/repository"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// testDatabaseURL resolves the DSN for the disposable integration-test
// database: TEST_DATABASE_URL if set, else a same-machine default DSN for the
// current OS user against a database named khaao_test.
func testDatabaseURL(t *testing.T) string {
	t.Helper()
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}
	u, err := user.Current()
	username := "postgres"
	if err == nil && u.Username != "" {
		username = u.Username
	}
	return "postgres://" + username + "@localhost:5432/khaao_test?sslmode=disable"
}

// allTables lists every application table, in an order safe for
// TRUNCATE ... CASCADE (order doesn't actually matter with CASCADE, but this
// keeps the list self-documenting).
var allTables = []string{
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

// openIntegrationDB opens a real connection to the disposable test database
// (schema created via the same database.Open() the server itself calls — no
// separate migration mechanism to keep in sync) and truncates every
// application table so each test starts from a clean slate.
func openIntegrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := testDatabaseURL(t)
	cfg := &config.Config{
		DatabaseURL:      dsn,
		HoldMinutes:      15,
		BusinessTimezone: "Asia/Kolkata",
	}
	db, err := database.Open(cfg)
	if err != nil {
		t.Fatalf("open integration test db %q: %v (create it first: createdb khaao_test)", dsn, err)
	}
	for _, tbl := range allTables {
		if err := db.Exec("TRUNCATE TABLE " + tbl + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", tbl, err)
		}
	}
	return db
}

// openIntegrationDBNoTruncate opens a second, independent connection pool to
// the same disposable test database without truncating anything — used
// alongside openIntegrationDB(t) (which owns the truncate-and-seed side of a
// test) when a test needs a genuinely separate Postgres backend/connection,
// e.g. to prove a row lock taken by one transaction blocks another connection
// (NOWAIT) rather than just re-using the same *gorm.DB from the same goroutine.
func openIntegrationDBNoTruncate(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := testDatabaseURL(t)
	cfg := &config.Config{
		DatabaseURL:      dsn,
		HoldMinutes:      15,
		BusinessTimezone: "Asia/Kolkata",
	}
	db, err := database.Open(cfg)
	if err != nil {
		t.Fatalf("open second integration test db connection %q: %v", dsn, err)
	}
	return db
}

func pgErrorCode(err error) (code, constraint string) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code, pgErr.ConstraintName
	}
	return "", ""
}

// seedUser inserts a bare-minimum user row directly (bypassing any service
// logic — these tests exercise the schema, not the app).
func seedUser(t *testing.T, db *gorm.DB, email string) models.User {
	t.Helper()
	u := models.User{
		FirebaseUID: "fb-" + email,
		Email:       email,
		Name:        email,
		Role:        models.RoleStudent,
	}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("seed user %s: %v", email, err)
	}
	return u
}

func seedMenuItem(t *testing.T, db *gorm.DB, name string, price int) models.MenuItem {
	t.Helper()
	mi := models.MenuItem{Name: name, Price: price, IsAvailable: true}
	if err := db.Create(&mi).Error; err != nil {
		t.Fatalf("seed menu item %s: %v", name, err)
	}
	return mi
}

// seedShopkeeper inserts a bare-minimum shopkeeper user row.
func seedShopkeeper(t *testing.T, db *gorm.DB, email string) models.User {
	t.Helper()
	u := models.User{
		FirebaseUID: "fb-" + email,
		Email:       email,
		Name:        email,
		Role:        models.RoleShopkeeper,
	}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("seed shopkeeper %s: %v", email, err)
	}
	return u
}

// lunchMenu is the scenario-like fixture used by the Q2 repository-method
// tests below: a small canteen lunch menu, not a single throwaway row. Prices
// are in paise, matching database.seedSampleMenu's convention.
type lunchMenu struct {
	Samosa     models.MenuItem
	MasalaDosa models.MenuItem
	Chai       models.MenuItem
	ColdCoffee models.MenuItem
}

func seedLunchMenu(t *testing.T, db *gorm.DB) lunchMenu {
	t.Helper()
	return lunchMenu{
		Samosa:     seedMenuItem(t, db, "Samosa", 1500),
		MasalaDosa: seedMenuItem(t, db, "Masala Dosa", 4000),
		Chai:       seedMenuItem(t, db, "Chai", 1000),
		ColdCoffee: seedMenuItem(t, db, "Cold Coffee", 3000),
	}
}

// seedOrderWithItems creates an order row and its order_items in one go,
// wiring up OrderID after the order is assigned an ID. CreatedAt on both the
// order and any item that has a non-zero CreatedAt set by the caller is
// preserved verbatim by GORM (AutoCreateTime only fires for a zero value),
// which is what lets ordering-sensitive tests below control "oldest first".
func seedOrderWithItems(t *testing.T, db *gorm.DB, userID uint, orderNo int, date string, status models.OrderStatus, createdAt time.Time, items []models.OrderItem) models.Order {
	t.Helper()
	order := models.Order{
		UserID:    userID,
		OrderNo:   orderNo,
		OrderDate: date,
		Status:    status,
		CreatedAt: createdAt,
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatalf("seed order (user=%d no=%d date=%s status=%s): %v", userID, orderNo, date, status, err)
	}
	for i := range items {
		items[i].OrderID = order.ID
		if items[i].Status == "" {
			items[i].Status = models.ItemPending
		}
		if err := db.Create(&items[i]).Error; err != nil {
			t.Fatalf("seed order item %q for order %d: %v", items[i].Name, order.ID, err)
		}
	}
	order.Items = items
	return order
}

// orderItemFor builds an OrderItem snapshot from a menu item, the same way
// the order-creation service copies name/price/photo at order time.
func orderItemFor(mi models.MenuItem, qty int) models.OrderItem {
	return models.OrderItem{
		MenuItemID: mi.ID,
		Name:       mi.Name,
		PhotoURL:   mi.PhotoURL,
		PriceEach:  mi.Price,
		Qty:        qty,
		Status:     models.ItemPending,
	}
}

// TestIntegration_UniqueActiveOrderPerUser_DBEnforced proves that the partial
// unique index uniq_active_order_per_user (see database/database.go) rejects
// a second concurrently-inserted active order for the same user at the
// Postgres level — with no application-side mutex or pre-check in the way at
// all. Both inserts go straight through db.Create with distinct order_no
// values (so the only unique constraint that can possibly fire is the
// per-user partial index, not idx_orders_date_no).
func TestIntegration_UniqueActiveOrderPerUser_DBEnforced(t *testing.T) {
	db := openIntegrationDB(t)
	student := seedUser(t, db, "student-active-order@sst.scaler.com")

	const n = 8
	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make([]error, n)

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			order := models.Order{
				UserID:    student.ID,
				OrderNo:   i + 1, // distinct per goroutine: isolates the active-order index
				OrderDate: "2026-07-14",
				Status:    models.OrderSubmitted,
			}
			errs[i] = db.Create(&order).Error
		}(i)
	}
	close(start)
	wg.Wait()

	successes := 0
	uniqueViolations := 0
	for _, err := range errs {
		if err == nil {
			successes++
			continue
		}
		code, constraint := pgErrorCode(err)
		if code == "23505" && constraint == "uniq_active_order_per_user" {
			uniqueViolations++
		} else {
			t.Errorf("unexpected error (not a uniq_active_order_per_user violation): %v", err)
		}
	}

	if successes != 1 {
		t.Errorf("expected exactly 1 successful insert, got %d", successes)
	}
	if uniqueViolations != n-1 {
		t.Errorf("expected %d unique-violations on uniq_active_order_per_user, got %d", n-1, uniqueViolations)
	}

	var count int64
	if err := db.Model(&models.Order{}).
		Where("user_id = ? AND status IN ?", student.ID, []string{"submitted", "preparing", "partially_ready", "ready", "awaiting_payment"}).
		Count(&count).Error; err != nil {
		t.Fatalf("count active orders: %v", err)
	}
	if count != 1 {
		t.Errorf("expected exactly 1 active order row to survive, found %d", count)
	}
}

// TestIntegration_UniqueActiveOrderPerUser_AllowsOneTerminatedOnePlusActive
// is a sanity check that the partial index only restricts active statuses —
// a user can freely have any number of terminal (rejected/cancelled/expired/
// completed) orders alongside one active one.
func TestIntegration_UniqueActiveOrderPerUser_AllowsTerminalPlusOneActive(t *testing.T) {
	db := openIntegrationDB(t)
	student := seedUser(t, db, "student-terminal-plus-active@sst.scaler.com")

	terminalStatuses := []models.OrderStatus{models.OrderRejected, models.OrderCancelled, models.OrderExpired, models.OrderCompleted}
	for i, st := range terminalStatuses {
		o := models.Order{UserID: student.ID, OrderNo: i + 1, OrderDate: "2026-07-14", Status: st}
		if err := db.Create(&o).Error; err != nil {
			t.Fatalf("create terminal order (%s): %v", st, err)
		}
	}
	active := models.Order{UserID: student.ID, OrderNo: 99, OrderDate: "2026-07-14", Status: models.OrderSubmitted}
	if err := db.Create(&active).Error; err != nil {
		t.Fatalf("create the one active order: %v", err)
	}
}

// TestIntegration_ForeignKeyEnforcement_OrderItemRequiresOrder proves
// order_items_order_id_fkey rejects an order_item row whose order_id points at a
// nonexistent order — a raw insert, no service-layer validation involved.
func TestIntegration_ForeignKeyEnforcement_OrderItemRequiresOrder(t *testing.T) {
	db := openIntegrationDB(t)
	mi := seedMenuItem(t, db, "Samosa", 1500)

	item := models.OrderItem{
		OrderID:    999999, // does not exist
		MenuItemID: mi.ID,
		Name:       mi.Name,
		PriceEach:  mi.Price,
		Qty:        1,
		Status:     models.ItemPending,
	}
	err := db.Create(&item).Error
	if err == nil {
		t.Fatal("expected an error inserting an order_item with a nonexistent order_id, got nil")
	}
	code, constraint := pgErrorCode(err)
	if code != "23503" || constraint != "order_items_order_id_fkey" {
		t.Errorf("expected FK violation 23503 on order_items_order_id_fkey, got code=%q constraint=%q err=%v", code, constraint, err)
	}
}

// TestIntegration_ForeignKeyEnforcement_OrderItemRequiresMenuItem proves
// order_items_menu_item_id_fkey rejects an order_item row whose menu_item_id
// points at a nonexistent menu item.
func TestIntegration_ForeignKeyEnforcement_OrderItemRequiresMenuItem(t *testing.T) {
	db := openIntegrationDB(t)
	student := seedUser(t, db, "student-fk-menu@sst.scaler.com")
	order := models.Order{UserID: student.ID, OrderNo: 1, OrderDate: "2026-07-14", Status: models.OrderSubmitted}
	if err := db.Create(&order).Error; err != nil {
		t.Fatalf("create order: %v", err)
	}

	item := models.OrderItem{
		OrderID:    order.ID,
		MenuItemID: 999999, // does not exist
		Name:       "ghost item",
		PriceEach:  1000,
		Qty:        1,
		Status:     models.ItemPending,
	}
	err := db.Create(&item).Error
	if err == nil {
		t.Fatal("expected an error inserting an order_item with a nonexistent menu_item_id, got nil")
	}
	code, constraint := pgErrorCode(err)
	if code != "23503" || constraint != "order_items_menu_item_id_fkey" {
		t.Errorf("expected FK violation 23503 on order_items_menu_item_id_fkey, got code=%q constraint=%q err=%v", code, constraint, err)
	}
}

// TestIntegration_ForeignKeyEnforcement_OrderRequiresUser proves
// orders_user_id_fkey rejects an order row whose user_id points at a nonexistent
// user.
func TestIntegration_ForeignKeyEnforcement_OrderRequiresUser(t *testing.T) {
	db := openIntegrationDB(t)
	order := models.Order{UserID: 999999, OrderNo: 1, OrderDate: "2026-07-14", Status: models.OrderSubmitted}
	err := db.Create(&order).Error
	if err == nil {
		t.Fatal("expected an error inserting an order with a nonexistent user_id, got nil")
	}
	code, constraint := pgErrorCode(err)
	if code != "23503" || constraint != "orders_user_id_fkey" {
		t.Errorf("expected FK violation 23503 on orders_user_id_fkey, got code=%q constraint=%q err=%v", code, constraint, err)
	}
}

// TestIntegration_OrderNoUniquePerDate_DBEnforced proves idx_orders_date_no
// (UNIQUE on order_no, order_date) rejects a duplicate daily order token —
// this is the counter shown to students/shopkeeper ("order #12 today"), so a
// collision would be a real user-facing bug, not just an internal one.
func TestIntegration_OrderNoUniquePerDate_DBEnforced(t *testing.T) {
	db := openIntegrationDB(t)
	s1 := seedUser(t, db, "student-orderno-1@sst.scaler.com")
	s2 := seedUser(t, db, "student-orderno-2@sst.scaler.com")

	o1 := models.Order{UserID: s1.ID, OrderNo: 1, OrderDate: "2026-07-14", Status: models.OrderCompleted}
	if err := db.Create(&o1).Error; err != nil {
		t.Fatalf("create first order: %v", err)
	}
	o2 := models.Order{UserID: s2.ID, OrderNo: 1, OrderDate: "2026-07-14", Status: models.OrderCompleted}
	err := db.Create(&o2).Error
	if err == nil {
		t.Fatal("expected a duplicate order_no+order_date to be rejected")
	}
	code, constraint := pgErrorCode(err)
	if code != "23505" || constraint != "idx_orders_date_no" {
		t.Errorf("expected unique violation on idx_orders_date_no, got code=%q constraint=%q err=%v", code, constraint, err)
	}

	// A different date is fine.
	o3 := models.Order{UserID: s2.ID, OrderNo: 1, OrderDate: "2026-07-15", Status: models.OrderCompleted}
	if err := db.Create(&o3).Error; err != nil {
		t.Errorf("expected same order_no on a different order_date to succeed, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Q2: repository query-method coverage. The tests above prove Postgres
// enforces the schema's declared invariants; the tests below prove the
// hand-written queries in repository/gorm.go (locking, ordering, eager
// loading, the pool's UPDATE-then-INSERT dance, and soft-delete snapshotting)
// actually do what their doc comments say against a real database. Fixtures
// model a small canteen scenario — one shopkeeper, three students, a lunch
// menu — rather than single-row minimal setups.

// TestIntegration_FindActiveByUserIDForUpdate_ReturnsTheOneActiveOrderWithItems
// proves FindActiveByUserIDForUpdate picks out the single active order for a
// user (ignoring their terminal orders) and eager-loads its items, oldest
// item first.
func TestIntegration_FindActiveByUserIDForUpdate_ReturnsTheOneActiveOrderWithItems(t *testing.T) {
	db := openIntegrationDB(t)
	_ = seedShopkeeper(t, db, "shopkeeper@sst.scaler.com")
	s1, s2, s3 := seedUser(t, db, "asha@sst.scaler.com"), seedUser(t, db, "bilal@sst.scaler.com"), seedUser(t, db, "chitra@sst.scaler.com")
	menu := seedLunchMenu(t, db)
	ctx := context.Background()

	// A terminal order for s1 (should never be picked up)...
	seedOrderWithItems(t, db, s1.ID, 1, "2026-07-14", models.OrderCompleted, time.Now().Add(-2*time.Hour),
		[]models.OrderItem{orderItemFor(menu.Samosa, 2)})
	// ...and s1's one active order, with two items seeded out of created_at
	// order so the eager-load's own ordering is what puts them back in order.
	base := time.Now().Add(-time.Hour)
	active := seedOrderWithItems(t, db, s1.ID, 2, "2026-07-14", models.OrderPreparing, base,
		[]models.OrderItem{})
	item2 := orderItemFor(menu.Chai, 1)
	item2.OrderID = active.ID
	item2.CreatedAt = base.Add(2 * time.Minute)
	if err := db.Create(&item2).Error; err != nil {
		t.Fatalf("seed item2: %v", err)
	}
	item1 := orderItemFor(menu.MasalaDosa, 1)
	item1.OrderID = active.ID
	item1.CreatedAt = base.Add(1 * time.Minute)
	if err := db.Create(&item1).Error; err != nil {
		t.Fatalf("seed item1: %v", err)
	}

	// Other students have their own orders; FindActiveByUserIDForUpdate must
	// not leak across users.
	seedOrderWithItems(t, db, s2.ID, 3, "2026-07-14", models.OrderReady, time.Now(),
		[]models.OrderItem{orderItemFor(menu.ColdCoffee, 1)})
	seedOrderWithItems(t, db, s3.ID, 4, "2026-07-14", models.OrderSubmitted, time.Now(),
		[]models.OrderItem{orderItemFor(menu.Chai, 3)})

	repo := repository.NewOrderRepo(db)
	got, err := repo.FindActiveByUserIDForUpdate(ctx, s1.ID)
	if err != nil {
		t.Fatalf("FindActiveByUserIDForUpdate: %v", err)
	}
	if got == nil {
		t.Fatal("expected an active order, got nil")
	}
	if got.ID != active.ID {
		t.Errorf("expected active order id %d, got %d", active.ID, got.ID)
	}
	if len(got.Items) != 2 {
		t.Fatalf("expected 2 items on the active order, got %d", len(got.Items))
	}
	if got.Items[0].Name != menu.MasalaDosa.Name || got.Items[1].Name != menu.Chai.Name {
		t.Errorf("expected items oldest-first (Masala Dosa, Chai), got (%s, %s)", got.Items[0].Name, got.Items[1].Name)
	}

	// A student with no active order at all gets (nil, nil), not an error.
	s4 := seedUser(t, db, "deepak@sst.scaler.com")
	none, err := repo.FindActiveByUserIDForUpdate(ctx, s4.ID)
	if err != nil {
		t.Fatalf("FindActiveByUserIDForUpdate for a student with no orders: %v", err)
	}
	if none != nil {
		t.Errorf("expected nil for a student with no active order, got %+v", none)
	}
}

// TestIntegration_FindActiveByUserIDForUpdate_LocksTheRow proves the method's
// FOR UPDATE clause actually takes a Postgres row lock that a second
// connection collides with: a second connection's own SELECT ... FOR UPDATE
// NOWAIT on the same row must fail with 55P03 (lock_not_available) while the
// first transaction is still open, and succeed once it commits.
func TestIntegration_FindActiveByUserIDForUpdate_LocksTheRow(t *testing.T) {
	db := openIntegrationDB(t)
	student := seedUser(t, db, "locking-student@sst.scaler.com")
	menu := seedLunchMenu(t, db)
	ctx := context.Background()

	active := seedOrderWithItems(t, db, student.ID, 1, "2026-07-14", models.OrderSubmitted, time.Now(),
		[]models.OrderItem{orderItemFor(menu.Samosa, 1)})

	locked := make(chan struct{})
	release := make(chan struct{})
	txErrCh := make(chan error, 1)

	go func() {
		txErrCh <- db.Transaction(func(tx *gorm.DB) error {
			repo := repository.NewOrderRepo(tx)
			if _, err := repo.FindActiveByUserIDForUpdate(ctx, student.ID); err != nil {
				return err
			}
			close(locked)
			<-release
			return nil
		})
	}()

	<-locked
	second := openIntegrationDBNoTruncate(t)
	var id uint
	nowaitErr := second.Raw("SELECT id FROM orders WHERE id = ? FOR UPDATE NOWAIT", active.ID).Scan(&id).Error
	close(release)
	if err := <-txErrCh; err != nil {
		t.Fatalf("locking transaction: %v", err)
	}

	if nowaitErr == nil {
		t.Fatal("expected the second connection's FOR UPDATE NOWAIT to fail while the first transaction held the lock, got nil")
	}
	code, _ := pgErrorCode(nowaitErr)
	if code != "55P03" {
		t.Errorf("expected lock_not_available (55P03), got code=%q err=%v", code, nowaitErr)
	}

	// After the first transaction commits, the same NOWAIT select succeeds.
	if err := second.Raw("SELECT id FROM orders WHERE id = ? FOR UPDATE NOWAIT", active.ID).Scan(&id).Error; err != nil {
		t.Errorf("expected NOWAIT select to succeed after the lock was released, got: %v", err)
	}
}

// TestIntegration_FindIncomingForUpdate_LocksTheRow guards V10: every other
// engine mutation loads its target through a …ForUpdate variant before
// Save-ing it; RejectAllSubmitted used to be the one exception, reading via
// plain FindIncoming and only relying on WithTx's advisory lock to keep it
// safe. Same NOWAIT-from-a-second-connection shape as
// TestIntegration_FindActiveByUserIDForUpdate_LocksTheRow above, proving
// FindIncomingForUpdate now takes its own row lock too.
func TestIntegration_FindIncomingForUpdate_LocksTheRow(t *testing.T) {
	db := openIntegrationDB(t)
	student := seedUser(t, db, "incoming-student@sst.scaler.com")
	menu := seedLunchMenu(t, db)
	ctx := context.Background()

	submitted := seedOrderWithItems(t, db, student.ID, 1, "2026-07-14", models.OrderSubmitted, time.Now(),
		[]models.OrderItem{orderItemFor(menu.Samosa, 1)})

	locked := make(chan struct{})
	release := make(chan struct{})
	txErrCh := make(chan error, 1)

	go func() {
		txErrCh <- db.Transaction(func(tx *gorm.DB) error {
			repo := repository.NewOrderRepo(tx)
			if _, err := repo.FindIncomingForUpdate(ctx); err != nil {
				return err
			}
			close(locked)
			<-release
			return nil
		})
	}()

	<-locked
	second := openIntegrationDBNoTruncate(t)
	var id uint
	nowaitErr := second.Raw("SELECT id FROM orders WHERE id = ? FOR UPDATE NOWAIT", submitted.ID).Scan(&id).Error
	close(release)
	if err := <-txErrCh; err != nil {
		t.Fatalf("locking transaction: %v", err)
	}

	if nowaitErr == nil {
		t.Fatal("expected the second connection's FOR UPDATE NOWAIT to fail while the first transaction held the lock, got nil")
	}
	code, _ := pgErrorCode(nowaitErr)
	if code != "55P03" {
		t.Errorf("expected lock_not_available (55P03), got code=%q err=%v", code, nowaitErr)
	}

	if err := second.Raw("SELECT id FROM orders WHERE id = ? FOR UPDATE NOWAIT", submitted.ID).Scan(&id).Error; err != nil {
		t.Errorf("expected NOWAIT select to succeed after the lock was released, got: %v", err)
	}
}

// TestIntegration_FindPreparingOldestForUpdate_OrdersOldestFirstWithItems
// proves the method returns only preparing/partially_ready orders, strictly
// oldest-created-first, with each order's items eager-loaded (also
// oldest-first) rather than in arbitrary DB order.
func TestIntegration_FindPreparingOldestForUpdate_OrdersOldestFirstWithItems(t *testing.T) {
	db := openIntegrationDB(t)
	s1, s2, s3 := seedUser(t, db, "prep-1@sst.scaler.com"), seedUser(t, db, "prep-2@sst.scaler.com"), seedUser(t, db, "prep-3@sst.scaler.com")
	// Separate students for the excluded orders below: uniq_active_order_per_user
	// forbids a second active order for a student who already has one (s1/s2
	// already own an active preparing order each).
	s4, s5 := seedUser(t, db, "prep-4@sst.scaler.com"), seedUser(t, db, "prep-5@sst.scaler.com")
	menu := seedLunchMenu(t, db)
	ctx := context.Background()

	now := time.Now()
	// Seeded out of chronological order on purpose: the query must sort, not
	// just reflect insertion order.
	newest := seedOrderWithItems(t, db, s3.ID, 3, "2026-07-14", models.OrderPartiallyReady, now.Add(-1*time.Minute),
		[]models.OrderItem{orderItemFor(menu.Chai, 2)})
	oldest := seedOrderWithItems(t, db, s1.ID, 1, "2026-07-14", models.OrderPreparing, now.Add(-30*time.Minute),
		[]models.OrderItem{orderItemFor(menu.Samosa, 1), orderItemFor(menu.MasalaDosa, 1)})
	middle := seedOrderWithItems(t, db, s2.ID, 2, "2026-07-14", models.OrderPreparing, now.Add(-10*time.Minute),
		[]models.OrderItem{orderItemFor(menu.ColdCoffee, 1)})

	// Not preparing/partially_ready — must be excluded entirely.
	seedOrderWithItems(t, db, s4.ID, 4, "2026-07-14", models.OrderSubmitted, now.Add(-40*time.Minute),
		[]models.OrderItem{orderItemFor(menu.Chai, 1)})
	seedOrderWithItems(t, db, s5.ID, 5, "2026-07-14", models.OrderReady, now.Add(-50*time.Minute),
		[]models.OrderItem{orderItemFor(menu.Samosa, 1)})

	repo := repository.NewOrderRepo(db)
	got, err := repo.FindPreparingOldestForUpdate(ctx)
	if err != nil {
		t.Fatalf("FindPreparingOldestForUpdate: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 preparing/partially_ready orders, got %d", len(got))
	}
	wantOrder := []uint{oldest.ID, middle.ID, newest.ID}
	for i, o := range got {
		if o.ID != wantOrder[i] {
			t.Errorf("position %d: expected order id %d, got %d", i, wantOrder[i], o.ID)
		}
	}
	if len(got[0].Items) != 2 {
		t.Fatalf("expected the oldest order to have 2 eager-loaded items, got %d", len(got[0].Items))
	}
	if got[0].Items[0].Name != menu.Samosa.Name || got[0].Items[1].Name != menu.MasalaDosa.Name {
		t.Errorf("expected the oldest order's items oldest-first (Samosa, Masala Dosa), got (%s, %s)", got[0].Items[0].Name, got[0].Items[1].Name)
	}
}

// TestIntegration_PoolAdd_NegativeDeltaOnMissingRow_HitsQtyCheckConstraint
// exercises PoolRepo.Add's documented UPDATE-then-INSERT fallback: when no
// row exists yet, the UPDATE affects zero rows and the fallback plain INSERT
// runs — which, for a negative qty, must be rejected by item_pool's
// chk_item_pool_qty CHECK (qty >= 0) constraint (see migrations/
// 000001_init_schema.up.sql). This is the scenario the doc comment on Add
// exists to explain: ON CONFLICT would have hit the same CHECK failure, so
// UPDATE-then-INSERT isn't buying anything for this path — the point of the
// two-step approach is only that it also handles the row-exists case
// correctly (verified by the positive-then-negative case below).
func TestIntegration_PoolAdd_NegativeDeltaOnMissingRow_HitsQtyCheckConstraint(t *testing.T) {
	db := openIntegrationDB(t)
	menu := seedLunchMenu(t, db)
	ctx := context.Background()
	repo := repository.NewPoolRepo(db)

	err := repo.Add(ctx, menu.Samosa.ID, -3)
	if err == nil {
		t.Fatal("expected a negative delta against a missing item_pool row to fail the qty >= 0 check, got nil")
	}
	code, constraint := pgErrorCode(err)
	if code != "23514" || constraint != "chk_item_pool_qty" {
		t.Errorf("expected check_violation 23514 on chk_item_pool_qty, got code=%q constraint=%q err=%v", code, constraint, err)
	}

	var count int64
	if err := db.Model(&models.ItemPool{}).Where("menu_item_id = ?", menu.Samosa.ID).Count(&count).Error; err != nil {
		t.Fatalf("count item_pool rows: %v", err)
	}
	if count != 0 {
		t.Errorf("expected no item_pool row to survive the rejected insert, found %d", count)
	}
}

// TestIntegration_PoolAdd_UpdatesExistingRowAndRejectsGoingNegative proves the
// UPDATE branch of Add (row already exists) both applies a positive delta and
// is itself protected by the same CHECK constraint when a delta would drive
// qty below zero.
func TestIntegration_PoolAdd_UpdatesExistingRowAndRejectsGoingNegative(t *testing.T) {
	db := openIntegrationDB(t)
	menu := seedLunchMenu(t, db)
	ctx := context.Background()
	repo := repository.NewPoolRepo(db)

	if _, err := repo.Lock(ctx, menu.Samosa.ID); err != nil {
		t.Fatalf("Lock (ensures the row exists): %v", err)
	}
	if err := repo.Add(ctx, menu.Samosa.ID, 10); err != nil {
		t.Fatalf("Add(+10): %v", err)
	}
	all, err := repo.FindAll(ctx)
	if err != nil {
		t.Fatalf("FindAll: %v", err)
	}
	if all[menu.Samosa.ID] != 10 {
		t.Errorf("expected pool qty 10 after Add(+10), got %d", all[menu.Samosa.ID])
	}

	if err := repo.Add(ctx, menu.Samosa.ID, -15); err == nil {
		t.Fatal("expected Add(-15) against a pool of 10 to violate qty >= 0, got nil")
	} else if code, constraint := pgErrorCode(err); code != "23514" || constraint != "chk_item_pool_qty" {
		t.Errorf("expected check_violation 23514 on chk_item_pool_qty, got code=%q constraint=%q err=%v", code, constraint, err)
	}

	all, err = repo.FindAll(ctx)
	if err != nil {
		t.Fatalf("FindAll after rejected Add: %v", err)
	}
	if all[menu.Samosa.ID] != 10 {
		t.Errorf("expected pool qty to remain 10 after the rejected negative Add, got %d", all[menu.Samosa.ID])
	}
}

// TestIntegration_GetMaxOrderNo_PerBusinessDayAndRetryLoop proves
// GetMaxOrderNo is scoped per order_date (not global), defaults to 0 for an
// untouched date, and — because it's a plain read with no locking of its
// own — two concurrent callers computing GetMaxOrderNo()+1 for the same date
// can legitimately compute the same "next" order_no; idx_orders_date_no is
// what makes the create-order retry loop this method feeds actually safe.
func TestIntegration_GetMaxOrderNo_PerBusinessDayAndRetryLoop(t *testing.T) {
	db := openIntegrationDB(t)
	s1, s2 := seedUser(t, db, "maxno-1@sst.scaler.com"), seedUser(t, db, "maxno-2@sst.scaler.com")
	ctx := context.Background()
	repo := repository.NewOrderRepo(db)

	// Untouched date: 0.
	maxNo, err := repo.GetMaxOrderNo(ctx, "2026-07-20")
	if err != nil {
		t.Fatalf("GetMaxOrderNo (empty date): %v", err)
	}
	if maxNo != 0 {
		t.Errorf("expected 0 for a date with no orders, got %d", maxNo)
	}

	seedOrderWithItems(t, db, s1.ID, 1, "2026-07-14", models.OrderCompleted, time.Now(), nil)
	seedOrderWithItems(t, db, s2.ID, 5, "2026-07-14", models.OrderCompleted, time.Now(), nil)
	seedOrderWithItems(t, db, s1.ID, 3, "2026-07-14", models.OrderCompleted, time.Now(), nil)
	// A higher order_no on a *different* date must not leak into 2026-07-14's max.
	seedOrderWithItems(t, db, s2.ID, 99, "2026-07-15", models.OrderCompleted, time.Now(), nil)

	maxNo, err = repo.GetMaxOrderNo(ctx, "2026-07-14")
	if err != nil {
		t.Fatalf("GetMaxOrderNo (2026-07-14): %v", err)
	}
	if maxNo != 5 {
		t.Errorf("expected max order_no 5 for 2026-07-14, got %d", maxNo)
	}
	maxNo, err = repo.GetMaxOrderNo(ctx, "2026-07-15")
	if err != nil {
		t.Fatalf("GetMaxOrderNo (2026-07-15): %v", err)
	}
	if maxNo != 99 {
		t.Errorf("expected max order_no 99 for 2026-07-15, got %d", maxNo)
	}

	// The retry loop this backstops: two callers race to insert order_no =
	// max+1 for the same date. Exactly one succeeds; the loser gets the
	// idx_orders_date_no unique violation and (in the real service) would
	// re-read GetMaxOrderNo and retry.
	const raceDate = "2026-07-16"
	base, err := repo.GetMaxOrderNo(ctx, raceDate)
	if err != nil {
		t.Fatalf("GetMaxOrderNo (race date): %v", err)
	}
	if base != 0 {
		t.Fatalf("expected race date to start empty, got max %d", base)
	}

	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make([]error, 2)
	for i, uid := range []uint{s1.ID, s2.ID} {
		wg.Add(1)
		go func(i int, uid uint) {
			defer wg.Done()
			<-start
			o := models.Order{UserID: uid, OrderNo: base + 1, OrderDate: raceDate, Status: models.OrderCompleted}
			errs[i] = db.Create(&o).Error
		}(i, uid)
	}
	close(start)
	wg.Wait()

	successes, violations := 0, 0
	for _, err := range errs {
		if err == nil {
			successes++
			continue
		}
		if code, constraint := pgErrorCode(err); code == "23505" && constraint == "idx_orders_date_no" {
			violations++
		} else {
			t.Errorf("unexpected error racing for order_no %d on %s: %v", base+1, raceDate, err)
		}
	}
	if successes != 1 || violations != 1 {
		t.Errorf("expected exactly 1 success and 1 idx_orders_date_no violation, got %d successes, %d violations", successes, violations)
	}
}

// TestIntegration_HasActiveItemsForMenuItem_AcrossEveryOrderStatus checks
// every order status models.go declares against HasActiveItemsForMenuItem:
// true only while the order is in one of the active statuses AND the item
// itself isn't rejected.
func TestIntegration_HasActiveItemsForMenuItem_AcrossEveryOrderStatus(t *testing.T) {
	db := openIntegrationDB(t)
	menu := seedLunchMenu(t, db)
	ctx := context.Background()
	repo := repository.NewOrderRepo(db)

	statuses := []struct {
		status models.OrderStatus
		active bool
	}{
		{models.OrderSubmitted, true},
		{models.OrderPreparing, true},
		{models.OrderPartiallyReady, true},
		{models.OrderReady, true},
		{models.OrderAwaitingPayment, true},
		{models.OrderCompleted, false},
		{models.OrderRejected, false},
		{models.OrderExpired, false},
		{models.OrderCancelled, false},
	}

	for i, tc := range statuses {
		student := seedUser(t, db, string(tc.status)+"-user@sst.scaler.com")
		seedOrderWithItems(t, db, student.ID, i+1, "2026-07-14", tc.status, time.Now(),
			[]models.OrderItem{orderItemFor(menu.Samosa, 1)})

		got, err := repo.HasActiveItemsForMenuItem(ctx, menu.Samosa.ID)
		if err != nil {
			t.Fatalf("HasActiveItemsForMenuItem after seeding a %s order: %v", tc.status, err)
		}
		if got != tc.active {
			t.Errorf("order status %s: expected HasActiveItemsForMenuItem=%v, got %v", tc.status, tc.active, got)
		}

		// Clean up so each status is tested in isolation (order_items has no
		// direct FK back needed here — orders cascade-delete their items).
		if err := db.Exec("DELETE FROM orders WHERE user_id = ?", student.ID).Error; err != nil {
			t.Fatalf("cleanup order for status %s: %v", tc.status, err)
		}
	}

	// An active order whose only item for this menu item is itself rejected
	// (e.g. the shopkeeper 86'd it) must not count as "active" even though
	// the order as a whole is still open.
	student := seedUser(t, db, "rejected-item-user@sst.scaler.com")
	rejectedItem := orderItemFor(menu.Samosa, 1)
	rejectedItem.Status = models.ItemRejected
	seedOrderWithItems(t, db, student.ID, 1, "2026-07-14", models.OrderPreparing, time.Now(), []models.OrderItem{rejectedItem})

	got, err := repo.HasActiveItemsForMenuItem(ctx, menu.Samosa.ID)
	if err != nil {
		t.Fatalf("HasActiveItemsForMenuItem with only a rejected item: %v", err)
	}
	if got {
		t.Error("expected HasActiveItemsForMenuItem=false when the only item on an active order is itself rejected")
	}
}

// TestIntegration_SumOrderedQtyByDate_ExcludesRejectedOrders proves
// SumOrderedQtyByDate sums order_items.qty per menu item for a date across
// every order status except rejected, and never leaks across dates.
func TestIntegration_SumOrderedQtyByDate_ExcludesRejectedOrders(t *testing.T) {
	db := openIntegrationDB(t)
	s1, s2, s3 := seedUser(t, db, "sum-1@sst.scaler.com"), seedUser(t, db, "sum-2@sst.scaler.com"), seedUser(t, db, "sum-3@sst.scaler.com")
	menu := seedLunchMenu(t, db)
	ctx := context.Background()
	repo := repository.NewOrderRepo(db)

	// Three non-rejected orders on the same date, various statuses, some
	// sharing a menu item.
	seedOrderWithItems(t, db, s1.ID, 1, "2026-07-14", models.OrderCompleted, time.Now(),
		[]models.OrderItem{orderItemFor(menu.Samosa, 2), orderItemFor(menu.Chai, 1)})
	seedOrderWithItems(t, db, s2.ID, 2, "2026-07-14", models.OrderPreparing, time.Now(),
		[]models.OrderItem{orderItemFor(menu.Samosa, 3)})
	seedOrderWithItems(t, db, s3.ID, 3, "2026-07-14", models.OrderCancelled, time.Now(),
		[]models.OrderItem{orderItemFor(menu.Chai, 4)})
	// A rejected order: must be excluded even though it has plenty of qty
	// (order_items.qty is capped at 20 by chk_order_items_qty, so "plenty"
	// here means the per-item max rather than an arbitrarily large number).
	seedOrderWithItems(t, db, s1.ID, 4, "2026-07-14", models.OrderRejected, time.Now(),
		[]models.OrderItem{orderItemFor(menu.Samosa, 20), orderItemFor(menu.ColdCoffee, 20)})
	// A different date entirely: must not leak into 2026-07-14's totals.
	seedOrderWithItems(t, db, s2.ID, 5, "2026-07-15", models.OrderCompleted, time.Now(),
		[]models.OrderItem{orderItemFor(menu.Samosa, 20)})

	sums, err := repo.SumOrderedQtyByDate(ctx, "2026-07-14")
	if err != nil {
		t.Fatalf("SumOrderedQtyByDate: %v", err)
	}
	if got := sums[menu.Samosa.ID]; got != 5 {
		t.Errorf("expected Samosa qty 5 (2 completed + 3 preparing, rejected's 50 excluded), got %d", got)
	}
	if got := sums[menu.Chai.ID]; got != 5 {
		t.Errorf("expected Chai qty 5 (1 completed + 4 cancelled), got %d", got)
	}
	if got, ok := sums[menu.ColdCoffee.ID]; ok {
		t.Errorf("expected Cold Coffee to be absent (its only qty was on the rejected order), got %d", got)
	}
}

// TestIntegration_SoftDeletedMenuItem_DisappearsFromFindAllButOrderSnapshotSurvives
// proves menu_items.DeletedAt soft-delete (via MenuRepo.Delete) removes the
// item from FindAll while an order placed before the delete keeps rendering
// its own snapshot of the item's name/price — order_items.name/price_each are
// copied at order-creation time specifically so this holds, per the model's
// doc comment on OrderItem.PhotoURL.
func TestIntegration_SoftDeletedMenuItem_DisappearsFromFindAllButOrderSnapshotSurvives(t *testing.T) {
	db := openIntegrationDB(t)
	menu := seedLunchMenu(t, db)
	student := seedUser(t, db, "softdelete-student@sst.scaler.com")
	ctx := context.Background()
	menuRepo := repository.NewMenuRepo(db)
	orderRepo := repository.NewOrderRepo(db)

	order := seedOrderWithItems(t, db, student.ID, 1, "2026-07-14", models.OrderCompleted, time.Now(),
		[]models.OrderItem{orderItemFor(menu.Samosa, 2)})

	if err := menuRepo.Delete(ctx, menu.Samosa.ID); err != nil {
		t.Fatalf("Delete (soft delete) Samosa: %v", err)
	}

	all, err := menuRepo.FindAll(ctx, false)
	if err != nil {
		t.Fatalf("FindAll after soft delete: %v", err)
	}
	for _, item := range all {
		if item.ID == menu.Samosa.ID {
			t.Fatalf("expected soft-deleted Samosa to be absent from FindAll, but it was present: %+v", item)
		}
	}
	if len(all) != 3 {
		t.Errorf("expected 3 remaining menu items after deleting 1 of 4, got %d", len(all))
	}

	// FindByID also respects the soft delete (GORM's default scope excludes
	// DeletedAt-non-null rows).
	gone, err := menuRepo.FindByID(ctx, menu.Samosa.ID)
	if err != nil {
		t.Fatalf("FindByID for a soft-deleted item: %v", err)
	}
	if gone != nil {
		t.Errorf("expected FindByID to return nil for a soft-deleted item, got %+v", gone)
	}

	// The order placed before the delete still shows the original snapshot.
	got, err := orderRepo.FindByID(ctx, order.ID)
	if err != nil {
		t.Fatalf("FindByID for the order: %v", err)
	}
	if len(got.Items) != 1 {
		t.Fatalf("expected 1 item on the order, got %d", len(got.Items))
	}
	if got.Items[0].Name != "Samosa" {
		t.Errorf("expected the order item's snapshotted name to still be %q, got %q", "Samosa", got.Items[0].Name)
	}
	if got.Items[0].PriceEach != 1500 {
		t.Errorf("expected the order item's snapshotted price to still be 1500, got %d", got.Items[0].PriceEach)
	}
}

// sqlCapturingLogger is a minimal gorm/logger.Interface implementation that
// records every SQL statement GORM executes, for
// TestIntegration_OrderSave_DoesNotEmitOrderItemAssociationStatements (V8).
type sqlCapturingLogger struct {
	stmts []string
}

func (l *sqlCapturingLogger) LogMode(gormlogger.LogLevel) gormlogger.Interface { return l }
func (l *sqlCapturingLogger) Info(context.Context, string, ...interface{})     {}
func (l *sqlCapturingLogger) Warn(context.Context, string, ...interface{})     {}
func (l *sqlCapturingLogger) Error(context.Context, string, ...interface{})    {}
func (l *sqlCapturingLogger) Trace(_ context.Context, _ time.Time, fc func() (string, int64), err error) {
	sql, _ := fc()
	l.stmts = append(l.stmts, sql)
}

// TestIntegration_OrderSave_DoesNotEmitOrderItemAssociationStatements is the
// V8 investigation, and it confirmed a real defect. GormOrderRepo.Save calls
// getDB(ctx, r.db).Save(order) with an order whose Items slice is populated
// (every real caller loads via FindByIDForUpdate, which does populate it):
// against the ORIGINAL code, saving an order with a populated Items slice
// emitted an extra `INSERT INTO order_items (...) VALUES (...) ON CONFLICT
// (id) DO UPDATE SET order_id = excluded.order_id` statement per item, on
// every single order-status write — inside the advisory-locked critical
// section, on the hottest path in the app. The ON CONFLICT clause only
// re-assigns order_id (not a full column overwrite), so a stale in-memory
// item value like the one this test deliberately sets does NOT silently
// corrupt the row — but the extra per-item statement is real, unwanted work
// GORM was doing on every Save regardless. Fixed in GormOrderRepo.Save via
// Omit(clause.Associations), which this test now asserts: zero statements
// touching order_items from a Save(order) call.
func TestIntegration_OrderSave_DoesNotEmitOrderItemAssociationStatements(t *testing.T) {
	db := openIntegrationDB(t)
	student := seedUser(t, db, "save-assoc-student@sst.scaler.com")
	menu := seedLunchMenu(t, db)
	ctx := context.Background()

	seeded := seedOrderWithItems(t, db, student.ID, 1, "2026-07-14", models.OrderPreparing, time.Now(),
		[]models.OrderItem{orderItemFor(menu.Samosa, 2)})

	capture := &sqlCapturingLogger{}
	sessionDB := db.Session(&gorm.Session{Logger: capture})
	orderRepo := repository.NewOrderRepo(sessionDB)

	loaded, err := orderRepo.FindByIDForUpdate(ctx, seeded.ID)
	if err != nil {
		t.Fatalf("FindByIDForUpdate: %v", err)
	}
	if len(loaded.Items) != 1 {
		t.Fatalf("expected 1 item loaded, got %d", len(loaded.Items))
	}

	// Deliberately stale: mutate the in-memory item's Name without saving it
	// via SaveItem. If Save(order) cascaded to the Items association, this
	// stale name would land in order_items; if it doesn't cascade, the row
	// keeps its original "Samosa".
	loaded.Items[0].Name = "STALE-SHOULD-NOT-PERSIST"
	loaded.Status = models.OrderPartiallyReady // a real, intended top-level change

	capture.stmts = nil // only care about statements from this Save call
	if err := orderRepo.Save(ctx, loaded); err != nil {
		t.Fatalf("Save: %v", err)
	}

	orderItemStmtCount := 0
	for _, s := range capture.stmts {
		if strings.Contains(s, "order_items") {
			orderItemStmtCount++
		}
	}
	if orderItemStmtCount != 0 {
		t.Errorf("Save(order) emitted %d statement(s) touching order_items — GORM IS cascading to the Items association (this WOULD be the V8 defect): %v", orderItemStmtCount, capture.stmts)
	}

	// Cross-check via the actual row: the stale name must not have persisted.
	var dbName string
	if err := db.Raw("SELECT name FROM order_items WHERE id = ?", loaded.Items[0].ID).Scan(&dbName).Error; err != nil {
		t.Fatalf("checking order_items row: %v", err)
	}
	if dbName != "Samosa" {
		t.Errorf("order_items.name = %q, want unchanged %q — Save(order) persisted a stale in-memory item value", dbName, "Samosa")
	}

	// The real top-level change must still have gone through.
	var dbStatus string
	if err := db.Raw("SELECT status FROM orders WHERE id = ?", loaded.ID).Scan(&dbStatus).Error; err != nil {
		t.Fatalf("checking orders row: %v", err)
	}
	if dbStatus != string(models.OrderPartiallyReady) {
		t.Errorf("orders.status = %q, want %q", dbStatus, models.OrderPartiallyReady)
	}
}
