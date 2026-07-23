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
	FindByIDForUpdate(ctx context.Context, id uint) (*models.Order, error)
	FindActiveByUserID(ctx context.Context, userID uint) (*models.Order, error)
	FindActiveByUserIDForUpdate(ctx context.Context, userID uint) (*models.Order, error)
	FindHistoryByUserID(ctx context.Context, userID uint) ([]models.Order, error)
	FindIncoming(ctx context.Context) ([]models.Order, error)
	FindInProgress(ctx context.Context) ([]models.Order, error)
	FindAwaitingPayment(ctx context.Context) ([]models.Order, error)
	FindTerminalByDate(ctx context.Context, date string) ([]models.Order, error)
	GetMaxOrderNo(ctx context.Context, date string) (int, error)
	FindPreparingOldest(ctx context.Context) ([]models.Order, error)
	FindPreparingOldestForUpdate(ctx context.Context) ([]models.Order, error)
	FindReadyExpired(ctx context.Context) ([]models.Order, error)
	FindReadyExpiredForUpdate(ctx context.Context) ([]models.Order, error)
	FindNonTerminal(ctx context.Context) ([]models.Order, error)
	FindNonTerminalForUpdate(ctx context.Context) ([]models.Order, error)
	SaveItem(ctx context.Context, item *models.OrderItem) error
	// HasActiveItemsForMenuItem returns true if any non-terminal order currently
	// contains an active (non-rejected) item for the given menu item ID. Used to
	// block menu-item deletion while it is referenced by an in-flight order.
	HasActiveItemsForMenuItem(ctx context.Context, menuItemID uint) (bool, error)
	// CountActive returns the number of orders in an active status
	// (submitted / preparing / partially_ready / ready / awaiting_payment).
	// Used by the shop-status guard.
	CountActive(ctx context.Context) (int, error)
	// CountAccepted returns the number of orders in a status that indicates the
	// shopkeeper has already committed to them (preparing / partially_ready /
	// ready / awaiting_payment). submitted orders are excluded because the
	// shopkeeper hasn't accepted them yet and must be able to pause/close freely
	// while they exist. Used by ShopStatusService.Set to guard pause/close.
	CountAccepted(ctx context.Context) (int, error)
	// SumOrderedQtyByDate returns, per menu item id, the total ordered qty for
	// the given business-day date across all non-rejected orders. Powers the
	// public menu's order_count_today (trending) figure.
	SumOrderedQtyByDate(ctx context.Context, date string) (map[uint]int, error)
}

type ShopStatusRepo interface {
	// Get returns the singleton shop-status row, or (nil, nil) if unseeded.
	Get(ctx context.Context) (*models.ShopStatus, error)
	Save(ctx context.Context, status *models.ShopStatus) error
}

type PoolRepo interface {
	FindAll(ctx context.Context) (map[uint]int, error)
	Lock(ctx context.Context, menuItemID uint) (int, error)
	Add(ctx context.Context, menuItemID uint, qty int) error
	// Delete removes a menu item's item_pool row entirely. Used when the
	// menu item itself is deleted: a soft delete is an UPDATE, so
	// item_pool's ON DELETE CASCADE never fires, and a stranded row makes
	// PrepList resolve it to a nameless ghost item forever.
	Delete(ctx context.Context, menuItemID uint) error
	ZeroAll(ctx context.Context) error
}

type EventRepo interface {
	Log(ctx context.Context, event *models.OrderEvent) error
}

type MenuRatingAggregate struct {
	AvgRating   float64
	RatingCount int
}

type RatingRepo interface {
	SaveAll(ctx context.Context, ratings []models.ItemRating) error
	GetMenuAggregates(ctx context.Context) (map[uint]MenuRatingAggregate, error)
}

type PushRepo interface {
	Save(ctx context.Context, sub *models.PushSubscription) error
	FindByRole(ctx context.Context, role models.Role) ([]models.PushSubscription, error)
	FindByUserID(ctx context.Context, userID uint) ([]models.PushSubscription, error)
	DeleteByEndpoint(ctx context.Context, endpoint string) error
	FindByEndpoint(ctx context.Context, endpoint string) (*models.PushSubscription, error)
}
