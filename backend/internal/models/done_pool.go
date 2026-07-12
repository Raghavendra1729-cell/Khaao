package models

// DonePool tracks finished-but-unallocated units per menu item, waiting to
// be FIFO-allocated to queued order items.
type DonePool struct {
	MenuItemID   uint `gorm:"primaryKey;autoIncrement:false" json:"menu_item_id"`
	QtyAvailable int  `gorm:"not null;default:0" json:"qty_available"`
}
