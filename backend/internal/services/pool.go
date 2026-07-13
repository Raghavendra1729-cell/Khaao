package services

import (
	"context"
	"encoding/json"
	"sort"
	"sync"
	"time"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/repository"
)

type PoolEngine struct {
	uow       repository.UnitOfWork
	orderRepo repository.OrderRepo
	menuRepo  repository.MenuRepo
	poolRepo  repository.PoolRepo
	eventRepo repository.EventRepo
	hub       *realtime.Hub
	cfg       *config.Config
	alloc     AllocationStrategy
	mu        sync.Mutex
}

func NewPoolEngine(
	uow repository.UnitOfWork,
	orderRepo repository.OrderRepo,
	menuRepo repository.MenuRepo,
	poolRepo repository.PoolRepo,
	eventRepo repository.EventRepo,
	hub *realtime.Hub,
	cfg *config.Config,
	alloc AllocationStrategy,
) *PoolEngine {
	return &PoolEngine{
		uow:       uow,
		orderRepo: orderRepo,
		menuRepo:  menuRepo,
		poolRepo:  poolRepo,
		eventRepo: eventRepo,
		hub:       hub,
		cfg:       cfg,
		alloc:     alloc,
	}
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

func (e *PoolEngine) logEvent(ctx context.Context, orderID uint, typ models.EventType, payload any) {
	b, _ := json.Marshal(payload)
	_ = e.eventRepo.Log(ctx, &models.OrderEvent{
		OrderID: orderID,
		Type:    typ,
		Payload: b,
	})
}

func (e *PoolEngine) broadcast(orderID uint) {
	ctx := context.Background()
	order, _ := e.orderRepo.FindByID(ctx, orderID)
	if order != nil {
		resp := ToOrderResponse(*order, false)
		e.hub.NotifyOrderUpdate(order.UserID, resp)
	}
}

func (e *PoolEngine) CreateOrder(ctx context.Context, userID uint, inputs []OrderItemInput) (OrderResponse, error) {
	if len(inputs) == 0 {
		return OrderResponse{}, ErrBadRequest("order must contain at least one item")
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	active, err := e.orderRepo.FindActiveByUserID(ctx, userID)
	if err != nil {
		return OrderResponse{}, err
	}
	if active != nil {
		return OrderResponse{}, ErrConflict("you already have an active order")
	}

	today := models.DayOf(time.Now().In(e.cfg.Location()))
	maxNo, err := e.orderRepo.GetMaxOrderNo(ctx, today)
	if err != nil {
		return OrderResponse{}, err
	}

	order := &models.Order{
		UserID:    userID,
		OrderNo:   maxNo + 1,
		OrderDate: today,
		Status:    models.OrderSubmitted,
	}

	var items []models.OrderItem
	total := 0

	for _, in := range inputs {
		if in.Qty < 1 || in.Qty > 20 {
			return OrderResponse{}, ErrBadRequest("qty must be between 1 and 20")
		}
		mi, err := e.menuRepo.FindByID(ctx, in.MenuItemID)
		if err != nil {
			return OrderResponse{}, err
		}
		if mi == nil {
			return OrderResponse{}, ErrUnorderable("menu item not found")
		}
		if !itemOrderableNow(*mi, time.Now().In(e.cfg.Location())) {
			return OrderResponse{}, ErrUnorderable(mi.Name + " is not orderable right now")
		}
		
		items = append(items, models.OrderItem{
			MenuItemID: mi.ID,
			Name:       mi.Name,
			PriceEach:  mi.Price,
			Qty:        in.Qty,
			Status:     models.ItemPending,
		})
		total += mi.Price * in.Qty
	}
	order.TotalPrice = total

	err = e.uow.WithTx(ctx, func(txCtx context.Context) error {
		if err := e.orderRepo.Create(txCtx, order); err != nil {
			return err
		}
		for i := range items {
			items[i].OrderID = order.ID
			if err := e.orderRepo.SaveItem(txCtx, &items[i]); err != nil {
				return err
			}
		}
		e.logEvent(txCtx, order.ID, models.EventPlaced, map[string]any{})
		return nil
	})
	
	if err != nil {
		return OrderResponse{}, err
	}

	e.broadcast(order.ID)
	e.hub.NotifyShopOrdersUpdate()
	
	order, _ = e.orderRepo.FindByID(ctx, order.ID)
	return ToOrderResponse(*order, false), nil
}

func (e *PoolEngine) Accept(ctx context.Context, orderID uint, rejectedItemIDs []uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	order, err := e.orderRepo.FindByID(ctx, orderID)
	if err != nil {
		return OrderResponse{}, err
	}
	if order == nil {
		return OrderResponse{}, ErrNotFound("order not found")
	}
	if order.Status != models.OrderSubmitted {
		return OrderResponse{}, ErrConflict("order is not in submitted state")
	}

	rejectedSet := make(map[uint]struct{})
	for _, id := range rejectedItemIDs {
		rejectedSet[id] = struct{}{}
	}

	allRejected := true
	for i := range order.Items {
		it := &order.Items[i]
		if _, rejected := rejectedSet[it.ID]; rejected {
			it.Status = models.ItemRejected
		} else {
			it.Status = models.ItemQueued
			allRejected = false
		}
	}

	touchedMenuItems := make(map[uint]struct{})

	err = e.uow.WithTx(ctx, func(txCtx context.Context) error {
		if allRejected {
			order.Status = models.OrderRejected
			e.logEvent(txCtx, order.ID, models.EventRejected, map[string]any{"reason": "all items trimmed"})
		} else {
			total := 0
			for _, it := range order.Items {
				if it.Status != models.ItemRejected {
					total += it.Qty * it.PriceEach
					touchedMenuItems[it.MenuItemID] = struct{}{}
				}
			}
			order.TotalPrice = total
			now := time.Now()
			order.AcceptedAt = &now
			e.recomputeStatus(order)
			e.logEvent(txCtx, order.ID, models.EventAccepted, map[string]any{})
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
				_, err := e.alloc.Allocate(txCtx, menuItemID, e.orderRepo, e.poolRepo)
				if err != nil {
					return err
				}
			}
		}
		return nil
	})

	if err != nil {
		return OrderResponse{}, err
	}
	
	if !allRejected {
		_ = e.uow.WithTx(ctx, func(txCtx context.Context) error {
			order, _ = e.orderRepo.FindByID(txCtx, orderID)
			e.recomputeStatus(order)
			return e.orderRepo.Save(txCtx, order)
		})
	}

	e.broadcast(orderID)
	e.hub.NotifyShopOrdersUpdate()
	e.hub.NotifyShopPrepUpdate()
	
	order, _ = e.orderRepo.FindByID(ctx, orderID)
	return ToOrderResponse(*order, true), nil
}

func (e *PoolEngine) Reject(ctx context.Context, orderID uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	order, err := e.orderRepo.FindByID(ctx, orderID)
	if err != nil {
		return OrderResponse{}, err
	}
	if order == nil {
		return OrderResponse{}, ErrNotFound("order not found")
	}
	if order.Status != models.OrderSubmitted {
		return OrderResponse{}, ErrConflict("order is not in submitted state")
	}

	err = e.uow.WithTx(ctx, func(txCtx context.Context) error {
		order.Status = models.OrderRejected
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
		e.logEvent(txCtx, order.ID, models.EventRejected, map[string]any{})
		return nil
	})

	if err != nil {
		return OrderResponse{}, err
	}

	e.broadcast(orderID)
	e.hub.NotifyShopOrdersUpdate()
	e.hub.NotifyShopPrepUpdate()
	
	return ToOrderResponse(*order, true), nil
}

func (e *PoolEngine) Cancel(ctx context.Context, orderID, userID uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	order, err := e.orderRepo.FindByID(ctx, orderID)
	if err != nil {
		return OrderResponse{}, err
	}
	if order == nil {
		return OrderResponse{}, ErrNotFound("order not found")
	}
	if order.UserID != userID {
		return OrderResponse{}, ErrForbidden("not your order")
	}
	if order.Status != models.OrderSubmitted {
		return OrderResponse{}, ErrConflict("order was already accepted and can no longer be cancelled")
	}

	err = e.uow.WithTx(ctx, func(txCtx context.Context) error {
		order.Status = models.OrderCancelled
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
		e.logEvent(txCtx, order.ID, models.EventCancelled, map[string]any{})
		return nil
	})

	if err != nil {
		return OrderResponse{}, err
	}

	e.broadcast(orderID)
	e.hub.NotifyShopOrdersUpdate()
	return ToOrderResponse(*order, false), nil
}

func (e *PoolEngine) Handover(ctx context.Context, orderID, itemID uint, qty int) (OrderResponse, error) {
	if qty <= 0 {
		qty = 1
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	order, err := e.orderRepo.FindByID(ctx, orderID)
	if err != nil {
		return OrderResponse{}, err
	}
	if order == nil {
		return OrderResponse{}, ErrNotFound("order not found")
	}
	if order.Status == models.OrderSubmitted || order.Status == models.OrderRejected || order.Status == models.OrderCancelled || order.Status == models.OrderExpired || order.Status == models.OrderCompleted {
		return OrderResponse{}, ErrConflict("order not in a valid state for handover")
	}

	var targetItem *models.OrderItem
	for i := range order.Items {
		if order.Items[i].ID == itemID {
			targetItem = &order.Items[i]
			break
		}
	}
	if targetItem == nil {
		return OrderResponse{}, ErrNotFound("item not found in order")
	}

	if targetItem.HandedQty+qty > targetItem.AllocatedQty {
		return OrderResponse{}, ErrConflict("cannot hand over more than allocated")
	}

	err = e.uow.WithTx(ctx, func(txCtx context.Context) error {
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

		e.logEvent(txCtx, order.ID, models.EventItemHanded, map[string]any{"item_id": itemID, "qty": qty})
		return nil
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

	order, err := e.orderRepo.FindByID(ctx, orderID)
	if err != nil {
		return OrderResponse{}, err
	}
	if order == nil {
		return OrderResponse{}, ErrNotFound("order not found")
	}
	switch order.Status {
	case models.OrderPreparing, models.OrderPartiallyReady, models.OrderReady:
		// accepted and not yet paid — trimming is allowed
	default:
		return OrderResponse{}, ErrConflict("order can no longer be modified")
	}

	var target *models.OrderItem
	for i := range order.Items {
		if order.Items[i].ID == itemID {
			target = &order.Items[i]
			break
		}
	}
	if target == nil {
		return OrderResponse{}, ErrNotFound("item not found in order")
	}
	if target.Status == models.ItemRejected {
		return OrderResponse{}, ErrConflict("item was already removed")
	}
	if target.HandedQty > 0 {
		return OrderResponse{}, ErrConflict("cannot remove an item the student has started collecting")
	}

	menuItemID := target.MenuItemID
	returned := target.AllocatedQty

	err = e.uow.WithTx(ctx, func(txCtx context.Context) error {
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

		e.logEvent(txCtx, order.ID, models.EventItemTrimmed, map[string]any{
			"item_id":          itemID,
			"menu_item_id":     menuItemID,
			"returned_to_pool": returned,
		})

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
				ord, err := e.orderRepo.FindByID(txCtx, tid)
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

	order, _ = e.orderRepo.FindByID(ctx, orderID)
	return ToOrderResponse(*order, true), nil
}

func (e *PoolEngine) Paid(ctx context.Context, orderID uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	order, err := e.orderRepo.FindByID(ctx, orderID)
	if err != nil {
		return OrderResponse{}, err
	}
	if order == nil {
		return OrderResponse{}, ErrNotFound("order not found")
	}
	if order.Status != models.OrderAwaitingPayment {
		return OrderResponse{}, ErrConflict("hand over every item first before marking paid")
	}

	err = e.uow.WithTx(ctx, func(txCtx context.Context) error {
		order.Status = models.OrderCompleted
		order.Paid = true
		now := time.Now()
		order.PaidAt = &now
		if err := e.orderRepo.Save(txCtx, order); err != nil {
			return err
		}
		e.logEvent(txCtx, order.ID, models.EventPaid, map[string]any{})
		return nil
	})

	if err != nil {
		return OrderResponse{}, err
	}

	e.broadcast(orderID)
	e.hub.NotifyShopOrdersUpdate()
	return ToOrderResponse(*order, true), nil
}

func (e *PoolEngine) MarkDone(ctx context.Context, menuItemID uint, qty int) error {
	if qty < 1 {
		qty = 1
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
		if err := e.poolRepo.Add(txCtx, menuItemID, qty); err != nil {
			return err
		}
		
		touchedOrders, err := e.alloc.Allocate(txCtx, menuItemID, e.orderRepo, e.poolRepo)
		if err != nil {
			return err
		}
		
		for _, orderID := range touchedOrders {
			order, _ := e.orderRepo.FindByID(txCtx, orderID)
			if order != nil {
				e.recomputeStatus(order)
				e.orderRepo.Save(txCtx, order)
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

	orders, err := e.orderRepo.FindReadyExpired(ctx)
	if err != nil {
		return err
	}

	if len(orders) == 0 {
		return nil
	}

	touchedMenuItems := make(map[uint]struct{})
	touchedOrders := make([]uint, 0)

	err = e.uow.WithTx(ctx, func(txCtx context.Context) error {
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
			e.logEvent(txCtx, order.ID, models.EventExpired, map[string]any{})
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
				ord, _ := e.orderRepo.FindByID(txCtx, t)
				if ord != nil {
					e.recomputeStatus(ord)
					e.orderRepo.Save(txCtx, ord)
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

func (e *PoolEngine) CloseDay(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	openOrders, err := e.orderRepo.FindNonTerminal(ctx)
	if err != nil {
		return err
	}

	err = e.uow.WithTx(ctx, func(txCtx context.Context) error {
		for i := range openOrders {
			o := &openOrders[i]
			o.Status = models.OrderExpired
			if err := e.orderRepo.Save(txCtx, o); err != nil {
				return err
			}
			e.logEvent(txCtx, o.ID, models.EventDayClosed, map[string]any{})
		}

		if err := e.poolRepo.ZeroAll(txCtx); err != nil {
			return err
		}
		if err := e.menuRepo.ResetStock(txCtx); err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		return err
	}

	for _, o := range openOrders {
		e.broadcast(o.ID)
	}
	e.hub.NotifyShopOrdersUpdate()
	e.hub.NotifyShopPrepUpdate()
	e.hub.NotifyMenuUpdate()
	return nil
}

type PrepItemResponse struct {
	MenuItemID   uint   `json:"menu_item_id"`
	Name         string `json:"name"`
	RemainingQty int    `json:"remaining_qty"`
	PoolQty      int    `json:"pool_qty"`
}

func (e *PoolEngine) PrepList(ctx context.Context) ([]PrepItemResponse, error) {
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
