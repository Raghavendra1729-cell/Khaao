package models

import "time"

type ShopState string

const (
	ShopOpen   ShopState = "open"
	ShopPaused ShopState = "paused"
	ShopClosed ShopState = "closed"
)

// ShopStatus is a singleton row (id fixed = 1) describing whether the canteen
// is accepting orders. When state is "paused", ReopenAt carries the time the
// shopkeeper expects to reopen; it is nil for "open" and "closed".
type ShopStatus struct {
	ID        uint       `gorm:"primaryKey" json:"-"`
	State     string     `gorm:"not null;default:'open';check:state IN ('open','paused','closed')" json:"state"`
	ReopenAt  *time.Time `json:"reopen_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}
