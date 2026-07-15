package models

import "time"

// PushSubscription represents a Web Push subscription for a user (shopkeeper).
// A user can have multiple subscriptions (e.g. tablet, phone, desktop).
type PushSubscription struct {
	ID        uint      `json:"id" gorm:"primarykey"`
	UserID    uint      `json:"user_id" gorm:"index"`
	Endpoint  string    `json:"endpoint" gorm:"uniqueIndex"`
	P256dh    string    `json:"p256dh"`
	Auth      string    `json:"auth"`
	CreatedAt time.Time `json:"created_at"`
}
