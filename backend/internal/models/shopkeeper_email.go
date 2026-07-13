package models

import "time"

type ShopkeeperEmail struct {
	Email     string    `gorm:"primaryKey;type:citext" json:"email"`
	Note      string    `gorm:"not null;default:''" json:"note"`
	CreatedAt time.Time `gorm:"not null;default:now()" json:"created_at"`
}
