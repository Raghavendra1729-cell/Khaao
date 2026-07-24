package services_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/services"
)

// raceMenuRepo is a small, self-contained repository.MenuRepo fake used only
// to prove (and then guard) a lost-update race in MenuService.Update. It
// deliberately does NOT reuse the shared mockMenuRepo from pool_test.go:
// that mock's FindByID always returns a synthetic item disconnected from its
// `items` field (relied on by dozens of PoolEngine tests that never populate
// `items`), so it can't model a faithful read-modify-write race, and
// changing its behavior would risk those other tests.
//
// rowLock models Postgres row-level locking: FindByIDForUpdate acquires it
// and only Save releases it — exactly like a real SELECT ... FOR UPDATE held
// until COMMIT. FindByID (the unlocked read) never touches it, matching a
// plain SELECT — so a concurrent UpdateStock is free to run and commit
// immediately, same as a real unlocked reader/writer pair in Postgres.
type raceMenuRepo struct {
	dataMu sync.Mutex
	items  map[uint]models.MenuItem

	rowLock   sync.Mutex
	rowLocked bool // guarded by dataMu

	// pauseMu/paused implement "block only the first caller". sync.Once is
	// the wrong tool here: Do() blocks *every* concurrent caller until the
	// first one's function returns (documented Once behavior), which would
	// make SetStock's own unrelated FindByID call block right alongside
	// Update's and defeat the point of pausing only Update's read.
	pauseMu sync.Mutex
	paused  bool
	// readStarted closes once the *first* read (whichever of FindByID /
	// FindByIDForUpdate MenuService.Update calls) has captured the item —
	// signals the test it's safe to run the concurrent SetStock now.
	readStarted chan struct{}
	// resume unblocks that same paused read, letting its caller proceed to
	// Save — gives the test a deterministic window between the read and
	// the save to run the concurrent mutation in.
	resume chan struct{}
}

func newRaceMenuRepo(item models.MenuItem) *raceMenuRepo {
	return &raceMenuRepo{
		items:       map[uint]models.MenuItem{item.ID: item},
		readStarted: make(chan struct{}),
		resume:      make(chan struct{}),
	}
}

func (r *raceMenuRepo) get(id uint) models.MenuItem {
	r.dataMu.Lock()
	defer r.dataMu.Unlock()
	return r.items[id]
}

// pauseIfFirst blocks the very first caller (Update's own authoritative
// read) between reading the item and returning it, so the test can run a
// concurrent write in that exact gap. Every later call (e.g. SetStock's own
// unrelated FindByID pre-check) proceeds immediately — unlike sync.Once,
// which would block them too.
func (r *raceMenuRepo) pauseIfFirst() {
	r.pauseMu.Lock()
	first := !r.paused
	r.paused = true
	r.pauseMu.Unlock()
	if !first {
		return
	}
	close(r.readStarted)
	<-r.resume
}

func (r *raceMenuRepo) FindByID(ctx context.Context, id uint) (*models.MenuItem, error) {
	item := r.get(id)
	r.pauseIfFirst()
	return &item, nil
}

func (r *raceMenuRepo) FindByIDForUpdate(ctx context.Context, id uint) (*models.MenuItem, error) {
	r.rowLock.Lock()
	r.dataMu.Lock()
	r.rowLocked = true
	r.dataMu.Unlock()
	item := r.get(id)
	r.pauseIfFirst()
	return &item, nil
}

func (r *raceMenuRepo) Save(ctx context.Context, item *models.MenuItem) error {
	r.dataMu.Lock()
	r.items[item.ID] = *item
	locked := r.rowLocked
	r.rowLocked = false
	r.dataMu.Unlock()
	if locked {
		r.rowLock.Unlock()
	}
	return nil
}

// UpdateStock simulates SetStock's real, targeted single-column UPDATE
// statement: it must wait for the row lock like any concurrent writer would
// against a real Postgres SELECT ... FOR UPDATE, then applies only
// out_of_stock — never a stale read-modify-write, matching the real
// repository's UPDATE menu_items SET out_of_stock = ? WHERE id = ?.
func (r *raceMenuRepo) UpdateStock(ctx context.Context, id uint, outOfStock bool) error {
	r.rowLock.Lock()
	defer r.rowLock.Unlock()
	r.dataMu.Lock()
	defer r.dataMu.Unlock()
	item := r.items[id]
	item.OutOfStock = outOfStock
	r.items[id] = item
	return nil
}

func (r *raceMenuRepo) FindAll(ctx context.Context, onlyAvailable bool) ([]models.MenuItem, error) {
	return nil, nil
}
func (r *raceMenuRepo) FindMapByIDs(ctx context.Context, ids []uint) (map[uint]models.MenuItem, error) {
	return nil, nil
}
func (r *raceMenuRepo) Delete(ctx context.Context, id uint) error { return nil }
func (r *raceMenuRepo) ResetStock(ctx context.Context) error      { return nil }

// TestMenuUpdateDoesNotClobberConcurrentStockChange guards against a
// lost-update race in MenuService.Update: it reads a menu item, mutates only
// the MenuItemInput-owned fields, then persists the whole row. out_of_stock
// is never touched in memory, so persisting it back verbatim silently
// reverts a concurrent SetStock call that lands between Update's read and
// its save. This is exactly the multi-device shopkeeper scenario already
// established as real in this codebase (STATUS.md's 2026-07-22
// ShopStatusControl fix: counter tablet vs. owner's phone) — one device
// edits an item's price/name while another taps "mark out of stock" on the
// same item at nearly the same moment. Without a fix, the shopkeeper sees
// both actions succeed, but the item silently stays orderable on the
// student menu.
func TestMenuUpdateDoesNotClobberConcurrentStockChange(t *testing.T) {
	ctx := context.Background()
	repo := newRaceMenuRepo(models.MenuItem{
		ID: 1, Name: "Chai", Price: 100, Diet: "veg", IsAvailable: true, OutOfStock: false,
	})
	orderRepo := &mockOrderRepo{orders: make(map[uint]*models.Order)}
	ratingRepo := &mockRatingRepo{}
	poolRepo := &mockPoolRepo{pool: make(map[uint]int)}
	hub := realtime.NewHub()
	cfg := &config.Config{}
	svc := services.NewMenuService(repo, orderRepo, ratingRepo, poolRepo, &mockUoW{}, hub, cfg)

	updateDone := make(chan error, 1)
	go func() {
		_, err := svc.Update(ctx, 1, services.MenuItemInput{
			Name: "Chai Latte", Price: 150, Diet: "veg",
		})
		updateDone <- err
	}()

	// Update's authoritative read has captured the item and is now paused
	// right before returning to its caller — mirrors the real gap between
	// the read and Save() committing.
	<-repo.readStarted

	setStockDone := make(chan error, 1)
	go func() {
		_, err := svc.SetStock(ctx, 1, true)
		setStockDone <- err
	}()

	// Give SetStock a moment to reach (and, once the fix is in place, block
	// on) the row lock before letting Update proceed — same margin already
	// trusted by TestMenuListAvailableCacheRace for the same class of race.
	time.Sleep(20 * time.Millisecond)

	close(repo.resume) // let Update proceed to Save
	if err := <-updateDone; err != nil {
		t.Fatalf("Update: %v", err)
	}
	if err := <-setStockDone; err != nil {
		t.Fatalf("SetStock: %v", err)
	}

	final := repo.get(1)
	if !final.OutOfStock {
		t.Fatalf("out_of_stock was reverted to false by a concurrent Update — " +
			"MenuService.Update's whole-row save clobbered SetStock's write")
	}
}
