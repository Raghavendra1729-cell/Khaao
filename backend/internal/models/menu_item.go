package models

import (
	"time"

	"gorm.io/gorm"
)

// MenuItem is a single dish the canteen can sell.
type MenuItem struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	Name        string         `gorm:"not null" json:"name"`
	Price       int            `gorm:"not null" json:"price"` // paise
	PhotoURL    string         `json:"photo_url"`
	IsAvailable bool           `gorm:"not null;default:true" json:"is_available"`
	AvailFrom   *string        `json:"avail_from"` // "HH:MM" or nil
	AvailTo     *string        `json:"avail_to"`   // "HH:MM" or nil
	OutOfStock  bool           `gorm:"not null;default:false" json:"out_of_stock"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}
