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
	"errors"
	"os"
	"os/user"
	"sync"
	"testing"

	"khaao/internal/config"
	"khaao/internal/database"
	"khaao/internal/models"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
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
