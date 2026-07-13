package models

import "time"

type OrderStatus string

const (
	OrderSubmitted       OrderStatus = "submitted"
	OrderPreparing       OrderStatus = "preparing"
	OrderPartiallyReady  OrderStatus = "partially_ready"
	OrderReady           OrderStatus = "ready"
	OrderAwaitingPayment OrderStatus = "awaiting_payment"
	OrderCompleted       OrderStatus = "completed"
	OrderRejected        OrderStatus = "rejected"
	OrderExpired         OrderStatus = "expired"
	OrderCancelled       OrderStatus = "cancelled"
)

func IsActiveOrderStatus(s OrderStatus) bool {
	switch s {
	case OrderSubmitted, OrderPreparing, OrderPartiallyReady, OrderReady, OrderAwaitingPayment:
		return true
	}
	return false
}

type Order struct {
	ID         uint        `gorm:"primaryKey" json:"id"`
	OrderNo    int         `gorm:"not null;uniqueIndex:idx_orders_date_no" json:"order_no"`
	OrderDate  string      `gorm:"type:date;not null;uniqueIndex:idx_orders_date_no;index" json:"order_date"`
	UserID     uint        `gorm:"not null;index:idx_user_created,priority:1" json:"user_id"`
	User       User        `gorm:"foreignKey:UserID" json:"-"`
	Status     OrderStatus `gorm:"not null;index;check:status IN ('submitted','preparing','partially_ready','ready','awaiting_payment','completed','rejected','cancelled','expired')" json:"status"`
	TotalPrice int         `gorm:"not null;default:0;check:total_price >= 0" json:"total_price"`
	Paid       bool        `gorm:"not null;default:false" json:"paid"`
	PaidAt     *time.Time  `json:"paid_at"`
	AcceptedAt *time.Time  `json:"accepted_at"`
	ReadyAt    *time.Time  `json:"ready_at"`
	ExpiresAt  *time.Time  `json:"expires_at"`
	CreatedAt  time.Time   `gorm:"not null;default:now();index:idx_user_created,priority:2,sort:desc" json:"created_at"`
	UpdatedAt  time.Time   `gorm:"not null;default:now()" json:"updated_at"`
	Items      []OrderItem `gorm:"foreignKey:OrderID" json:"-"`
}

func DayOf(t time.Time) string {
	return t.Format("2006-01-02")
}
