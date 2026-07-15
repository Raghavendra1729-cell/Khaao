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

func (s *RatingsService) SubmitRatings(ctx context.Context, orderID uint, userID uint, inputs []RatingInput) error {
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
	
	var ratings []models.ItemRating
	for _, in := range inputs {
		item, ok := itemMap[in.OrderItemID]
		if !ok {
			return ErrBadRequest(fmt.Sprintf("order_item_id %d does not belong to this order", in.OrderItemID))
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
