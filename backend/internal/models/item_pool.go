package models

type ItemPool struct {
	MenuItemID uint `gorm:"primaryKey;autoIncrement:false" json:"menu_item_id"`
	Qty        int  `gorm:"not null;default:0;check:qty >= 0" json:"qty"`
}

func (ItemPool) TableName() string {
	return "item_pool"
}
