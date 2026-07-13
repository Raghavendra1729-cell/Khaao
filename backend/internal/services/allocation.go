package services

import (
	"context"
	"khaao/internal/models"
	"khaao/internal/repository"
)

type AllocationStrategy interface {
	Allocate(ctx context.Context, menuItemID uint, orderRepo repository.OrderRepo, poolRepo repository.PoolRepo) ([]uint, error)
}

type FCFSAllocation struct{}

func (s *FCFSAllocation) Allocate(ctx context.Context, menuItemID uint, orderRepo repository.OrderRepo, poolRepo repository.PoolRepo) ([]uint, error) {
	qty, err := poolRepo.Lock(ctx, menuItemID)
	if err != nil {
		return nil, err
	}
	if qty <= 0 {
		return nil, nil
	}
	initialQty := qty

	orders, err := orderRepo.FindPreparingOldestForUpdate(ctx)
	if err != nil {
		return nil, err
	}

	touchedOrders := make(map[uint]struct{})

	for _, order := range orders {
		if qty <= 0 {
			break
		}
		for i := range order.Items {
			it := &order.Items[i]
			if it.MenuItemID == menuItemID && it.Status == models.ItemQueued && it.Qty > it.AllocatedQty {
				needed := it.Qty - it.AllocatedQty
				take := needed
				if take > qty {
					take = qty
				}
				if take > 0 {
					it.AllocatedQty += take
					qty -= take
					if it.AllocatedQty >= it.Qty {
						it.Status = models.ItemAllocated
					}
					if err := orderRepo.SaveItem(ctx, it); err != nil {
						return nil, err
					}
					touchedOrders[order.ID] = struct{}{}
				}
			}
			if qty <= 0 {
				break
			}
		}
	}

	used := initialQty - qty
	if used > 0 {
		if err := poolRepo.Add(ctx, menuItemID, -used); err != nil {
			return nil, err
		}
	}

	res := make([]uint, 0, len(touchedOrders))
	for id := range touchedOrders {
		res = append(res, id)
	}
	return res, nil
}
