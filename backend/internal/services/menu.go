package services

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"time"

	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/repository"
)

var hhmmRe = regexp.MustCompile(`^([01]\d|2[0-3]):([0-5]\d)$`)

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
	return nowMin >= fromMin || nowMin <= toMin
}

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

type MenuItemInput struct {
	Name        string  `json:"name"`
	Price       int     `json:"price"`
	PhotoURL    string  `json:"photo_url"`
	AvailFrom   *string `json:"avail_from"`
	AvailTo     *string `json:"avail_to"`
	IsAvailable *bool   `json:"is_available"`
}

type MenuService struct {
	repo repository.MenuRepo
	hub  *realtime.Hub
}

func NewMenuService(repo repository.MenuRepo, hub *realtime.Hub) *MenuService {
	return &MenuService{repo: repo, hub: hub}
}

func (s *MenuService) ListAvailable(ctx context.Context) ([]MenuItemResponse, error) {
	items, err := s.repo.FindAll(ctx, true)
	if err != nil {
		return nil, err
	}
	return toMenuResponses(items), nil
}

func (s *MenuService) ListAll(ctx context.Context) ([]MenuItemResponse, error) {
	items, err := s.repo.FindAll(ctx, false)
	if err != nil {
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

func (s *MenuService) Create(ctx context.Context, input MenuItemInput) (MenuItemResponse, error) {
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
	if err := s.repo.Save(ctx, &item); err != nil {
		return MenuItemResponse{}, err
	}
	s.hub.NotifyMenuUpdate()
	return ToMenuItemResponse(item), nil
}

func (s *MenuService) Update(ctx context.Context, id uint, input MenuItemInput) (MenuItemResponse, error) {
	item, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return MenuItemResponse{}, err
	}
	if item == nil {
		return MenuItemResponse{}, ErrNotFound("menu item not found")
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
	if err := s.repo.Save(ctx, item); err != nil {
		return MenuItemResponse{}, err
	}
	s.hub.NotifyMenuUpdate()
	return ToMenuItemResponse(*item), nil
}

func (s *MenuService) Delete(ctx context.Context, id uint) error {
	err := s.repo.Delete(ctx, id)
	if err != nil {
		return err
	}
	s.hub.NotifyMenuUpdate()
	return nil
}

func (s *MenuService) SetStock(ctx context.Context, id uint, outOfStock bool) (MenuItemResponse, error) {
	item, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return MenuItemResponse{}, err
	}
	if item == nil {
		return MenuItemResponse{}, ErrNotFound("menu item not found")
	}
	if err := s.repo.UpdateStock(ctx, id, outOfStock); err != nil {
		return MenuItemResponse{}, err
	}
	item.OutOfStock = outOfStock
	s.hub.NotifyMenuUpdate()
	return ToMenuItemResponse(*item), nil
}

func (s *MenuService) GetByID(ctx context.Context, id uint) (models.MenuItem, error) {
	item, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return models.MenuItem{}, err
	}
	if item == nil {
		return models.MenuItem{}, ErrNotFound("menu item not found")
	}
	return *item, nil
}
