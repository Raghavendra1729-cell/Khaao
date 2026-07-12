package models

import "time"

// OrderItemStatus is the order-item state machine per SPEC.md.
type OrderItemStatus string

const (
	ItemPending    OrderItemStatus = "pending"
	ItemQueued     OrderItemStatus = "queued"
	ItemAllocated  OrderItemStatus = "allocated"
	ItemRejected   OrderItemStatus = "rejected"
	ItemHandedOver OrderItemStatus = "handed_over"
)

// OrderItem is one line item (one menu item + quantity) within an order.
type OrderItem struct {
	ID           uint            `gorm:"primaryKey" json:"id"`
	OrderID      uint            `gorm:"not null;index" json:"order_id"`
	MenuItemID   uint            `gorm:"not null;index" json:"menu_item_id"`
	MenuItem     MenuItem        `gorm:"foreignKey:MenuItemID" json:"-"`
	Qty          int             `gorm:"not null" json:"qty"`
	AllocatedQty int             `gorm:"not null;default:0" json:"allocated_qty"`
	PriceEach    int             `gorm:"not null" json:"price_each"`
	Status       OrderItemStatus `gorm:"not null" json:"status"`
	CreatedAt    time.Time       `json:"created_at"`
}
