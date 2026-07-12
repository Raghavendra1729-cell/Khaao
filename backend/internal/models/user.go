package models

import "time"

// Role identifies the type of user account.
type Role string

const (
	RoleStudent    Role = "student"
	RoleShopkeeper Role = "shopkeeper"
	RoleGuest      Role = "guest"
)

// AuthProvider identifies how an account authenticates.
type AuthProvider string

const (
	ProviderPassword AuthProvider = "password"
	ProviderGoogle   AuthProvider = "google"
	ProviderGuest    AuthProvider = "guest"
)

// User is a student, guest, or shopkeeper account. PasswordHash is empty for
// google/guest accounts, which can never log in with a password (bcrypt
// comparison against an empty hash always fails).
type User struct {
	ID           uint         `gorm:"primaryKey" json:"id"`
	Name         string       `gorm:"not null" json:"name"`
	Email        string       `gorm:"uniqueIndex;not null" json:"email"`
	PasswordHash string       `json:"-"`
	Role         Role         `gorm:"not null;index" json:"role"`
	Provider     AuthProvider `gorm:"not null;default:password" json:"provider"`
	CreatedAt    time.Time    `json:"created_at"`
}
