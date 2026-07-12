package services

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"khaao/internal/models"
	"khaao/internal/realtime"
)

var hhmmRe = regexp.MustCompile(`^([01]\d|2[0-3]):([0-5]\d)$`)

// MenuItemResponse is the JSON shape of a menu item, including the computed
// status/orderable fields required by SPEC.md.
type MenuItemResponse struct {
	ID          uint    `json:"id"`
	Name        string  `json:"name"`
	Price       int     `json:"price"`
	PhotoURL    string  `json:"photo_url"`
	IsAvailable bool    `json:"is_available"`
	AvailFrom   *string `json:"avail_from"`
	AvailTo     *string `json:"avail_to"`
	OutOfStock  bool    `json:"out_of_stock"`
	Status      string  `json:"status"`
	Orderable   bool    `json:"orderable"`
}

// ToMenuItemResponse computes status/orderable for a menu item as of now.
func ToMenuItemResponse(item models.MenuItem) MenuItemResponse {
	now := time.Now()
	status := "available"
	switch {
	case item.OutOfStock:
		status = "out_of_stock"
	case !item.IsAvailable:
		status = "unavailable"
	case item.AvailFrom != nil || item.AvailTo != nil:
		status = "time_limited"
	}
	orderable := item.IsAvailable && !item.OutOfStock && withinWindow(item.AvailFrom, item.AvailTo, now)
	return MenuItemResponse{
		ID:          item.ID,
		Name:        item.Name,
		Price:       item.Price,
		PhotoURL:    item.PhotoURL,
		IsAvailable: item.IsAvailable,
		AvailFrom:   item.AvailFrom,
		AvailTo:     item.AvailTo,
		OutOfStock:  item.OutOfStock,
		Status:      status,
		Orderable:   orderable,
	}
}

func withinWindow(from, to *string, now time.Time) bool {
	if from == nil && to == nil {
		return true
	}
	nowMin := now.Hour()*60 + now.Minute()
	fromMin := 0
	if from != nil {
		fromMin = hhmmToMinutes(*from)
	}
	toMin := 23*60 + 59
	if to != nil {
		toMin = hhmmToMinutes(*to)
	}
	if fromMin <= toMin {
		return nowMin >= fromMin && nowMin <= toMin
	}
	// overnight window, e.g. 22:00-02:00
	return nowMin >= fromMin || nowMin <= toMin
}

// hhmmToMinutes parses an already-validated "HH:MM" string into minutes
// since midnight.
func hhmmToMinutes(s string) int {
	parts := strings.SplitN(s, ":", 2)
	if len(parts) != 2 {
		return 0
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0
	}
	return h*60 + m
}

// MenuItemInput is the request body for create/update menu item endpoints.
type MenuItemInput struct {
	Name        string  `json:"name"`
	Price       int     `json:"price"`
	PhotoURL    string  `json:"photo_url"`
	AvailFrom   *string `json:"avail_from"`
	AvailTo     *string `json:"avail_to"`
	IsAvailable *bool   `json:"is_available"`
}

// MenuService handles menu CRUD and availability queries.
type MenuService struct {
	db  *gorm.DB
	hub *realtime.Hub
}

// NewMenuService builds a MenuService.
func NewMenuService(db *gorm.DB, hub *realtime.Hub) *MenuService {
	return &MenuService{db: db, hub: hub}
}

// ListAvailable returns only is_available items (students see out-of-stock
// ones too, marked accordingly, but not ones the shop has hidden entirely).
func (s *MenuService) ListAvailable() ([]MenuItemResponse, error) {
	var items []models.MenuItem
	if err := s.db.Where("is_available = ?", true).Order("id asc").Find(&items).Error; err != nil {
		return nil, err
	}
	return toMenuResponses(items), nil
}

// ListAll returns every menu item, including unavailable ones (shop view).
func (s *MenuService) ListAll() ([]MenuItemResponse, error) {
	var items []models.MenuItem
	if err := s.db.Order("id asc").Find(&items).Error; err != nil {
		return nil, err
	}
	return toMenuResponses(items), nil
}

func toMenuResponses(items []models.MenuItem) []MenuItemResponse {
	out := make([]MenuItemResponse, 0, len(items))
	for _, it := range items {
		out = append(out, ToMenuItemResponse(it))
	}
	return out
}

func (s *MenuService) validateAndNormalize(input *MenuItemInput) error {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return ErrBadRequest("name is required")
	}
	if input.Price < 0 {
		return ErrBadRequest("price must be >= 0")
	}
	input.AvailFrom = normalizeTimeStr(input.AvailFrom)
	input.AvailTo = normalizeTimeStr(input.AvailTo)
	if input.AvailFrom != nil && !hhmmRe.MatchString(*input.AvailFrom) {
		return ErrBadRequest("avail_from must be HH:MM")
	}
	if input.AvailTo != nil && !hhmmRe.MatchString(*input.AvailTo) {
		return ErrBadRequest("avail_to must be HH:MM")
	}
	return nil
}

func normalizeTimeStr(s *string) *string {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// Create adds a new menu item.
func (s *MenuService) Create(input MenuItemInput) (MenuItemResponse, error) {
	if err := s.validateAndNormalize(&input); err != nil {
		return MenuItemResponse{}, err
	}
	isAvailable := true
	if input.IsAvailable != nil {
		isAvailable = *input.IsAvailable
	}
	item := models.MenuItem{
		Name:        input.Name,
		Price:       input.Price,
		PhotoURL:    input.PhotoURL,
		AvailFrom:   input.AvailFrom,
		AvailTo:     input.AvailTo,
		IsAvailable: isAvailable,
	}
	if err := s.db.Create(&item).Error; err != nil {
		return MenuItemResponse{}, err
	}
	s.hub.NotifyMenuUpdate()
	return ToMenuItemResponse(item), nil
}

// Update overwrites a menu item's fields.
func (s *MenuService) Update(id uint, input MenuItemInput) (MenuItemResponse, error) {
	var item models.MenuItem
	if err := s.db.First(&item, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return MenuItemResponse{}, ErrNotFound("menu item not found")
		}
		return MenuItemResponse{}, err
	}
	if err := s.validateAndNormalize(&input); err != nil {
		return MenuItemResponse{}, err
	}
	item.Name = input.Name
	item.Price = input.Price
	item.PhotoURL = input.PhotoURL
	item.AvailFrom = input.AvailFrom
	item.AvailTo = input.AvailTo
	if input.IsAvailable != nil {
		item.IsAvailable = *input.IsAvailable
	}
	if err := s.db.Save(&item).Error; err != nil {
		return MenuItemResponse{}, err
	}
	s.hub.NotifyMenuUpdate()
	return ToMenuItemResponse(item), nil
}

// Delete soft-deletes a menu item.
func (s *MenuService) Delete(id uint) error {
	res := s.db.Delete(&models.MenuItem{}, id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound("menu item not found")
	}
	s.hub.NotifyMenuUpdate()
	return nil
}

// SetStock toggles out_of_stock for a menu item.
func (s *MenuService) SetStock(id uint, outOfStock bool) (MenuItemResponse, error) {
	var item models.MenuItem
	if err := s.db.First(&item, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return MenuItemResponse{}, ErrNotFound("menu item not found")
		}
		return MenuItemResponse{}, err
	}
	item.OutOfStock = outOfStock
	if err := s.db.Save(&item).Error; err != nil {
		return MenuItemResponse{}, err
	}
	s.hub.NotifyMenuUpdate()
	return ToMenuItemResponse(item), nil
}

// GetByID loads a single menu item by id (used by the order/pool engine).
func (s *MenuService) GetByID(id uint) (models.MenuItem, error) {
	var item models.MenuItem
	if err := s.db.First(&item, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return models.MenuItem{}, ErrNotFound("menu item not found")
		}
		return models.MenuItem{}, err
	}
	return item, nil
}
