package services

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/repository"
)

// ShopStatusResponse is the wire shape for both GET /api/shop-status and the
// response of POST /api/shop/status.
type ShopStatusResponse struct {
	State    string     `json:"state"`
	ReopenAt *time.Time `json:"reopen_at"`
}

type ShopStatusService struct {
	repo      repository.ShopStatusRepo
	orderRepo repository.OrderRepo
	uow       repository.UnitOfWork
	hub       *realtime.Hub
	pool      *PoolEngine // wired via SetPool after PoolEngine is constructed
}

func NewShopStatusService(repo repository.ShopStatusRepo, orderRepo repository.OrderRepo, uow repository.UnitOfWork, hub *realtime.Hub) *ShopStatusService {
	return &ShopStatusService{repo: repo, orderRepo: orderRepo, uow: uow, hub: hub}
}

// SetPool wires the PoolEngine reference needed for auto-rejecting submitted
// orders when the shop transitions to paused or closed. Called from main.go
// immediately after both services are constructed.
func (s *ShopStatusService) SetPool(pool *PoolEngine) {
	s.pool = pool
}

func toShopStatusResponse(s *models.ShopStatus) ShopStatusResponse {
	if s == nil {
		// Unseeded singleton defaults to open (seeding happens on boot).
		return ShopStatusResponse{State: string(models.ShopOpen)}
	}
	return ShopStatusResponse{State: s.State, ReopenAt: s.ReopenAt}
}

func (s *ShopStatusService) Get(ctx context.Context) (ShopStatusResponse, error) {
	status, err := s.repo.Get(ctx)
	if err != nil {
		return ShopStatusResponse{}, err
	}
	return toShopStatusResponse(status), nil
}

// Set changes the shop state. Switching to paused/closed is refused (409) while
// any order the shopkeeper has already accepted (preparing / partially_ready /
// ready / awaiting_payment) is still outstanding; merely submitted orders do
// not block the transition because the shopkeeper hasn't committed to them yet.
// When the transition to paused/closed succeeds, any orders still sitting in
// submitted status are auto-rejected so they don't linger stale.
// Setting open (or closed) clears reopen_at; it is retained only for paused.
func (s *ShopStatusService) Set(ctx context.Context, state string, reopenAt *time.Time) (ShopStatusResponse, error) {
	switch models.ShopState(state) {
	case models.ShopOpen, models.ShopPaused, models.ShopClosed:
	default:
		return ShopStatusResponse{}, ErrBadRequest("state must be one of open, paused, closed")
	}

	// reopen_at is meaningful only while paused.
	if state != string(models.ShopPaused) {
		reopenAt = nil
	}

	// The accepted-order check and the save happen inside one transaction —
	// uow.WithTx takes the same Postgres advisory lock every PoolEngine
	// mutation (Accept, Reject, ...) takes, so this serializes against them.
	// Without that, a concurrent Accept between the check and the save could
	// leave the shop paused/closed with an accepted order outstanding, the
	// exact state this check exists to prevent.
	var status *models.ShopStatus
	err := s.uow.WithTx(ctx, func(txCtx context.Context) error {
		if state == string(models.ShopPaused) || state == string(models.ShopClosed) {
			accepted, err := s.orderRepo.CountAccepted(txCtx)
			if err != nil {
				return err
			}
			if accepted > 0 {
				return ErrConflict(fmt.Sprintf("Finish or cancel the %d accepted order(s) first.", accepted))
			}
		}

		var err error
		status, err = s.repo.Get(txCtx)
		if err != nil {
			return err
		}
		if status == nil {
			status = &models.ShopStatus{ID: 1}
		}
		status.State = state
		status.ReopenAt = reopenAt
		return s.repo.Save(txCtx, status)
	})
	if err != nil {
		return ShopStatusResponse{}, err
	}

	// Auto-reject any orders still in submitted status so they don't sit
	// stale after a pause/close. This happens after the status save — as a
	// separate transaction, not nested in the one above (RejectAllSubmitted
	// takes the same advisory lock via its own uow.WithTx; nesting it inside
	// this transaction's callback would try to re-acquire that lock from a
	// second connection while the first is still open, and deadlock) — so
	// the shop is already paused/closed from the DB's perspective when the
	// SSE broadcasts fire. Known residual gap: a concurrent Accept can still
	// land in the narrow window between this transaction's commit and
	// RejectAllSubmitted's own transaction starting, converting a
	// still-submitted order to accepted before the sweep sees it — the
	// order is then correctly left alone (not auto-rejected), but the shop
	// can end up paused/closed with that one order still outstanding. This
	// is a much narrower window than the pre-fix race (two lock-free service
	// calls with an arbitrary gap) but not fully closed; closing it further
	// would mean restructuring RejectAllSubmitted to run inside the caller's
	// existing transaction instead of opening its own.
	if (state == string(models.ShopPaused) || state == string(models.ShopClosed)) && s.pool != nil {
		n, err := s.pool.RejectAllSubmitted(ctx)
		if err != nil {
			// Non-fatal: the status was already saved. Log and continue.
			slog.Error("khaao: shopstatus: auto-reject submitted orders failed", "state", state, "error", err)
		} else if n > 0 {
			slog.Info("khaao: shopstatus: auto-rejected submitted orders", "count", n, "state", state)
		}
	}

	s.hub.NotifyShopStatusUpdate()
	return toShopStatusResponse(status), nil
}
