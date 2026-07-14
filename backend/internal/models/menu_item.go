package models

import (
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type MenuItem struct {
	ID       uint   `gorm:"primaryKey" json:"id"`
	Name     string `gorm:"not null" json:"name"`
	Price    int    `gorm:"not null;check:price >= 0" json:"price"`
	PhotoURL string `json:"photo_url"`
	// Diet is required at the API layer (veg | non_veg). The column defaults to
	// 'veg' so AutoMigrate can backfill any pre-existing rows without a NULL.
	Diet string `gorm:"not null;default:'veg';check:diet IN ('veg','non_veg')" json:"diet"`
	// Tags is a free-form list of category tags. Stored as JSON; the API DTO
	// normalizes a nil slice to [] so the wire shape is never null.
	Tags        datatypes.JSONSlice[string] `json:"tags"`
	IsAvailable bool                        `gorm:"not null;default:true" json:"is_available"`
	AvailFrom   *string                     `json:"avail_from"`
	AvailTo     *string                     `json:"avail_to"`
	OutOfStock  bool                        `gorm:"not null;default:false" json:"out_of_stock"`
	CreatedAt   time.Time                   `json:"created_at"`
	UpdatedAt   time.Time                   `json:"updated_at"`
	DeletedAt   gorm.DeletedAt              `gorm:"index" json:"-"`
}
