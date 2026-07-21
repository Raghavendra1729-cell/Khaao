package models

import "time"

type OrderItemStatus string

const (
	ItemPending    OrderItemStatus = "pending"
	ItemQueued     OrderItemStatus = "queued"
	ItemAllocated  OrderItemStatus = "allocated"
	ItemHandedOver OrderItemStatus = "handed_over"
	ItemRejected   OrderItemStatus = "rejected"
)

type OrderItem struct {
	ID         uint     `gorm:"primaryKey" json:"id"`
	OrderID    uint     `gorm:"not null;index" json:"order_id"`
	MenuItemID uint     `gorm:"not null" json:"menu_item_id"`
	MenuItem   MenuItem `gorm:"foreignKey:MenuItemID" json:"-"`
	Name       string   `gorm:"not null" json:"name"`
	// PhotoURL is copied from the menu item at order-creation time, same as
	// Name and PriceEach — so a photo edit or deletion on the menu later
	// never changes what a past order shows.
	PhotoURL     string          `json:"photo_url"`
	PriceEach    int             `gorm:"not null;check:price_each >= 0" json:"price_each"`
	Qty          int             `gorm:"not null;check:qty > 0 AND qty <= 20" json:"qty"`
	AllocatedQty int             `gorm:"not null;default:0;check:allocated_qty >= 0 AND allocated_qty <= qty" json:"allocated_qty"`
	HandedQty    int             `gorm:"not null;default:0;check:handed_qty >= 0 AND handed_qty <= allocated_qty" json:"handed_qty"`
	Status       OrderItemStatus `gorm:"not null;check:status IN ('pending','queued','allocated','handed_over','rejected')" json:"status"`
	CreatedAt    time.Time       `gorm:"not null;default:now()" json:"created_at"`
}
