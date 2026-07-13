package models

import (
	"time"
)

type EventType string

const (
	EventPlaced      EventType = "placed"
	EventAccepted    EventType = "accepted"
	EventRejected    EventType = "rejected"
	EventCancelled   EventType = "cancelled"
	EventItemTrimmed EventType = "item_trimmed"
	EventItemReady   EventType = "item_ready"
	EventItemHanded  EventType = "item_handed"
	EventPaid        EventType = "paid"
	EventExpired     EventType = "expired"
	EventDayClosed   EventType = "day_closed"
)

type OrderEvent struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	OrderID   uint      `gorm:"not null;index" json:"order_id"`
	Type      EventType `gorm:"not null" json:"type"`
	Payload   []byte    `gorm:"type:jsonb;not null;default:'{}'" json:"payload"`
	CreatedAt time.Time `gorm:"not null;default:now()" json:"created_at"`
}
