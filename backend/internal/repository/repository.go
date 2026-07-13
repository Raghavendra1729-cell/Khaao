package repository

import (
	"context"
	"khaao/internal/models"
)

type UnitOfWork interface {
	WithTx(ctx context.Context, fn func(txCtx context.Context) error) error
}

type UserRepo interface {
	FindByID(ctx context.Context, id uint) (*models.User, error)
	FindByEmail(ctx context.Context, email string) (*models.User, error)
	FindByFirebaseUID(ctx context.Context, uid string) (*models.User, error)
	Save(ctx context.Context, user *models.User) error
}

type ShopkeeperEmailRepo interface {
	Exists(ctx context.Context, email string) (bool, error)
}

type MenuRepo interface {
	FindAll(ctx context.Context, onlyAvailable bool) ([]models.MenuItem, error)
	FindByID(ctx context.Context, id uint) (*models.MenuItem, error)
	FindMapByIDs(ctx context.Context, ids []uint) (map[uint]models.MenuItem, error)
	Save(ctx context.Context, item *models.MenuItem) error
	Delete(ctx context.Context, id uint) error
	UpdateStock(ctx context.Context, id uint, outOfStock bool) error
	ResetStock(ctx context.Context) error
}

type OrderRepo interface {
	Create(ctx context.Context, order *models.Order) error
	Save(ctx context.Context, order *models.Order) error
	FindByID(ctx context.Context, id uint) (*models.Order, error)
	FindActiveByUserID(ctx context.Context, userID uint) (*models.Order, error)
	FindHistoryByUserID(ctx context.Context, userID uint) ([]models.Order, error)
	FindIncoming(ctx context.Context) ([]models.Order, error)
	FindInProgress(ctx context.Context) ([]models.Order, error)
	FindAwaitingPayment(ctx context.Context) ([]models.Order, error)
	FindTerminalByDate(ctx context.Context, date string) ([]models.Order, error)
	GetMaxOrderNo(ctx context.Context, date string) (int, error)
	FindPreparingOldest(ctx context.Context) ([]models.Order, error)
	FindReadyExpired(ctx context.Context) ([]models.Order, error)
	FindNonTerminal(ctx context.Context) ([]models.Order, error)
	SaveItem(ctx context.Context, item *models.OrderItem) error
}

type PoolRepo interface {
	FindAll(ctx context.Context) (map[uint]int, error)
	Add(ctx context.Context, menuItemID uint, qty int) error
	ZeroAll(ctx context.Context) error
}

type EventRepo interface {
	Log(ctx context.Context, event *models.OrderEvent) error
}
