package models

import "time"

type ItemRating struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	OrderItemID uint      `gorm:"not null;uniqueIndex" json:"order_item_id"`
	MenuItemID  uint      `gorm:"not null;index" json:"menu_item_id"`
	UserID      uint      `gorm:"not null;index" json:"user_id"`
	Stars       int       `gorm:"not null;check:stars >= 1 AND stars <= 5" json:"stars"`
	CreatedAt   time.Time `gorm:"not null;default:now()" json:"created_at"`
}
