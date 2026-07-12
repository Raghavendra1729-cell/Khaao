// Package database opens the GORM connection (sqlite or postgres, chosen by
// DB_DRIVER), runs AutoMigrate, and seeds the shopkeeper account + sample
// menu on boot.
package database

import (
	"errors"
	"fmt"
	"log"

	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"khaao/internal/config"
	"khaao/internal/models"
)

// Open opens the configured database driver and runs AutoMigrate.
func Open(cfg *config.Config) (*gorm.DB, error) {
	gormCfg := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}

	var (
		db  *gorm.DB
		err error
	)
	switch cfg.DBDriver {
	case "postgres":
		db, err = gorm.Open(postgres.Open(cfg.DBDSN), gormCfg)
	case "sqlite", "":
		db, err = gorm.Open(sqlite.Open(cfg.DBDSN), gormCfg)
	default:
		return nil, fmt.Errorf("unsupported DB_DRIVER %q (want sqlite or postgres)", cfg.DBDriver)
	}
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	if err := db.AutoMigrate(
		&models.User{},
		&models.MenuItem{},
		&models.Order{},
		&models.OrderItem{},
		&models.DonePool{},
	); err != nil {
		return nil, fmt.Errorf("automigrate: %w", err)
	}

	return db, nil
}

// Seed creates the shopkeeper account (if missing) and a sample menu (if the
// menu is empty and SEED_SAMPLE_MENU=true).
func Seed(db *gorm.DB, cfg *config.Config) error {
	if err := seedShopkeeper(db, cfg); err != nil {
		return fmt.Errorf("seed shopkeeper: %w", err)
	}
	if cfg.SeedSampleMenu {
		if err := seedSampleMenu(db); err != nil {
			return fmt.Errorf("seed sample menu: %w", err)
		}
	}
	return nil
}

func seedShopkeeper(db *gorm.DB, cfg *config.Config) error {
	var existing models.User
	err := db.Where("email = ?", cfg.ShopkeeperEmail).First(&existing).Error
	if err == nil {
		return nil // already seeded
	}
	if !isNotFound(err) {
		return err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(cfg.ShopkeeperPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	user := models.User{
		Name:         cfg.ShopkeeperName,
		Email:        cfg.ShopkeeperEmail,
		PasswordHash: string(hash),
		Role:         models.RoleShopkeeper,
		Provider:     models.ProviderPassword,
	}
	if err := db.Create(&user).Error; err != nil {
		return err
	}
	log.Printf("khaao: seeded shopkeeper account %s", cfg.ShopkeeperEmail)
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
