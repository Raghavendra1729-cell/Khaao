// Package database opens the GORM connection, sets up postgres extensions,
// runs AutoMigrate, and seeds on boot.
package database

import (
	"errors"
	"fmt"
	"log"
	"strings"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"khaao/internal/config"
	"khaao/internal/models"
)

// Open opens the postgres connection, creates extensions, and runs AutoMigrate.
func Open(cfg *config.Config) (*gorm.DB, error) {
	gormCfg := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}

	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), gormCfg)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	if err := db.Exec("CREATE EXTENSION IF NOT EXISTS citext").Error; err != nil {
		return nil, fmt.Errorf("create citext extension: %w", err)
	}

	if err := db.AutoMigrate(
		&models.User{},
		&models.MenuItem{},
		&models.Order{},
		&models.OrderItem{},
		&models.ItemPool{},
		&models.OrderEvent{},
		&models.ShopkeeperEmail{},
	); err != nil {
		return nil, fmt.Errorf("automigrate: %w", err)
	}

	idxSQL := `CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_order_per_user 
		ON orders(user_id) 
		WHERE status IN ('submitted','preparing','partially_ready','ready','awaiting_payment');`
	if err := db.Exec(idxSQL).Error; err != nil {
		return nil, fmt.Errorf("create partial index: %w", err)
	}

	return db, nil
}

// Seed upserts shopkeeper emails and seeds sample menu.
func Seed(db *gorm.DB, cfg *config.Config) error {
	if err := seedShopkeeperEmails(db, cfg.ShopkeeperEmails); err != nil {
		return fmt.Errorf("seed shopkeeper emails: %w", err)
	}
	if cfg.SeedSampleMenu {
		if err := seedSampleMenu(db); err != nil {
			return fmt.Errorf("seed sample menu: %w", err)
		}
	}
	return nil
}

func seedShopkeeperEmails(db *gorm.DB, raw string) error {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	for _, p := range parts {
		email := strings.TrimSpace(p)
		if email == "" {
			continue
		}
		var se models.ShopkeeperEmail
		err := db.Where("email = ?", email).First(&se).Error
		if isNotFound(err) {
			se = models.ShopkeeperEmail{Email: email, Note: "Seeded from env"}
			if err := db.Create(&se).Error; err != nil {
				return err
			}
			log.Printf("khaao: seeded shopkeeper email %s", email)
		} else if err != nil {
			return err
		}
	}
	return nil
}

func seedSampleMenu(db *gorm.DB) error {
	var count int64
	if err := db.Model(&models.MenuItem{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	items := []models.MenuItem{
		{Name: "Samosa", Price: 1500, IsAvailable: true},
		{Name: "Veg Puff", Price: 2000, IsAvailable: true},
		{Name: "Masala Dosa", Price: 4000, IsAvailable: true},
		{Name: "Chai", Price: 1000, IsAvailable: true},
		{Name: "Cold Coffee", Price: 3000, IsAvailable: true},
		{Name: "Veg Fried Rice", Price: 5000, IsAvailable: true},
	}
	if err := db.Create(&items).Error; err != nil {
		return err
	}
	log.Printf("khaao: seeded %d sample menu items", len(items))
	return nil
}

func isNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
