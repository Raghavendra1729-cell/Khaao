// Package services: pool.go is the pool engine described in SPEC.md. It is
// the single choke point for every mutation touching orders, order items or
// the done pool, all guarded by one sync.Mutex — correctness over
// throughput, since this is a monolith serving one canteen.
package services

import (
	"errors"
	"log"
	"sort"
	"sync"
	"time"

	"gorm.io/gorm"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/realtime"
)

// Engine implements the pool engine rules from SPEC.md.
type Engine struct {
	db  *gorm.DB
	hub *realtime.Hub
	cfg *config.Config
	mu  sync.Mutex
}

// NewEngine builds the pool engine.
func NewEngine(db *gorm.DB, hub *realtime.Hub, cfg *config.Config) *Engine {
	return &Engine{db: db, hub: hub, cfg: cfg}
}

func activeStatuses() []models.OrderStatus {
	return []models.OrderStatus{
		models.OrderSubmitted, models.OrderPreparing,
		models.OrderPartiallyReady, models.OrderReady,
	}
}

func prepStatuses() []models.OrderStatus {
	return []models.OrderStatus{models.OrderPreparing, models.OrderPartiallyReady}
}

// itemOrderableNow mirrors the MenuItem.orderable computed field.
func itemOrderableNow(mi models.MenuItem) bool {
	return mi.IsAvailable && !mi.OutOfStock && withinWindow(mi.AvailFrom, mi.AvailTo, time.Now())
}

// ---- Accept / Reject --------------------------------------------------

// Accept accepts an order's pending items, trimming rejectedItemIDs. If all
// items end up rejected the whole order is rejected; otherwise it moves to
// preparing and allocation is immediately (re-)run for the newly queued
// items, since the done pool may already hold matching units.
func (e *Engine) Accept(orderID uint, rejectedItemIDs []uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	var order models.Order
	if err := e.db.First(&order, orderID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OrderResponse{}, ErrNotFound("order not found")
		}
		return OrderResponse{}, err
	}

	var pendingItems []models.OrderItem
	if err := e.db.Where("order_id = ? AND status = ?", orderID, models.ItemPending).
		Find(&pendingItems).Error; err != nil {
		return OrderResponse{}, err
	}
	if len(pendingItems) == 0 {
		return OrderResponse{}, ErrConflict("order has no pending items to accept")
	}

	rejectedSet := make(map[uint]struct{}, len(rejectedItemIDs))
	for _, id := range rejectedItemIDs {
		rejectedSet[id] = struct{}{}
	}

	newlyQueuedMenuItems := map[uint]struct{}{}
	for i := range pendingItems {
		it := &pendingItems[i]
		if _, rejected := rejectedSet[it.ID]; rejected {
			it.Status = models.ItemRejected
		} else {
			it.Status = models.ItemQueued
			newlyQueuedMenuItems[it.MenuItemID] = struct{}{}
		}
		if err := e.db.Save(it).Error; err != nil {
			return OrderResponse{}, err
		}
	}

	var allItems []models.OrderItem
	if err := e.db.Where("order_id = ?", orderID).Find(&allItems).Error; err != nil {
		return OrderResponse{}, err
	}
	allRejected := true
	for _, it := range allItems {
		if it.Status != models.ItemRejected {
			allRejected = false
			break
		}
	}

	if allRejected {
		order.Status = models.OrderRejected
		if err := e.db.Save(&order).Error; err != nil {
			return OrderResponse{}, err
		}
	} else {
		order.Status = models.OrderPreparing
		if err := e.db.Save(&order).Error; err != nil {
			return OrderResponse{}, err
		}
		if err := e.recomputeTotalPrice(orderID); err != nil {
			return OrderResponse{}, err
		}
		for menuItemID := range newlyQueuedMenuItems {
			if err := e.allocateLocked(menuItemID); err != nil {
				return OrderResponse{}, err
			}
		}
		// The order may already be complete without any new allocation —
		// e.g. every pending item was trimmed while the rest of the order
		// was fully allocated — so re-derive its status unconditionally.
		if err := e.recomputeOrderStatus(orderID); err != nil {
			return OrderResponse{}, err
		}
	}

	e.broadcastOrder(orderID)
	e.hub.NotifyShopOrdersUpdate()
	e.hub.NotifyShopPrepUpdate()
	return e.orderResponseFor(orderID, true)
}

// Reject rejects an order outright: every non-terminal item -> rejected. A
// re-opened order may already hold allocated units; those go back to the
// done pool (and may complete other waiting orders), mirroring expiry.
func (e *Engine) Reject(orderID uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	var order models.Order
	if err := e.db.First(&order, orderID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OrderResponse{}, ErrNotFound("order not found")
		}
		return OrderResponse{}, err
	}

	var items []models.OrderItem
	if err := e.db.Where("order_id = ?", orderID).Find(&items).Error; err != nil {
		return OrderResponse{}, err
	}

	touchedMenuItems := map[uint]struct{}{}
	for i := range items {
		it := &items[i]
		if it.AllocatedQty > 0 {
			if err := e.creditPool(it.MenuItemID, it.AllocatedQty); err != nil {
				return OrderResponse{}, err
			}
			touchedMenuItems[it.MenuItemID] = struct{}{}
			it.AllocatedQty = 0
		}
		it.Status = models.ItemRejected
		if err := e.db.Save(it).Error; err != nil {
			return OrderResponse{}, err
		}
	}

	order.Status = models.OrderRejected
	if err := e.db.Save(&order).Error; err != nil {
		return OrderResponse{}, err
	}

	for menuItemID := range touchedMenuItems {
		if err := e.allocateLocked(menuItemID); err != nil {
			return OrderResponse{}, err
		}
	}

	e.broadcastOrder(orderID)
	e.hub.NotifyShopOrdersUpdate()
	e.hub.NotifyShopPrepUpdate()
	return e.orderResponseFor(orderID, true)
}

// ---- Done / allocation --------------------------------------------------

// MarkDone records qty finished units of a menu item into the done pool,
// then immediately runs allocation for that item.
func (e *Engine) MarkDone(menuItemID uint, qty int) error {
	if qty <= 0 {
		qty = 1
	}
	e.mu.Lock()
	defer e.mu.Unlock()

	var mi models.MenuItem
	if err := e.db.First(&mi, menuItemID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound("menu item not found")
		}
		return err
	}

	if err := e.creditPool(menuItemID, qty); err != nil {
		return err
	}
	if err := e.allocateLocked(menuItemID); err != nil {
		return err
	}

	e.hub.NotifyShopPrepUpdate()
	e.hub.NotifyShopOrdersUpdate()
	return nil
}

// creditPool adds qty units of menuItemID to the done pool (upsert).
func (e *Engine) creditPool(menuItemID uint, qty int) error {
	var pool models.DonePool
	err := e.db.Where("menu_item_id = ?", menuItemID).First(&pool).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		pool = models.DonePool{MenuItemID: menuItemID, QtyAvailable: qty}
		return e.db.Create(&pool).Error
	case err != nil:
		return err
	default:
		pool.QtyAvailable += qty
		return e.db.Save(&pool).Error
	}
}

// allocateLocked implements rule 5: FIFO-allocate done-pool units of
// menuItemID to queued order items across preparing/partially_ready orders,
// oldest order first, oldest item within an order first. Must be called
// with e.mu held.
func (e *Engine) allocateLocked(menuItemID uint) error {
	var pool models.DonePool
	err := e.db.Where("menu_item_id = ?", menuItemID).First(&pool).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}

	touchedOrders := map[uint]struct{}{}

	for pool.QtyAvailable > 0 {
		item, ok, err := e.nextQueuedItem(menuItemID)
		if err != nil {
			return err
		}
		if !ok {
			break
		}
		remaining := item.Qty - item.AllocatedQty
		take := remaining
		if take > pool.QtyAvailable {
			take = pool.QtyAvailable
		}
		if take <= 0 {
			break
		}
		item.AllocatedQty += take
		pool.QtyAvailable -= take
		if item.AllocatedQty >= item.Qty {
			item.Status = models.ItemAllocated
		}
		if err := e.db.Save(&item).Error; err != nil {
			return err
		}
		touchedOrders[item.OrderID] = struct{}{}
	}

	if err := e.db.Save(&pool).Error; err != nil {
		return err
	}

	for orderID := range touchedOrders {
		if err := e.recomputeOrderStatus(orderID); err != nil {
			return err
		}
	}
	return nil
}

// nextQueuedItem finds the oldest not-fully-allocated queued item of
// menuItemID, across preparing/partially_ready orders, oldest order first.
func (e *Engine) nextQueuedItem(menuItemID uint) (models.OrderItem, bool, error) {
	var item models.OrderItem
	err := e.db.Model(&models.OrderItem{}).
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Where("order_items.menu_item_id = ? AND order_items.status = ? AND order_items.qty > order_items.allocated_qty",
			menuItemID, models.ItemQueued).
		Where("orders.status IN ?", prepStatuses()).
		Order("orders.created_at ASC, order_items.created_at ASC").
		First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.OrderItem{}, false, nil
	}
	if err != nil {
		return models.OrderItem{}, false, err
	}
	return item, true, nil
}

// recomputeOrderStatus re-derives an order's status from its items per rule
// 5, and broadcasts the result. Only acts on preparing/partially_ready
// orders (others are terminal or awaiting a fresh accept decision).
func (e *Engine) recomputeOrderStatus(orderID uint) error {
	var order models.Order
	if err := e.db.First(&order, orderID).Error; err != nil {
		return err
	}
	if order.Status != models.OrderPreparing && order.Status != models.OrderPartiallyReady {
		return nil
	}

	var items []models.OrderItem
	if err := e.db.Where("order_id = ?", orderID).Find(&items).Error; err != nil {
		return err
	}

	hasPending := false
	hasAllocated := false
	allResolved := true
	for _, it := range items {
		switch it.Status {
		case models.ItemPending:
			hasPending = true
			allResolved = false
		case models.ItemAllocated:
			hasAllocated = true
		case models.ItemRejected:
			// resolved, doesn't block readiness
		default: // queued but not fully allocated
			allResolved = false
			if it.AllocatedQty > 0 {
				hasAllocated = true
			}
		}
	}

	switch {
	case !hasPending && allResolved && hasAllocated:
		order.Status = models.OrderReady
		now := time.Now()
		order.ReadyAt = &now
		expiresAt := now.Add(time.Duration(e.cfg.HoldMinutes) * time.Minute)
		order.ExpiresAt = &expiresAt
	case hasAllocated:
		order.Status = models.OrderPartiallyReady
	default:
		order.Status = models.OrderPreparing
	}

	if err := e.db.Save(&order).Error; err != nil {
		return err
	}

	e.broadcastOrder(order.ID)
	e.hub.NotifyShopOrdersUpdate()
	e.hub.NotifyShopPrepUpdate()
	return nil
}

// ---- Expiry ticker -------------------------------------------------------

// ExpiryTick expires ready orders past their hold window, returns their
// allocated units to the done pool, and re-runs allocation for those menu
// items (rule 7).
func (e *Engine) ExpiryTick() error {
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now()
	var expiredOrders []models.Order
	if err := e.db.Where("status = ? AND expires_at < ?", models.OrderReady, now).
		Find(&expiredOrders).Error; err != nil {
		return err
	}
	if len(expiredOrders) == 0 {
		return nil
	}

	touchedMenuItems := map[uint]struct{}{}

	for _, order := range expiredOrders {
		order.Status = models.OrderExpired
		if err := e.db.Save(&order).Error; err != nil {
			return err
		}

		var items []models.OrderItem
		if err := e.db.Where("order_id = ?", order.ID).Find(&items).Error; err != nil {
			return err
		}
		for i := range items {
			it := &items[i]
			if it.AllocatedQty <= 0 {
				continue
			}
			if err := e.creditPool(it.MenuItemID, it.AllocatedQty); err != nil {
				return err
			}
			touchedMenuItems[it.MenuItemID] = struct{}{}
			it.AllocatedQty = 0
			if it.Status == models.ItemAllocated {
				it.Status = models.ItemQueued
			}
			if err := e.db.Save(it).Error; err != nil {
				return err
			}
		}
		e.broadcastOrder(order.ID)
	}
	e.hub.NotifyShopOrdersUpdate()

	for menuItemID := range touchedMenuItems {
		if err := e.allocateLocked(menuItemID); err != nil {
			return err
		}
	}
	if len(touchedMenuItems) > 0 {
		e.hub.NotifyShopPrepUpdate()
	}
	return nil
}

// ---- Close order / close day --------------------------------------------

// CloseOrder completes the counter handover: the last item is picked up,
// the shopkeeper records payment, and the order closes (ready -> picked,
// paid=true).
func (e *Engine) CloseOrder(orderID uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	var order models.Order
	if err := e.db.First(&order, orderID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OrderResponse{}, ErrNotFound("order not found")
		}
		return OrderResponse{}, err
	}
	if order.Status != models.OrderReady {
		return OrderResponse{}, ErrConflict("order is not ready for handover")
	}

	now := time.Now()
	order.Status = models.OrderPicked
	order.Paid = true
	order.PaidAt = &now
	order.ClosedAt = &now
	if err := e.db.Save(&order).Error; err != nil {
		return OrderResponse{}, err
	}

	if err := e.db.Model(&models.OrderItem{}).
		Where("order_id = ? AND status <> ?", orderID, models.ItemRejected).
		Update("status", models.ItemHandedOver).Error; err != nil {
		return OrderResponse{}, err
	}

	e.broadcastOrder(orderID)
	e.hub.NotifyShopOrdersUpdate()
	return e.orderResponseFor(orderID, true)
}

// CloseDay resets the canteen for a new day (rule 9).
func (e *Engine) CloseDay() error {
	e.mu.Lock()
	defer e.mu.Unlock()

	var openOrders []models.Order
	if err := e.db.Where("status IN ?", activeStatuses()).Find(&openOrders).Error; err != nil {
		return err
	}
	for i := range openOrders {
		o := &openOrders[i]
		o.Status = models.OrderExpired
		if err := e.db.Save(o).Error; err != nil {
			return err
		}
	}

	if err := e.db.Model(&models.DonePool{}).
		Where("qty_available >= ?", 0).
		Update("qty_available", 0).Error; err != nil {
		return err
	}
	if err := e.db.Model(&models.MenuItem{}).
		Where("out_of_stock = ?", true).
		Update("out_of_stock", false).Error; err != nil {
		return err
	}

	for _, o := range openOrders {
		e.broadcastOrder(o.ID)
	}
	e.hub.NotifyShopOrdersUpdate()
	e.hub.NotifyShopPrepUpdate()
	e.hub.NotifyMenuUpdate()
	return nil
}

// ---- Prep list -----------------------------------------------------------

// PrepItemResponse is one row of the aggregate prep list.
type PrepItemResponse struct {
	MenuItemID   uint   `json:"menu_item_id"`
	Name         string `json:"name"`
	RemainingQty int    `json:"remaining_qty"`
	PoolQty      int    `json:"pool_qty"`
}

// PrepList computes the aggregate prep list (rule 1) plus each item's
// unallocated pool count.
func (e *Engine) PrepList() ([]PrepItemResponse, error) {
	type remainingRow struct {
		MenuItemID uint
		Remaining  int
	}
	var remainingRows []remainingRow
	if err := e.db.Model(&models.OrderItem{}).
		Select("order_items.menu_item_id AS menu_item_id, COALESCE(SUM(order_items.qty - order_items.allocated_qty), 0) AS remaining").
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Where("order_items.status = ? AND orders.status IN ?", models.ItemQueued, prepStatuses()).
		Group("order_items.menu_item_id").
		Scan(&remainingRows).Error; err != nil {
		return nil, err
	}
	remainingByItem := make(map[uint]int, len(remainingRows))
	for _, r := range remainingRows {
		remainingByItem[r.MenuItemID] = r.Remaining
	}

	var pools []models.DonePool
	if err := e.db.Where("qty_available > 0").Find(&pools).Error; err != nil {
		return nil, err
	}
	poolByItem := make(map[uint]int, len(pools))
	for _, p := range pools {
		poolByItem[p.MenuItemID] = p.QtyAvailable
	}

	idSet := make(map[uint]struct{}, len(remainingByItem)+len(poolByItem))
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

	var items []models.MenuItem
	if err := e.db.Unscoped().Where("id IN ?", ids).Find(&items).Error; err != nil {
		return nil, err
	}
	nameByID := make(map[uint]string, len(items))
	for _, it := range items {
		nameByID[it.ID] = it.Name
	}

	out := make([]PrepItemResponse, 0, len(ids))
	for _, id := range ids {
		out = append(out, PrepItemResponse{
			MenuItemID:   id,
			Name:         nameByID[id],
			RemainingQty: remainingByItem[id],
			PoolQty:      poolByItem[id],
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].MenuItemID < out[j].MenuItemID })
	return out, nil
}

// ---- shared helpers -------------------------------------------------------

// recomputeTotalPrice sums qty*price_each over an order's non-rejected
// items and persists it.
func (e *Engine) recomputeTotalPrice(orderID uint) error {
	var total int64
	if err := e.db.Model(&models.OrderItem{}).
		Where("order_id = ? AND status <> ?", orderID, models.ItemRejected).
		Select("COALESCE(SUM(qty * price_each), 0)").
		Scan(&total).Error; err != nil {
		return err
	}
	return e.db.Model(&models.Order{}).Where("id = ?", orderID).Update("total_price", int(total)).Error
}

// broadcastOrder loads the full order and pushes it to its owning student.
func (e *Engine) broadcastOrder(orderID uint) {
	resp, userID, err := e.loadOrderResponseWithOwner(orderID)
	if err != nil {
		log.Printf("khaao: broadcastOrder failed to load order %d: %v", orderID, err)
		return
	}
	e.hub.NotifyOrderUpdate(userID, resp)
}
