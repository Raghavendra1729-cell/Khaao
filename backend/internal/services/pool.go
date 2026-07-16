package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/repository"

	"github.com/jackc/pgx/v5/pgconn"
)

type PoolEngine struct {
	uow            repository.UnitOfWork
	orderRepo      repository.OrderRepo
	menuRepo       repository.MenuRepo
	poolRepo       repository.PoolRepo
	eventRepo      repository.EventRepo
	shopStatusRepo repository.ShopStatusRepo
	hub            *realtime.Hub
	cfg            *config.Config
	alloc          AllocationStrategy
	mu             sync.Mutex
	pushSvc        *PushService
}

func NewPoolEngine(
	uow repository.UnitOfWork,
	orderRepo repository.OrderRepo,
	menuRepo repository.MenuRepo,
	poolRepo repository.PoolRepo,
	eventRepo repository.EventRepo,
	shopStatusRepo repository.ShopStatusRepo,
	hub *realtime.Hub,
	cfg *config.Config,
	alloc AllocationStrategy,
) *PoolEngine {
	return &PoolEngine{
		uow:            uow,
		orderRepo:      orderRepo,
		menuRepo:       menuRepo,
		poolRepo:       poolRepo,
		eventRepo:      eventRepo,
		shopStatusRepo: shopStatusRepo,
		hub:            hub,
		cfg:            cfg,
		alloc:          alloc,
	}
}

func (e *PoolEngine) SetPushService(svc *PushService) {
	e.pushSvc = svc
}

// ensureShopOpen rejects order placement while the canteen is paused or closed.
func (e *PoolEngine) ensureShopOpen(ctx context.Context) error {
	status, err := e.shopStatusRepo.Get(ctx)
	if err != nil {
		return err
	}
	if status == nil {
		return nil // unseeded singleton is treated as open
	}
	switch models.ShopState(status.State) {
	case models.ShopClosed:
		return ErrConflict("The canteen is closed.")
	case models.ShopPaused:
		return ErrConflict("The canteen is on a break.")
	}
	return nil
}

func activeStatuses() []models.OrderStatus {
	return []models.OrderStatus{
		models.OrderSubmitted, models.OrderPreparing,
		models.OrderPartiallyReady, models.OrderReady, models.OrderAwaitingPayment,
	}
}

func itemOrderableNow(mi models.MenuItem, now time.Time) bool {
	return mi.IsAvailable && !mi.OutOfStock && withinWindow(mi.AvailFrom, mi.AvailTo, now)
}

func (e *PoolEngine) recomputeStatus(order *models.Order) {
	if order.Status == models.OrderRejected || order.Status == models.OrderCancelled || order.Status == models.OrderExpired || order.Status == models.OrderCompleted {
		return
	}

	allHanded := true
	allAllocated := true
	anyProgress := false
	hasActiveItems := false

	for _, it := range order.Items {
		if it.Status == models.ItemRejected {
			continue
		}
		hasActiveItems = true
		if it.HandedQty < it.Qty {
			allHanded = false
		}
		if it.AllocatedQty < it.Qty {
			allAllocated = false
		}
		if it.AllocatedQty > 0 || it.HandedQty > 0 {
			anyProgress = true
		}
	}

	if !hasActiveItems {
		return // leave it alone, probably rejected
	}

	oldStatus := order.Status
	switch {
	case allHanded:
		order.Status = models.OrderAwaitingPayment
	case allAllocated:
		order.Status = models.OrderReady
		if oldStatus != models.OrderReady {
			now := time.Now()
			order.ReadyAt = &now
			exp := now.Add(time.Duration(e.cfg.HoldMinutes) * time.Minute)
			order.ExpiresAt = &exp
		}
	case anyProgress:
		order.Status = models.OrderPartiallyReady
	default:
		order.Status = models.OrderPreparing
	}
}

func (e *PoolEngine) logEvent(ctx context.Context, orderID uint, typ models.EventType, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return e.eventRepo.Log(ctx, &models.OrderEvent{
		OrderID: orderID,
		Type:    typ,
		Payload: b,
	})
}

func (e *PoolEngine) broadcast(orderID uint) {
	ctx := context.Background()
	order, err := e.orderRepo.FindByID(ctx, orderID)
	if err != nil {
		slog.Error("khaao: broadcast: load order failed", "order_id", orderID, "error", err)
		return
	}
	if order != nil {
		resp := ToOrderResponse(*order, false)
		e.hub.NotifyOrderUpdate(order.UserID, resp)
	}
}

func (e *PoolEngine) CreateOrder(ctx context.Context, userID uint, inputs []OrderItemInput) (OrderResponse, error) {
	if err := e.ensureShopOpen(ctx); err != nil {
		return OrderResponse{}, err
	}
	if len(inputs) == 0 {
		return OrderResponse{}, ErrBadRequest("order must contain at least one item")
	}
	if len(inputs) > 30 {
		return OrderResponse{}, ErrBadRequest("order cannot contain more than 30 lines")
	}
	seenMenuItems := make(map[uint]struct{}, len(inputs))
	for _, in := range inputs {
		if in.Qty < 1 || in.Qty > 20 {
			return OrderResponse{}, ErrBadRequest("qty must be between 1 and 20")
		}
		if _, exists := seenMenuItems[in.MenuItemID]; exists {
			return OrderResponse{}, ErrBadRequest("each menu item may appear only once")
		}
		seenMenuItems[in.MenuItemID] = struct{}{}
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	var order *models.Order
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		order = nil
		err = e.uow.WithTx(ctx, func(txCtx context.Context) error {
			active, err := e.orderRepo.FindActiveByUserIDForUpdate(txCtx, userID)
			if err != nil {
				return err
			}
			if active != nil {
				return ErrConflict("you already have an active order")
			}

			today := models.DayOf(time.Now().In(e.cfg.Location()))
			maxNo, err := e.orderRepo.GetMaxOrderNo(txCtx, today)
			if err != nil {
				return err
			}
			candidate := &models.Order{UserID: userID, OrderNo: maxNo + 1, OrderDate: today, Status: models.OrderSubmitted}
			items := make([]models.OrderItem, 0, len(inputs))
			for _, in := range inputs {
				mi, err := e.menuRepo.FindByID(txCtx, in.MenuItemID)
				if err != nil {
					return err
				}
				if mi == nil {
					return ErrUnorderable("menu item not found")
				}
				if !itemOrderableNow(*mi, time.Now().In(e.cfg.Location())) {
					return ErrUnorderable(mi.Name + " is not orderable right now")
				}
				items = append(items, models.OrderItem{MenuItemID: mi.ID, Name: mi.Name, PhotoURL: mi.PhotoURL, PriceEach: mi.Price, Qty: in.Qty, Status: models.ItemPending})
				candidate.TotalPrice += mi.Price * in.Qty
			}
			if err := e.orderRepo.Create(txCtx, candidate); err != nil {
				return err
			}
			for i := range items {
				items[i].OrderID = candidate.ID
				if err := e.orderRepo.SaveItem(txCtx, &items[i]); err != nil {
					return err
				}
			}
			if err := e.logEvent(txCtx, candidate.ID, models.EventPlaced, map[string]any{}); err != nil {
				return err
			}
			order = candidate
			return nil
		})
		if err == nil {
			break
		}
		if !isOrderNumberConflict(err) || attempt == 1 {
			if isActiveOrderConflict(err) {
				return OrderResponse{}, ErrConflict("you already have an active order")
			}
			return OrderResponse{}, err
		}
	}

	e.broadcast(order.ID)
	e.hub.NotifyShopOrdersUpdate()
	if e.pushSvc != nil {
		e.pushSvc.NotifyNewOrder(ctx, order)
	}

	stored, err := e.orderRepo.FindByID(ctx, order.ID)
	if err != nil {
		return OrderResponse{}, err
	}
	if stored == nil {
		return OrderResponse{}, ErrInternal("created order could not be reloaded")
	}
	return ToOrderResponse(*stored, false), nil
}

func isOrderNumberConflict(err error) bool { return postgresConstraint(err, "idx_orders_date_no") }
func isActiveOrderConflict(err error) bool {
	return postgresConstraint(err, "uniq_active_order_per_user")
}

func postgresConstraint(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}

func (e *PoolEngine) Accept(ctx context.Context, orderID uint, rejectedItemIDs []uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	rejectedSet := make(map[uint]struct{})
	for _, id := range rejectedItemIDs {
		rejectedSet[id] = struct{}{}
	}

	var order *models.Order
	err := e.uow.WithTx(ctx, func(txCtx context.Context) error {
		var err error
		order, err = e.orderRepo.FindByIDForUpdate(txCtx, orderID)
		if err != nil {
			return err
		}
		if order == nil {
			return ErrNotFound("order not found")
		}
		if order.Status != models.OrderSubmitted {
			return ErrConflict("order is not in submitted state")
		}

		allRejected := true
		touchedMenuItems := make(map[uint]struct{})
		for i := range order.Items {
			it := &order.Items[i]
			if _, rejected := rejectedSet[it.ID]; rejected {
				it.Status = models.ItemRejected
			} else {
				it.Status = models.ItemQueued
				allRejected = false
				touchedMenuItems[it.MenuItemID] = struct{}{}
			}
		}

		if allRejected {
			order.Status = models.OrderRejected
			order.TotalPrice = 0 // nothing accepted; matches RemoveItem's full-trim invariant
			if err := e.logEvent(txCtx, order.ID, models.EventRejected, map[string]any{"reason": "all items trimmed"}); err != nil {
				return err
			}
		} else {
			total := 0
			for _, it := range order.Items {
				if it.Status != models.ItemRejected {
					total += it.Qty * it.PriceEach
				}
			}
			order.TotalPrice = total
			now := time.Now()
			order.AcceptedAt = &now
			e.recomputeStatus(order)
			if err := e.logEvent(txCtx, order.ID, models.EventAccepted, map[string]any{}); err != nil {
				return err
			}
		}

		if err := e.orderRepo.Save(txCtx, order); err != nil {
			return err
		}
		for i := range order.Items {
			if err := e.orderRepo.SaveItem(txCtx, &order.Items[i]); err != nil {
				return err
			}
		}

		if !allRejected {
			for menuItemID := range touchedMenuItems {
				touched, err := e.alloc.Allocate(txCtx, menuItemID, e.orderRepo, e.poolRepo)
				if err != nil {
					return err
				}
				for _, touchedOrderID := range touched {
					touchedOrder, err := e.orderRepo.FindByIDForUpdate(txCtx, touchedOrderID)
					if err != nil {
						return err
					}
					if touchedOrder != nil {
						e.recomputeStatus(touchedOrder)
						if err := e.orderRepo.Save(txCtx, touchedOrder); err != nil {
							return err
						}
					}
				}
			}
		}
		return nil
	})

	if err != nil {
		return OrderResponse{}, err
	}

	e.broadcast(orderID)
	e.hub.NotifyShopOrdersUpdate()
	e.hub.NotifyShopPrepUpdate()

	stored, err := e.orderRepo.FindByID(ctx, orderID)
	if err != nil {
		return OrderResponse{}, err
	}
	if stored == nil {
		return OrderResponse{}, ErrInternal("accepted order could not be reloaded")
	}
	return ToOrderResponse(*stored, true), nil
}

// Reject is legal from submitted through ready — the shopkeeper's escape
// hatch both for a brand-new order and for an already-accepted one where
// something unexpected comes up later (e.g. an ingredient runs out mid-cook).
// It always rejects the whole order; there is no partial reject. Refused if
// pickup has already started on any item (handed_qty > 0).
func (e *PoolEngine) Reject(ctx context.Context, orderID uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	var order *models.Order
	returnedByMenuItem := make(map[uint]int)
	err := e.uow.WithTx(ctx, func(txCtx context.Context) error {
		var err error
		order, err = e.orderRepo.FindByIDForUpdate(txCtx, orderID)
		if err != nil {
			return err
		}
		if order == nil {
			return ErrNotFound("order not found")
		}
		switch order.Status {
		case models.OrderSubmitted, models.OrderPreparing, models.OrderPartiallyReady, models.OrderReady:
			// ok
		default:
			return ErrConflict("order can no longer be rejected")
		}
		for _, it := range order.Items {
			if it.HandedQty > 0 {
				return ErrConflict("cannot reject — pickup has already started on this order")
			}
		}

		for i := range order.Items {
			it := &order.Items[i]
			if it.Status == models.ItemRejected {
				continue
			}
			if it.AllocatedQty > 0 {
				if err := e.poolRepo.Add(txCtx, it.MenuItemID, it.AllocatedQty); err != nil {
					return err
				}
				returnedByMenuItem[it.MenuItemID] += it.AllocatedQty
				it.AllocatedQty = 0
			}
			it.Status = models.ItemRejected
			if err := e.orderRepo.SaveItem(txCtx, it); err != nil {
				return err
			}
		}

		order.Status = models.OrderRejected
		order.TotalPrice = 0 // every item rejected; nothing owed
		if err := e.orderRepo.Save(txCtx, order); err != nil {
			return err
		}
		if err := e.logEvent(txCtx, order.ID, models.EventRejected, map[string]any{}); err != nil {
			return err
		}

		// Re-assign any freed pool units to the next FCFS order(s).
		for menuItemID, returned := range returnedByMenuItem {
			if returned == 0 {
				continue
			}
			touched, err := e.alloc.Allocate(txCtx, menuItemID, e.orderRepo, e.poolRepo)
			if err != nil {
				return err
			}
			for _, tid := range touched {
				if tid == order.ID {
					continue
				}
				ord, err := e.orderRepo.FindByIDForUpdate(txCtx, tid)
				if err != nil {
					return err
				}
				if ord != nil {
					e.recomputeStatus(ord)
					if err := e.orderRepo.Save(txCtx, ord); err != nil {
						return err
					}
				}
			}
		}
		return nil
	})

	if err != nil {
		return OrderResponse{}, err
	}

	e.broadcast(orderID)
	if len(returnedByMenuItem) > 0 {
		orders, _ := e.orderRepo.FindInProgress(ctx)
		for _, o := range orders {
			if o.ID != orderID {
				e.broadcast(o.ID)
			}
		}
	}
	e.hub.NotifyShopOrdersUpdate()
	e.hub.NotifyShopPrepUpdate()

	return ToOrderResponse(*order, true), nil
}

// RejectAllSubmitted auto-declines every still-submitted (not yet accepted)
// order — called when the shop transitions to paused/closed, so a student's
// undecided order doesn't sit forever waiting for a shopkeeper who has
// stepped away. Submitted orders never had pool allocations, so no units need
// returning to the pool here.
func (e *PoolEngine) RejectAllSubmitted(ctx context.Context) (int, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	var rejectedIDs []uint
	err := e.uow.WithTx(ctx, func(txCtx context.Context) error {
		orders, err := e.orderRepo.FindIncoming(txCtx)
		if err != nil {
			return err
		}
		for i := range orders {
			order := &orders[i]
			order.Status = models.OrderRejected
			order.TotalPrice = 0
			if err := e.orderRepo.Save(txCtx, order); err != nil {
				return err
			}
			for j := range order.Items {
				it := &order.Items[j]
				it.Status = models.ItemRejected
				if err := e.orderRepo.SaveItem(txCtx, it); err != nil {
					return err
				}
			}
			if err := e.logEvent(txCtx, order.ID, models.EventRejected, map[string]any{"reason": "shop_closed"}); err != nil {
				return err
			}
			rejectedIDs = append(rejectedIDs, order.ID)
		}
		return nil
	})
	if err != nil {
		return 0, err
	}

	for _, id := range rejectedIDs {
		e.broadcast(id)
	}
	if len(rejectedIDs) > 0 {
		e.hub.NotifyShopOrdersUpdate()
	}
	return len(rejectedIDs), nil
}

func (e *PoolEngine) Cancel(ctx context.Context, orderID, userID uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	var order *models.Order
	err := e.uow.WithTx(ctx, func(txCtx context.Context) error {
		var err error
		order, err = e.orderRepo.FindByIDForUpdate(txCtx, orderID)
		if err != nil {
			return err
		}
		if order == nil {
			return ErrNotFound("order not found")
		}
		if order.UserID != userID {
			return ErrForbidden("not your order")
		}
		if order.Status != models.OrderSubmitted {
			return ErrConflict("order was already accepted and can no longer be cancelled")
		}
		order.Status = models.OrderCancelled
		order.TotalPrice = 0 // every item rejected; nothing owed
		if err := e.orderRepo.Save(txCtx, order); err != nil {
			return err
		}
		for i := range order.Items {
			it := &order.Items[i]
			it.Status = models.ItemRejected
			if err := e.orderRepo.SaveItem(txCtx, it); err != nil {
				return err
			}
		}
		return e.logEvent(txCtx, order.ID, models.EventCancelled, map[string]any{})
	})

	if err != nil {
		return OrderResponse{}, err
	}

	e.broadcast(orderID)
	e.hub.NotifyShopOrdersUpdate()
	return ToOrderResponse(*order, false), nil
}

func (e *PoolEngine) Handover(ctx context.Context, orderID, itemID uint, qty int) (OrderResponse, error) {
	if qty < 1 {
		return OrderResponse{}, ErrBadRequest("qty must be at least 1")
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	var order *models.Order
	err := e.uow.WithTx(ctx, func(txCtx context.Context) error {
		var err error
		order, err = e.orderRepo.FindByIDForUpdate(txCtx, orderID)
		if err != nil {
			return err
		}
		if order == nil {
			return ErrNotFound("order not found")
		}
		if order.Status == models.OrderSubmitted || order.Status == models.OrderRejected || order.Status == models.OrderCancelled || order.Status == models.OrderExpired || order.Status == models.OrderCompleted {
			return ErrConflict("order not in a valid state for handover")
		}
		var targetItem *models.OrderItem
		for i := range order.Items {
			if order.Items[i].ID == itemID {
				targetItem = &order.Items[i]
				break
			}
		}
		if targetItem == nil {
			return ErrNotFound("item not found in order")
		}
		if targetItem.Status == models.ItemRejected {
			return ErrConflict("item was removed from this order")
		}
		if targetItem.HandedQty+qty > targetItem.AllocatedQty {
			return ErrConflict("cannot hand over more than allocated")
		}
		targetItem.HandedQty += qty
		if targetItem.HandedQty >= targetItem.Qty {
			targetItem.Status = models.ItemHandedOver
		}
		if err := e.orderRepo.SaveItem(txCtx, targetItem); err != nil {
			return err
		}

		e.recomputeStatus(order)
		if err := e.orderRepo.Save(txCtx, order); err != nil {
			return err
		}

		return e.logEvent(txCtx, order.ID, models.EventItemHanded, map[string]any{"item_id": itemID, "qty": qty})
	})

	if err != nil {
		return OrderResponse{}, err
	}

	e.broadcast(orderID)
	e.hub.NotifyShopOrdersUpdate()
	return ToOrderResponse(*order, true), nil
}

// RemoveItem lets a shopkeeper drop a line from an already-accepted order.
// Any prepared-but-unhanded units return to the pool and are re-allocated FCFS
// to the next order waiting for that menu item (canttenapp re-pooling rule).
// Removal is refused once the student has taken any unit of the line.
func (e *PoolEngine) RemoveItem(ctx context.Context, orderID, itemID uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	var order *models.Order
	var menuItemID uint
	returned := 0
	err := e.uow.WithTx(ctx, func(txCtx context.Context) error {
		var err error
		order, err = e.orderRepo.FindByIDForUpdate(txCtx, orderID)
		if err != nil {
			return err
		}
		if order == nil {
			return ErrNotFound("order not found")
		}
		switch order.Status {
		case models.OrderPreparing, models.OrderPartiallyReady, models.OrderReady:
		default:
			return ErrConflict("order can no longer be modified")
		}
		var target *models.OrderItem
		for i := range order.Items {
			if order.Items[i].ID == itemID {
				target = &order.Items[i]
				break
			}
		}
		if target == nil {
			return ErrNotFound("item not found in order")
		}
		if target.Status == models.ItemRejected {
			return ErrConflict("item was already removed")
		}
		if target.HandedQty > 0 {
			return ErrConflict("cannot remove an item the student has started collecting")
		}
		menuItemID = target.MenuItemID
		returned = target.AllocatedQty
		if returned > 0 {
			if err := e.poolRepo.Add(txCtx, menuItemID, returned); err != nil {
				return err
			}
		}
		target.AllocatedQty = 0
		target.Status = models.ItemRejected
		if err := e.orderRepo.SaveItem(txCtx, target); err != nil {
			return err
		}

		total := 0
		anyActive := false
		for _, it := range order.Items {
			if it.Status != models.ItemRejected {
				total += it.Qty * it.PriceEach
				anyActive = true
			}
		}
		order.TotalPrice = total
		if !anyActive {
			order.Status = models.OrderRejected // every line trimmed away
		} else {
			e.recomputeStatus(order)
		}
		if err := e.orderRepo.Save(txCtx, order); err != nil {
			return err
		}

		if err := e.logEvent(txCtx, order.ID, models.EventItemTrimmed, map[string]any{
			"item_id":          itemID,
			"menu_item_id":     menuItemID,
			"returned_to_pool": returned,
		}); err != nil {
			return err
		}

		// Re-assign the freed units to the next FCFS order(s).
		if returned > 0 {
			touched, err := e.alloc.Allocate(txCtx, menuItemID, e.orderRepo, e.poolRepo)
			if err != nil {
				return err
			}
			for _, tid := range touched {
				if tid == order.ID {
					continue
				}
				ord, err := e.orderRepo.FindByIDForUpdate(txCtx, tid)
				if err != nil {
					return err
				}
				if ord != nil {
					e.recomputeStatus(ord)
					if err := e.orderRepo.Save(txCtx, ord); err != nil {
						return err
					}
				}
			}
		}
		return nil
	})
	if err != nil {
		return OrderResponse{}, err
	}

	e.broadcast(orderID)
	if returned > 0 {
		// reallocation may have advanced other waiting orders
		orders, _ := e.orderRepo.FindInProgress(ctx)
		for _, o := range orders {
			if o.ID != orderID {
				e.broadcast(o.ID)
			}
		}
	}
	e.hub.NotifyShopOrdersUpdate()
	e.hub.NotifyShopPrepUpdate()

	stored, err := e.orderRepo.FindByID(ctx, orderID)
	if err != nil {
		return OrderResponse{}, err
	}
	if stored == nil {
		return OrderResponse{}, ErrInternal("modified order could not be reloaded")
	}
	return ToOrderResponse(*stored, true), nil
}

func (e *PoolEngine) Paid(ctx context.Context, orderID uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	var order *models.Order
	err := e.uow.WithTx(ctx, func(txCtx context.Context) error {
		var err error
		order, err = e.orderRepo.FindByIDForUpdate(txCtx, orderID)
		if err != nil {
			return err
		}
		if order == nil {
			return ErrNotFound("order not found")
		}
		if order.Status != models.OrderAwaitingPayment {
			return ErrConflict("hand over every item first before marking paid")
		}
		order.Status = models.OrderCompleted
		order.Paid = true
		now := time.Now()
		order.PaidAt = &now
		if err := e.orderRepo.Save(txCtx, order); err != nil {
			return err
		}
		return e.logEvent(txCtx, order.ID, models.EventPaid, map[string]any{})
	})

	if err != nil {
		return OrderResponse{}, err
	}

	e.broadcast(orderID)
	e.hub.NotifyShopOrdersUpdate()
	return ToOrderResponse(*order, true), nil
}

// MarkDone records qty freshly-cooked units of a menu item and immediately
// FCFS-allocates them to whichever accepted orders are still waiting on it.
// qty is capped at that item's current remaining_qty (the same number the
// Prep screen shows as "left to cook") — a shopkeeper cooks to the orders
// actually on hand, not speculatively ahead of any demand. This is enforced
// here, not just in the UI, so a direct API call can't bypass it either.
func (e *PoolEngine) MarkDone(ctx context.Context, menuItemID uint, qty int) error {
	if qty < 1 {
		return ErrBadRequest("qty must be at least 1")
	}
	if qty > 100 {
		return ErrBadRequest("cannot mark more than 100 units done at once")
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	err := e.uow.WithTx(ctx, func(txCtx context.Context) error {
		mi, err := e.menuRepo.FindByID(txCtx, menuItemID)
		if err != nil {
			return err
		}
		if mi == nil {
			return ErrNotFound("menu item not found")
		}

		remainingByItem, err := e.remainingByMenuItem(txCtx)
		if err != nil {
			return err
		}
		remaining := remainingByItem[menuItemID]
		if qty > remaining {
			if remaining == 0 {
				return ErrConflict(mi.Name + " isn't needed right now — no accepted order is waiting on it")
			}
			return ErrConflict(fmt.Sprintf("only %d more %s needed right now", remaining, mi.Name))
		}

		if err := e.poolRepo.Add(txCtx, menuItemID, qty); err != nil {
			return err
		}

		touchedOrders, err := e.alloc.Allocate(txCtx, menuItemID, e.orderRepo, e.poolRepo)
		if err != nil {
			return err
		}

		for _, orderID := range touchedOrders {
			order, err := e.orderRepo.FindByIDForUpdate(txCtx, orderID)
			if err != nil {
				return err
			}
			if order == nil {
				return ErrInternal("allocated order could not be reloaded")
			}
			e.recomputeStatus(order)
			if err := e.orderRepo.Save(txCtx, order); err != nil {
				return err
			}
			if err := e.logEvent(txCtx, order.ID, models.EventItemReady, map[string]any{"menu_item_id": menuItemID}); err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		return err
	}

	e.hub.NotifyShopPrepUpdate()
	e.hub.NotifyShopOrdersUpdate()

	// Broadcast to all touched orders (lazy but safe outside tx)
	orders, _ := e.orderRepo.FindInProgress(ctx)
	for _, o := range orders {
		e.broadcast(o.ID)
	}
	return nil
}

func (e *PoolEngine) ExpiryTick(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	touchedMenuItems := make(map[uint]struct{})
	touchedOrders := make([]uint, 0)

	err := e.uow.WithTx(ctx, func(txCtx context.Context) error {
		orders, err := e.orderRepo.FindReadyExpiredForUpdate(txCtx)
		if err != nil {
			return err
		}
		for i := range orders {
			order := &orders[i]
			handedTotal := 0
			for _, it := range order.Items {
				handedTotal += it.HandedQty
			}
			if handedTotal > 0 {
				continue // Do not expire if anything handed
			}

			order.Status = models.OrderExpired
			if err := e.orderRepo.Save(txCtx, order); err != nil {
				return err
			}
			if err := e.logEvent(txCtx, order.ID, models.EventExpired, map[string]any{}); err != nil {
				return err
			}
			touchedOrders = append(touchedOrders, order.ID)

			for j := range order.Items {
				it := &order.Items[j]
				if it.AllocatedQty > 0 {
					if err := e.poolRepo.Add(txCtx, it.MenuItemID, it.AllocatedQty); err != nil {
						return err
					}
					touchedMenuItems[it.MenuItemID] = struct{}{}
					it.AllocatedQty = 0
					if it.Status == models.ItemAllocated {
						it.Status = models.ItemQueued
					}
					if err := e.orderRepo.SaveItem(txCtx, it); err != nil {
						return err
					}
				}
			}
		}

		for menuItemID := range touchedMenuItems {
			touched, err := e.alloc.Allocate(txCtx, menuItemID, e.orderRepo, e.poolRepo)
			if err != nil {
				return err
			}
			for _, t := range touched {
				touchedOrders = append(touchedOrders, t)
				ord, err := e.orderRepo.FindByIDForUpdate(txCtx, t)
				if err != nil {
					return err
				}
				if ord == nil {
					return ErrInternal("reallocated order could not be reloaded")
				}
				e.recomputeStatus(ord)
				if err := e.orderRepo.Save(txCtx, ord); err != nil {
					return err
				}
			}
		}
		return nil
	})

	if err != nil {
		return err
	}

	for _, id := range touchedOrders {
		e.broadcast(id)
	}
	if len(touchedOrders) > 0 {
		e.hub.NotifyShopOrdersUpdate()
	}
	if len(touchedMenuItems) > 0 {
		e.hub.NotifyShopPrepUpdate()
	}
	return nil
}

type PrepItemResponse struct {
	MenuItemID   uint   `json:"menu_item_id"`
	Name         string `json:"name"`
	RemainingQty int    `json:"remaining_qty"`
	PoolQty      int    `json:"pool_qty"`
}

// remainingByMenuItem sums (qty - allocated_qty) across every queued item in
// every in-progress order, per menu item — the actual unmet demand right
// now. Shared by PrepList (display) and MarkDone (the cap on how much a
// shopkeeper can mark cooked in one go — see MarkDone's doc comment).
func (e *PoolEngine) remainingByMenuItem(ctx context.Context) (map[uint]int, error) {
	orders, err := e.orderRepo.FindInProgress(ctx)
	if err != nil {
		return nil, err
	}
	remainingByItem := make(map[uint]int)
	for _, o := range orders {
		for _, it := range o.Items {
			if it.Status == models.ItemQueued {
				remainingByItem[it.MenuItemID] += (it.Qty - it.AllocatedQty)
			}
		}
	}
	return remainingByItem, nil
}

func (e *PoolEngine) PrepList(ctx context.Context) ([]PrepItemResponse, error) {
	remainingByItem, err := e.remainingByMenuItem(ctx)
	if err != nil {
		return nil, err
	}

	poolByItem, err := e.poolRepo.FindAll(ctx)
	if err != nil {
		return nil, err
	}

	idSet := make(map[uint]struct{})
	for id := range remainingByItem {
		idSet[id] = struct{}{}
	}
	for id := range poolByItem {
		idSet[id] = struct{}{}
	}
	if len(idSet) == 0 {
		return []PrepItemResponse{}, nil
	}

	ids := make([]uint, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}

	menuMap, err := e.menuRepo.FindMapByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}

	out := make([]PrepItemResponse, 0, len(ids))
	for _, id := range ids {
		name := ""
		if mi, ok := menuMap[id]; ok {
			name = mi.Name
		}
		out = append(out, PrepItemResponse{
			MenuItemID:   id,
			Name:         name,
			RemainingQty: remainingByItem[id],
			PoolQty:      poolByItem[id],
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].MenuItemID < out[j].MenuItemID })
	return out, nil
}
