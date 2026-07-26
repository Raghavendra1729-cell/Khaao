package services

import (
	"context"
	"fmt"
	"khaao/internal/models"
	"khaao/internal/repository"
)

type RatingInput struct {
	OrderItemID uint `json:"order_item_id"`
	Stars       int  `json:"stars"`
}

type RatingsService struct {
	ratingRepo repository.RatingRepo
	orderRepo  repository.OrderRepo
}

func NewRatingsService(ratingRepo repository.RatingRepo, orderRepo repository.OrderRepo) *RatingsService {
	return &RatingsService{ratingRepo: ratingRepo, orderRepo: orderRepo}
}

// maxRatingsPerRequest bounds SubmitRatings' input slice at the most lines an
// order can ever have (CreateOrder itself caps at 30). Without this, only the
// 1 MiB request body cap limited a request — roughly 30k entries — so a
// single call could carry thousands of rows for an order that has at most 30
// (V7).
const maxRatingsPerRequest = 30

func (s *RatingsService) SubmitRatings(ctx context.Context, orderID uint, userID uint, inputs []RatingInput) error {
	if len(inputs) > maxRatingsPerRequest {
		return ErrBadRequest(fmt.Sprintf("cannot submit more than %d ratings at once", maxRatingsPerRequest))
	}

	order, err := s.orderRepo.FindByID(ctx, orderID)
	if err != nil {
		return err
	}
	if order == nil {
		return ErrNotFound("order not found")
	}
	if order.UserID != userID {
		return ErrForbidden("not your order")
	}
	if order.Status != models.OrderCompleted {
		return ErrConflict("can only rate completed orders")
	}

	itemMap := make(map[uint]*models.OrderItem)
	for i := range order.Items {
		itemMap[order.Items[i].ID] = &order.Items[i]
	}

	// De-duplicate by OrderItemID before validating/building rows — a client
	// resubmitting the same line within one request (double-tap, retry)
	// should produce exactly one row, not two attempted inserts for the same
	// order_item_id. Last value wins; dedupIndex tracks each id's position in
	// deduped so a later duplicate overwrites in place instead of appending,
	// which keeps request order otherwise stable (V7).
	deduped := make([]RatingInput, 0, len(inputs))
	dedupIndex := make(map[uint]int, len(inputs))
	for _, in := range inputs {
		if idx, ok := dedupIndex[in.OrderItemID]; ok {
			deduped[idx] = in
			continue
		}
		dedupIndex[in.OrderItemID] = len(deduped)
		deduped = append(deduped, in)
	}

	var ratings []models.ItemRating
	for _, in := range deduped {
		item, ok := itemMap[in.OrderItemID]
		if !ok {
			return ErrBadRequest(fmt.Sprintf("order_item_id %d does not belong to this order", in.OrderItemID))
		}
		if item.Status == models.ItemRejected {
			return ErrBadRequest(fmt.Sprintf("order_item_id %d was never delivered and cannot be rated", in.OrderItemID))
		}
		if in.Stars < 1 || in.Stars > 5 {
			return ErrBadRequest("stars must be between 1 and 5")
		}
		// If an item is already rated, the ON CONFLICT DO NOTHING will silently ignore it.
		ratings = append(ratings, models.ItemRating{
			OrderItemID: in.OrderItemID,
			MenuItemID:  item.MenuItemID,
			UserID:      userID,
			Stars:       in.Stars,
		})
	}

	return s.ratingRepo.SaveAll(ctx, ratings)
}
