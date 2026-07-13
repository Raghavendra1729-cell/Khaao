package models

import "time"

type Role string

const (
	RoleStudent    Role = "student"
	RoleShopkeeper Role = "shopkeeper"
)

type User struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	FirebaseUID string    `gorm:"uniqueIndex;not null" json:"firebase_uid"`
	Email       string    `gorm:"type:citext;uniqueIndex;not null" json:"email"`
	Name        string    `gorm:"not null;default:''" json:"name"`
	PhotoURL    string    `gorm:"not null;default:''" json:"photo_url"`
	Role        Role      `gorm:"not null;check:role IN ('student','shopkeeper')" json:"role"`
	CreatedAt   time.Time `gorm:"not null;default:now()" json:"created_at"`
	UpdatedAt   time.Time `gorm:"not null;default:now()" json:"updated_at"`
}
