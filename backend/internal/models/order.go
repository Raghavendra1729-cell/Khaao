package models

import "time"

// OrderStatus is the order state machine per SPEC.md.
type OrderStatus string

const (
	OrderSubmitted      OrderStatus = "submitted"
	OrderPreparing      OrderStatus = "preparing"
	OrderPartiallyReady OrderStatus = "partially_ready"
	OrderReady          OrderStatus = "ready"
	OrderPicked         OrderStatus = "picked"
	OrderRejected       OrderStatus = "rejected"
	OrderExpired        OrderStatus = "expired"
	OrderCancelled      OrderStatus = "cancelled"
)

// IsActiveOrderStatus returns true if the given status counts toward the
// "one active order per student" rule.
func IsActiveOrderStatus(s OrderStatus) bool {
	switch s {
	case OrderSubmitted, OrderPreparing, OrderPartiallyReady, OrderReady:
		return true
	}
	return false
}

// Order is a single student order, one at a time per student while active.
// OrderNo is the human-facing token number, starting at 1 each day
// (OrderDate, "YYYY-MM-DD" server-local); rows are never deleted, so history
// survives the daily reset.
type Order struct {
	ID         uint        `gorm:"primaryKey" json:"id"`
	UserID     uint        `gorm:"not null;index" json:"user_id"`
	User       User        `gorm:"foreignKey:UserID" json:"-"`
	OrderNo    int         `gorm:"not null;default:0;uniqueIndex:idx_orders_day_no" json:"order_no"`
	OrderDate  string      `gorm:"not null;default:'';uniqueIndex:idx_orders_day_no;index" json:"order_date"`
	Status     OrderStatus `gorm:"not null;index" json:"status"`
	TotalPrice int         `gorm:"not null;default:0" json:"total_price"`
	Paid       bool        `gorm:"not null;default:false" json:"paid"`
	PaidAt     *time.Time  `json:"paid_at"`
	CreatedAt  time.Time   `json:"created_at"`
	ReadyAt    *time.Time  `json:"ready_at"`
	ExpiresAt  *time.Time  `json:"expires_at"`
	ClosedAt   *time.Time  `json:"closed_at"`
	Items      []OrderItem `gorm:"foreignKey:OrderID" json:"-"`
}

// DayOf formats t as an OrderDate key.
func DayOf(t time.Time) string {
	return t.Format("2006-01-02")
}
