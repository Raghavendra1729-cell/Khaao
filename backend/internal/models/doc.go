// Package models defines the application's domain types, persisted via GORM.
//
// The versioned SQL migrations in migrations/ (applied via golang-migrate,
// see database.Open) are the schema source of truth — not the `gorm:"..."`
// struct tags below. Those tags were how AutoMigrate generated the schema
// before WP4 replaced it with explicit migrations; they're left in place as
// documentation of intent (nullability, indexes, defaults) but editing one no
// longer changes the actual database schema. A schema change means writing a
// new migration file, not editing a struct tag.
package models
