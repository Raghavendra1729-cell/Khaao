package services

import (
	"errors"
	"sort"
	"time"

	"gorm.io/gorm"

	"khaao/internal/models"
)

// OrderItemInput is one line of a create-order / add-item request.
type OrderItemInput struct {
	MenuItemID uint `json:"menu_item_id"`
	Qty        int  `json:"qty"`
}

// OrderItemResponse is the JSON shape of an order line item.
type OrderItemResponse struct {
	ID           uint   `json:"id"`
	MenuItemID   uint   `json:"menu_item_id"`
	Name         string `json:"name"`
	Qty          int    `json:"qty"`
	AllocatedQty int    `json:"allocated_qty"`
	Status       string `json:"status"`
	PriceEach    int    `json:"price_each"`
}

// OrderResponse is the JSON shape of an order, per SPEC.md's API contract.
// student_name/student_email are populated only for shop-facing views.
// OrderNo is the human-facing daily token number (#1, #2, … reset each day).
type OrderResponse struct {
	ID           uint                `json:"id"`
	OrderNo      int                 `json:"order_no"`
	OrderDate    string              `json:"order_date"`
	Status       string              `json:"status"`
	TotalPrice   int                 `json:"total_price"`
	Paid         bool                `json:"paid"`
	CreatedAt    time.Time           `json:"created_at"`
	ReadyAt      *time.Time          `json:"ready_at"`
	ExpiresAt    *time.Time          `json:"expires_at"`
	StudentName  string              `json:"student_name"`
	StudentEmail string              `json:"student_email"`
	IsGuest      bool                `json:"is_guest"`
	Items        []OrderItemResponse `json:"items"`
}

// ToOrderResponse converts a fully-loaded order (Items.MenuItem and User
// preloaded) into its API shape.
func ToOrderResponse(order models.Order, includeStudent bool) OrderResponse {
	sortedItems := append([]models.OrderItem(nil), order.Items...)
	sort.Slice(sortedItems, func(i, j int) bool { return sortedItems[i].ID < sortedItems[j].ID })

	items := make([]OrderItemResponse, 0, len(sortedItems))
	for _, it := range sortedItems {
		items = append(items, OrderItemResponse{
			ID:           it.ID,
			MenuItemID:   it.MenuItemID,
			Name:         it.MenuItem.Name,
			Qty:          it.Qty,
			AllocatedQty: it.AllocatedQty,
			Status:       string(it.Status),
			PriceEach:    it.PriceEach,
		})
	}

	resp := OrderResponse{
		ID:         order.ID,
		OrderNo:    order.OrderNo,
		OrderDate:  order.OrderDate,
		Status:     string(order.Status),
		TotalPrice: order.TotalPrice,
		Paid:       order.Paid,
		CreatedAt:  order.CreatedAt,
		ReadyAt:    order.ReadyAt,
		ExpiresAt:  order.ExpiresAt,
		Items:      items,
	}
	if includeStudent {
		resp.StudentName = order.User.Name
		resp.StudentEmail = order.User.Email
		resp.IsGuest = order.User.Role == models.RoleGuest
	}
	return resp
}

// loadOrder loads a full order graph (items + menu item names + owning
// user) by id.
func (e *Engine) loadOrder(orderID uint) (models.Order, error) {
	var order models.Order
	err := e.db.Preload("Items.MenuItem").Preload("User").First(&order, orderID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.Order{}, ErrNotFound("order not found")
	}
	if err != nil {
		return models.Order{}, err
	}
	return order, nil
}

// orderResponseFor loads and converts an order in one step.
func (e *Engine) orderResponseFor(orderID uint, includeStudent bool) (OrderResponse, error) {
	order, err := e.loadOrder(orderID)
	if err != nil {
		return OrderResponse{}, err
	}
	return ToOrderResponse(order, includeStudent), nil
}

// loadOrderResponseWithOwner is like orderResponseFor but also returns the
// owning student's user id, and always renders the student-facing shape
// (blank student_name/email) since it feeds the student's own SSE stream.
func (e *Engine) loadOrderResponseWithOwner(orderID uint) (OrderResponse, uint, error) {
	order, err := e.loadOrder(orderID)
	if err != nil {
		return OrderResponse{}, 0, err
	}
	return ToOrderResponse(order, false), order.UserID, nil
}

// CreateOrder places a new order for a student. Enforces the one-active-
// order rule and per-item orderability/qty checks.
func (e *Engine) CreateOrder(userID uint, inputs []OrderItemInput) (OrderResponse, error) {
	if len(inputs) == 0 {
		return OrderResponse{}, ErrBadRequest("order must contain at least one item")
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	var count int64
	if err := e.db.Model(&models.Order{}).
		Where("user_id = ? AND status IN ?", userID, activeStatuses()).
		Count(&count).Error; err != nil {
		return OrderResponse{}, err
	}
	if count > 0 {
		return OrderResponse{}, ErrConflict("you already have an active order")
	}

	orderItems := make([]models.OrderItem, 0, len(inputs))
	total := 0
	for _, in := range inputs {
		if in.Qty < 1 || in.Qty > 20 {
			return OrderResponse{}, ErrBadRequest("qty must be between 1 and 20")
		}
		var mi models.MenuItem
		if err := e.db.First(&mi, in.MenuItemID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return OrderResponse{}, ErrUnorderable("menu item not found")
			}
			return OrderResponse{}, err
		}
		if !itemOrderableNow(mi) {
			return OrderResponse{}, ErrUnorderable(mi.Name + " is not orderable right now")
		}
		orderItems = append(orderItems, models.OrderItem{
			MenuItemID: mi.ID,
			Qty:        in.Qty,
			PriceEach:  mi.Price,
			Status:     models.ItemPending,
		})
		total += mi.Price * in.Qty
	}

	// Token numbers restart at 1 each day; computed under the engine mutex
	// so two simultaneous orders can't take the same number.
	today := models.DayOf(time.Now())
	var maxNo int
	if err := e.db.Model(&models.Order{}).
		Where("order_date = ?", today).
		Select("COALESCE(MAX(order_no), 0)").
		Scan(&maxNo).Error; err != nil {
		return OrderResponse{}, err
	}

	order := models.Order{
		UserID:     userID,
		OrderNo:    maxNo + 1,
		OrderDate:  today,
		Status:     models.OrderSubmitted,
		TotalPrice: total,
	}
	err := e.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&order).Error; err != nil {
			return err
		}
		for i := range orderItems {
			orderItems[i].OrderID = order.ID
		}
		return tx.Create(&orderItems).Error
	})
	if err != nil {
		return OrderResponse{}, err
	}

	e.broadcastOrder(order.ID)
	e.hub.NotifyShopOrdersUpdate()
	return e.orderResponseFor(order.ID, false)
}

// AddItem adds a pending item to an open order (rule 6). Blocked once the
// order is ready/picked/closed or belongs to a different student.
func (e *Engine) AddItem(orderID, userID uint, menuItemID uint, qty int) (OrderResponse, error) {
	if qty < 1 || qty > 20 {
		return OrderResponse{}, ErrBadRequest("qty must be between 1 and 20")
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	var order models.Order
	if err := e.db.First(&order, orderID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OrderResponse{}, ErrNotFound("order not found")
		}
		return OrderResponse{}, err
	}
	if order.UserID != userID {
		return OrderResponse{}, ErrForbidden("not your order")
	}
	switch order.Status {
	case models.OrderSubmitted, models.OrderPreparing, models.OrderPartiallyReady:
		// ok to add
	default:
		return OrderResponse{}, ErrConflict("order can no longer be modified")
	}

	var mi models.MenuItem
	if err := e.db.First(&mi, menuItemID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OrderResponse{}, ErrUnorderable("menu item not found")
		}
		return OrderResponse{}, err
	}
	if !itemOrderableNow(mi) {
		return OrderResponse{}, ErrUnorderable(mi.Name + " is not orderable right now")
	}

	item := models.OrderItem{
		OrderID:    order.ID,
		MenuItemID: mi.ID,
		Qty:        qty,
		PriceEach:  mi.Price,
		Status:     models.ItemPending,
	}
	if err := e.db.Create(&item).Error; err != nil {
		return OrderResponse{}, err
	}
	if err := e.recomputeTotalPrice(order.ID); err != nil {
		return OrderResponse{}, err
	}

	e.broadcastOrder(order.ID)
	e.hub.NotifyShopOrdersUpdate()
	return e.orderResponseFor(order.ID, false)
}

// Cancel lets a student withdraw an order, but only while it is still
// submitted — once the shopkeeper has accepted anything, cancellation is off
// the table and the counter is the place to sort it out.
func (e *Engine) Cancel(orderID, userID uint) (OrderResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	var order models.Order
	if err := e.db.First(&order, orderID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OrderResponse{}, ErrNotFound("order not found")
		}
		return OrderResponse{}, err
	}
	if order.UserID != userID {
		return OrderResponse{}, ErrForbidden("not your order")
	}
	if order.Status != models.OrderSubmitted {
		return OrderResponse{}, ErrConflict("order was already accepted and can no longer be cancelled")
	}

	if err := e.db.Model(&models.OrderItem{}).
		Where("order_id = ? AND status = ?", orderID, models.ItemPending).
		Update("status", models.ItemRejected).Error; err != nil {
		return OrderResponse{}, err
	}
	order.Status = models.OrderCancelled
	if err := e.db.Save(&order).Error; err != nil {
		return OrderResponse{}, err
	}

	e.broadcastOrder(orderID)
	e.hub.NotifyShopOrdersUpdate()
	return e.orderResponseFor(orderID, false)
}

// ShopHistory returns today's finished orders (picked/rejected/expired/
// cancelled), newest first, plus the paid total for counter reconciliation.
func (e *Engine) ShopHistory() ([]OrderResponse, int, error) {
	today := models.DayOf(time.Now())
	var orders []models.Order
	if err := e.db.Preload("Items.MenuItem").Preload("User").
		Where("order_date = ? AND status IN ?", today, []models.OrderStatus{
			models.OrderPicked, models.OrderRejected, models.OrderExpired, models.OrderCancelled,
		}).
		Order("id DESC").Find(&orders).Error; err != nil {
		return nil, 0, err
	}

	out := make([]OrderResponse, 0, len(orders))
	totalPaid := 0
	for _, o := range orders {
		out = append(out, ToOrderResponse(o, true))
		if o.Paid {
			totalPaid += o.TotalPrice
		}
	}
	return out, totalPaid, nil
}

// ActiveOrder returns the student's current active order, if any.
func (e *Engine) ActiveOrder(userID uint) (OrderResponse, error) {
	var order models.Order
	err := e.db.Where("user_id = ? AND status IN ?", userID, activeStatuses()).
		Order("created_at DESC").First(&order).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return OrderResponse{}, ErrNotFound("no active order")
	}
	if err != nil {
		return OrderResponse{}, err
	}
	return e.orderResponseFor(order.ID, false)
}

// OrderHistory returns a student's orders, newest first.
func (e *Engine) OrderHistory(userID uint) ([]OrderResponse, error) {
	var orders []models.Order
	if err := e.db.Preload("Items.MenuItem").Preload("User").
		Where("user_id = ?", userID).
		Order("created_at DESC").Find(&orders).Error; err != nil {
		return nil, err
	}
	out := make([]OrderResponse, 0, len(orders))
	for _, o := range orders {
		out = append(out, ToOrderResponse(o, false))
	}
	return out, nil
}

// ShopOrders splits current orders into incoming (>=1 pending item),
// active (preparing/partially_ready with no pending item) and ready.
func (e *Engine) ShopOrders() (incoming, active, ready []OrderResponse, err error) {
	var orders []models.Order
	if err = e.db.Preload("Items.MenuItem").Preload("User").
		Where("status IN ?", activeStatuses()).
		Order("created_at ASC").Find(&orders).Error; err != nil {
		return nil, nil, nil, err
	}

	incoming = []OrderResponse{}
	active = []OrderResponse{}
	ready = []OrderResponse{}

	for _, o := range orders {
		resp := ToOrderResponse(o, true)
		switch {
		case o.Status == models.OrderReady:
			ready = append(ready, resp)
		case hasPendingItem(o):
			incoming = append(incoming, resp)
		default:
			active = append(active, resp)
		}
	}
	return incoming, active, ready, nil
}

func hasPendingItem(o models.Order) bool {
	for _, it := range o.Items {
		if it.Status == models.ItemPending {
			return true
		}
	}
	return false
}
