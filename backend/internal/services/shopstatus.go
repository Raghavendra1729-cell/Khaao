package services

import (
	"context"
	"fmt"
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
}

func NewShopStatusService(repo repository.ShopStatusRepo, orderRepo repository.OrderRepo, hub *realtime.Hub) *ShopStatusService {
	return &ShopStatusService{repo: repo, orderRepo: orderRepo, hub: hub}
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
// any order is still active; the shopkeeper must finish or cancel them first.
// Setting open (or closed) clears reopen_at; it is retained only for paused.
func (s *ShopStatusService) Set(ctx context.Context, state string, reopenAt *time.Time) (ShopStatusResponse, error) {
	switch models.ShopState(state) {
	case models.ShopOpen, models.ShopPaused, models.ShopClosed:
	default:
		return ShopStatusResponse{}, ErrBadRequest("state must be one of open, paused, closed")
	}

	if state == string(models.ShopPaused) || state == string(models.ShopClosed) {
		active, err := s.orderRepo.CountActive(ctx)
		if err != nil {
			return ShopStatusResponse{}, err
		}
		if active > 0 {
			return ShopStatusResponse{}, ErrConflict(fmt.Sprintf("Finish or cancel the %d active order(s) first.", active))
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

	s.hub.NotifyShopStatusUpdate()
	return toShopStatusResponse(status), nil
}
