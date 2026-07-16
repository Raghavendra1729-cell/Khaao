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
	hub       *realtime.Hub
	pool      *PoolEngine // wired via SetPool after PoolEngine is constructed
}

func NewShopStatusService(repo repository.ShopStatusRepo, orderRepo repository.OrderRepo, hub *realtime.Hub) *ShopStatusService {
	return &ShopStatusService{repo: repo, orderRepo: orderRepo, hub: hub}
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

	if state == string(models.ShopPaused) || state == string(models.ShopClosed) {
		accepted, err := s.orderRepo.CountAccepted(ctx)
		if err != nil {
			return ShopStatusResponse{}, err
		}
		if accepted > 0 {
			return ShopStatusResponse{}, ErrConflict(fmt.Sprintf("Finish or cancel the %d accepted order(s) first.", accepted))
		}
	}

	// reopen_at is meaningful only while paused.
	if state != string(models.ShopPaused) {
		reopenAt = nil
	}

	status, err := s.repo.Get(ctx)
	if err != nil {
		return ShopStatusResponse{}, err
	}
	if status == nil {
		status = &models.ShopStatus{ID: 1}
	}
	status.State = state
	status.ReopenAt = reopenAt
	if err := s.repo.Save(ctx, status); err != nil {
		return ShopStatusResponse{}, err
	}

	// Auto-reject any orders still in submitted status so they don't sit
	// stale after a pause/close. This happens after the status save so the
	// shop is already paused/closed from the DB's perspective when the SSE
	// broadcasts fire.
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
