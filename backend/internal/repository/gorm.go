package repository

import (
	"context"
	"errors"
	"khaao/internal/models"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type GormUnitOfWork struct {
	db *gorm.DB
}

func NewUnitOfWork(db *gorm.DB) UnitOfWork {
	return &GormUnitOfWork{db: db}
}

func (u *GormUnitOfWork) WithTx(ctx context.Context, fn func(txCtx context.Context) error) error {
	return u.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The application is deliberately deployed as a single replica, but this
		// transaction-scoped lock is the database backstop for a brief overlap
		// during deploys or an accidental second replica. Row locks below protect
		// the individual records; this lock also makes allocation's multi-row FCFS
		// scan deterministic across processes.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(84202383174619)").Error; err != nil {
			return err
		}
		txCtx := context.WithValue(ctx, txKey{}, tx)
		return fn(txCtx)
	})
}

type txKey struct{}

func getDB(ctx context.Context, db *gorm.DB) *gorm.DB {
	if tx, ok := ctx.Value(txKey{}).(*gorm.DB); ok {
		return tx
	}
	return db.WithContext(ctx)
}

type GormUserRepo struct {
	db *gorm.DB
}

func NewUserRepo(db *gorm.DB) UserRepo {
	return &GormUserRepo{db: db}
}

func (r *GormUserRepo) FindByID(ctx context.Context, id uint) (*models.User, error) {
	var user models.User
	err := getDB(ctx, r.db).First(&user, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

func (r *GormUserRepo) FindByEmail(ctx context.Context, email string) (*models.User, error) {
	var user models.User
	err := getDB(ctx, r.db).Where("email = ?", email).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

func (r *GormUserRepo) FindByFirebaseUID(ctx context.Context, uid string) (*models.User, error) {
	var user models.User
	err := getDB(ctx, r.db).Where("firebase_uid = ?", uid).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

func (r *GormUserRepo) Save(ctx context.Context, user *models.User) error {
	return getDB(ctx, r.db).Save(user).Error
}

type GormShopkeeperEmailRepo struct {
	db *gorm.DB
}

func NewShopkeeperEmailRepo(db *gorm.DB) ShopkeeperEmailRepo {
	return &GormShopkeeperEmailRepo{db: db}
}

func (r *GormShopkeeperEmailRepo) Exists(ctx context.Context, email string) (bool, error) {
	var count int64
	err := getDB(ctx, r.db).Model(&models.ShopkeeperEmail{}).Where("email = ?", email).Count(&count).Error
	return count > 0, err
}

type GormMenuRepo struct {
	db *gorm.DB
}

func NewMenuRepo(db *gorm.DB) MenuRepo {
	return &GormMenuRepo{db: db}
}

func (r *GormMenuRepo) FindAll(ctx context.Context, onlyAvailable bool) ([]models.MenuItem, error) {
	var items []models.MenuItem
	q := getDB(ctx, r.db).Order("id asc")
	if onlyAvailable {
		q = q.Where("is_available = ?", true)
	}
	err := q.Find(&items).Error
	return items, err
}

func (r *GormMenuRepo) FindByID(ctx context.Context, id uint) (*models.MenuItem, error) {
	var item models.MenuItem
	err := getDB(ctx, r.db).First(&item, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &item, err
}

func (r *GormMenuRepo) FindMapByIDs(ctx context.Context, ids []uint) (map[uint]models.MenuItem, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var items []models.MenuItem
	if err := getDB(ctx, r.db).Where("id IN ?", ids).Find(&items).Error; err != nil {
		return nil, err
	}
	m := make(map[uint]models.MenuItem)
	for _, it := range items {
		m[it.ID] = it
	}
	return m, nil
}

func (r *GormMenuRepo) Save(ctx context.Context, item *models.MenuItem) error {
	return getDB(ctx, r.db).Save(item).Error
}

func (r *GormMenuRepo) Delete(ctx context.Context, id uint) error {
	return getDB(ctx, r.db).Delete(&models.MenuItem{}, id).Error
}

func (r *GormMenuRepo) UpdateStock(ctx context.Context, id uint, outOfStock bool) error {
	return getDB(ctx, r.db).Model(&models.MenuItem{}).Where("id = ?", id).Update("out_of_stock", outOfStock).Error
}

func (r *GormMenuRepo) ResetStock(ctx context.Context) error {
	return getDB(ctx, r.db).Model(&models.MenuItem{}).Where("1 = 1").Update("out_of_stock", false).Error
}

type GormOrderRepo struct {
	db *gorm.DB
}

func NewOrderRepo(db *gorm.DB) OrderRepo {
	return &GormOrderRepo{db: db}
}

func (r *GormOrderRepo) Create(ctx context.Context, order *models.Order) error {
	return getDB(ctx, r.db).Create(order).Error
}

func (r *GormOrderRepo) Save(ctx context.Context, order *models.Order) error {
	return getDB(ctx, r.db).Save(order).Error
}

func (r *GormOrderRepo) SaveItem(ctx context.Context, item *models.OrderItem) error {
	return getDB(ctx, r.db).Save(item).Error
}

func (r *GormOrderRepo) FindByID(ctx context.Context, id uint) (*models.Order, error) {
	var order models.Order
	err := getDB(ctx, r.db).Preload("Items").Preload("User").First(&order, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &order, err
}

// FindByIDForUpdate locks the order and then its items in a stable order.
// It must be called from a UnitOfWork transaction.
func (r *GormOrderRepo) FindByIDForUpdate(ctx context.Context, id uint) (*models.Order, error) {
	db := getDB(ctx, r.db)
	var order models.Order
	err := db.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("order_id = ?", order.ID).Order("created_at asc, id asc").Find(&order.Items).Error; err != nil {
		return nil, err
	}
	return &order, nil
}

func (r *GormOrderRepo) FindActiveByUserID(ctx context.Context, userID uint) (*models.Order, error) {
	var order models.Order
	err := getDB(ctx, r.db).Preload("Items").
		Where("user_id = ? AND status IN ?", userID, []models.OrderStatus{
			models.OrderSubmitted, models.OrderPreparing, models.OrderPartiallyReady, models.OrderReady, models.OrderAwaitingPayment,
		}).
		Order("created_at desc").First(&order).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &order, err
}

func (r *GormOrderRepo) FindActiveByUserIDForUpdate(ctx context.Context, userID uint) (*models.Order, error) {
	db := getDB(ctx, r.db)
	var order models.Order
	err := db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("user_id = ? AND status IN ?", userID, activeOrderStatuses()).
		Order("created_at desc, id desc").First(&order).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("order_id = ?", order.ID).Order("created_at asc, id asc").Find(&order.Items).Error; err != nil {
		return nil, err
	}
	return &order, nil
}

func (r *GormOrderRepo) FindHistoryByUserID(ctx context.Context, userID uint) ([]models.Order, error) {
	var orders []models.Order
	err := getDB(ctx, r.db).Preload("Items").
		Where("user_id = ? AND status NOT IN ?", userID, []models.OrderStatus{
			models.OrderSubmitted, models.OrderPreparing, models.OrderPartiallyReady, models.OrderReady, models.OrderAwaitingPayment,
		}).
		Order("created_at desc").Find(&orders).Error
	return orders, err
}

func (r *GormOrderRepo) FindIncoming(ctx context.Context) ([]models.Order, error) {
	var orders []models.Order
	err := getDB(ctx, r.db).Preload("Items").Preload("User").
		Where("status = ?", models.OrderSubmitted).
		Order("created_at asc").Find(&orders).Error
	return orders, err
}

func (r *GormOrderRepo) FindInProgress(ctx context.Context) ([]models.Order, error) {
	var orders []models.Order
	err := getDB(ctx, r.db).Preload("Items").Preload("User").
		Where("status IN ?", []models.OrderStatus{models.OrderPreparing, models.OrderPartiallyReady, models.OrderReady}).
		Order("created_at asc").Find(&orders).Error
	return orders, err
}

func (r *GormOrderRepo) FindAwaitingPayment(ctx context.Context) ([]models.Order, error) {
	var orders []models.Order
	err := getDB(ctx, r.db).Preload("Items").Preload("User").
		Where("status = ?", models.OrderAwaitingPayment).
		Order("created_at asc").Find(&orders).Error
	return orders, err
}

func (r *GormOrderRepo) FindTerminalByDate(ctx context.Context, date string) ([]models.Order, error) {
	var orders []models.Order
	err := getDB(ctx, r.db).Preload("Items").Preload("User").
		Where("order_date = ? AND status IN ?", date, []models.OrderStatus{
			models.OrderCompleted, models.OrderRejected, models.OrderExpired, models.OrderCancelled,
		}).
		Order("created_at desc").Find(&orders).Error
	return orders, err
}

func (r *GormOrderRepo) GetMaxOrderNo(ctx context.Context, date string) (int, error) {
	var maxNo int
	err := getDB(ctx, r.db).Model(&models.Order{}).Where("order_date = ?", date).Select("COALESCE(MAX(order_no), 0)").Scan(&maxNo).Error
	return maxNo, err
}

func (r *GormOrderRepo) FindPreparingOldest(ctx context.Context) ([]models.Order, error) {
	var orders []models.Order
	err := getDB(ctx, r.db).
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("created_at asc, id asc") }).
		Where("status IN ?", []models.OrderStatus{models.OrderPreparing, models.OrderPartiallyReady}).
		Order("created_at asc, id asc").Find(&orders).Error
	return orders, err
}

func (r *GormOrderRepo) FindPreparingOldestForUpdate(ctx context.Context) ([]models.Order, error) {
	return r.findOrdersForUpdate(ctx, "status IN ?", "created_at asc, id asc", []models.OrderStatus{models.OrderPreparing, models.OrderPartiallyReady})
}

func (r *GormOrderRepo) FindReadyExpired(ctx context.Context) ([]models.Order, error) {
	var orders []models.Order
	err := getDB(ctx, r.db).Preload("Items").
		Where("status = ? AND expires_at < ?", models.OrderReady, time.Now()).
		Find(&orders).Error
	return orders, err
}

func (r *GormOrderRepo) FindReadyExpiredForUpdate(ctx context.Context) ([]models.Order, error) {
	return r.findOrdersForUpdate(ctx, "status = ? AND expires_at < ?", "created_at asc, id asc", models.OrderReady, time.Now())
}

func (r *GormOrderRepo) FindNonTerminal(ctx context.Context) ([]models.Order, error) {
	var orders []models.Order
	err := getDB(ctx, r.db).Preload("Items").
		Where("status IN ?", []models.OrderStatus{
			models.OrderSubmitted, models.OrderPreparing, models.OrderPartiallyReady, models.OrderReady, models.OrderAwaitingPayment,
		}).
		Find(&orders).Error
	return orders, err
}

func (r *GormOrderRepo) FindNonTerminalForUpdate(ctx context.Context) ([]models.Order, error) {
	return r.findOrdersForUpdate(ctx, "status IN ?", "created_at asc, id asc", []models.OrderStatus{
		models.OrderSubmitted, models.OrderPreparing, models.OrderPartiallyReady, models.OrderReady, models.OrderAwaitingPayment,
	})
}

func (r *GormOrderRepo) findOrdersForUpdate(ctx context.Context, condition, orderBy string, args ...any) ([]models.Order, error) {
	db := getDB(ctx, r.db)
	var orders []models.Order
	q := db.Clauses(clause.Locking{Strength: "UPDATE"}).Where(condition, args...).Order(orderBy)
	if err := q.Find(&orders).Error; err != nil {
		return nil, err
	}
	if len(orders) == 0 {
		return orders, nil
	}
	ids := make([]uint, 0, len(orders))
	byID := make(map[uint]*models.Order, len(orders))
	for i := range orders {
		ids = append(ids, orders[i].ID)
		byID[orders[i].ID] = &orders[i]
	}
	var items []models.OrderItem
	if err := db.Clauses(clause.Locking{Strength: "UPDATE"}).Where("order_id IN ?", ids).
		Order("order_id asc, created_at asc, id asc").Find(&items).Error; err != nil {
		return nil, err
	}
	for _, item := range items {
		order := byID[item.OrderID]
		order.Items = append(order.Items, item)
	}
	return orders, nil
}

func activeOrderStatuses() []models.OrderStatus {
	return []models.OrderStatus{
		models.OrderSubmitted, models.OrderPreparing, models.OrderPartiallyReady, models.OrderReady, models.OrderAwaitingPayment,
	}
}

// HasActiveItemsForMenuItem returns true if a non-terminal order contains a
// non-rejected item for menuItemID. A single COUNT avoids loading whole orders.
func (r *GormOrderRepo) HasActiveItemsForMenuItem(ctx context.Context, menuItemID uint) (bool, error) {
	var count int64
	err := getDB(ctx, r.db).
		Model(&models.OrderItem{}).
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Where("order_items.menu_item_id = ? AND order_items.status != ? AND orders.status IN ?",
			menuItemID, models.ItemRejected, activeOrderStatuses()).
		Count(&count).Error
	return count > 0, err
}

type GormPoolRepo struct {
	db *gorm.DB
}

func NewPoolRepo(db *gorm.DB) PoolRepo {
	return &GormPoolRepo{db: db}
}

func (r *GormPoolRepo) FindAll(ctx context.Context) (map[uint]int, error) {
	var items []models.ItemPool
	if err := getDB(ctx, r.db).Find(&items).Error; err != nil {
		return nil, err
	}
	m := make(map[uint]int)
	for _, it := range items {
		m[it.MenuItemID] = it.Qty
	}
	return m, nil
}

// Lock ensures a pool row exists and holds it until the current transaction
// commits. A zero row is valid: cooked units are added only after menu items
// have been validated by the service layer.
func (r *GormPoolRepo) Lock(ctx context.Context, menuItemID uint) (int, error) {
	db := getDB(ctx, r.db)
	if err := db.Exec(`INSERT INTO item_pool (menu_item_id, qty) VALUES (?, 0) ON CONFLICT (menu_item_id) DO NOTHING`, menuItemID).Error; err != nil {
		return 0, err
	}
	var item models.ItemPool
	if err := db.Clauses(clause.Locking{Strength: "UPDATE"}).First(&item, "menu_item_id = ?", menuItemID).Error; err != nil {
		return 0, err
	}
	return item.Qty, nil
}

// Add adjusts the pool by qty (may be negative). UPDATE-then-INSERT rather
// than ON CONFLICT: Postgres validates CHECK (qty >= 0) on the proposed
// insert row before conflict resolution, so a negative delta via ON CONFLICT
// always fails even when the row exists.
func (r *GormPoolRepo) Add(ctx context.Context, menuItemID uint, qty int) error {
	db := getDB(ctx, r.db)
	res := db.Exec(`UPDATE item_pool SET qty = qty + ? WHERE menu_item_id = ?`, qty, menuItemID)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return db.Exec(`INSERT INTO item_pool (menu_item_id, qty) VALUES (?, ?)`, menuItemID, qty).Error
	}
	return nil
}

func (r *GormPoolRepo) ZeroAll(ctx context.Context) error {
	return getDB(ctx, r.db).Model(&models.ItemPool{}).Where("1 = 1").Update("qty", 0).Error
}

type GormEventRepo struct {
	db *gorm.DB
}

func NewEventRepo(db *gorm.DB) EventRepo {
	return &GormEventRepo{db: db}
}

func (r *GormEventRepo) Log(ctx context.Context, event *models.OrderEvent) error {
	return getDB(ctx, r.db).Create(event).Error
}
