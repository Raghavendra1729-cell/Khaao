package services

import (
	"context"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/repository"

	"gorm.io/datatypes"
)

var hhmmRe = regexp.MustCompile(`^([01]\d|2[0-3]):([0-5]\d)$`)

type MenuItemResponse struct {
	ID                 uint     `json:"id"`
	Name               string   `json:"name"`
	Price              int      `json:"price"`
	PhotoURL           string   `json:"photo_url"`
	Diet               string   `json:"diet"`
	Tags               []string `json:"tags"`
	IsAvailable        bool     `json:"is_available"`
	AvailFrom          *string  `json:"avail_from"`
	AvailTo            *string  `json:"avail_to"`
	AvailWindowWarning string   `json:"avail_window_warning,omitempty"`
	OutOfStock         bool     `json:"out_of_stock"`
	Status             string   `json:"status"`
	Orderable          bool     `json:"orderable"`
	OrderCountToday    int      `json:"order_count_today"`
	AvgRating          float64  `json:"avg_rating"`
	RatingCount        int      `json:"rating_count"`
}

func ToMenuItemResponse(item models.MenuItem, now time.Time, orderCountToday int, agg repository.MenuRatingAggregate) MenuItemResponse {
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
	// Never emit null for tags — an item with no tags is an empty array.
	tags := []string(item.Tags)
	if tags == nil {
		tags = []string{}
	}
	diet := item.Diet
	if diet == "" {
		diet = "veg"
	}
	return MenuItemResponse{
		ID:              item.ID,
		Name:            item.Name,
		Price:           item.Price,
		PhotoURL:        item.PhotoURL,
		Diet:            diet,
		Tags:            tags,
		IsAvailable:     item.IsAvailable,
		AvailFrom:       item.AvailFrom,
		AvailTo:         item.AvailTo,
		OutOfStock:      item.OutOfStock,
		Status:          status,
		Orderable:       orderable,
		OrderCountToday: orderCountToday,
		AvgRating:       math.Round(agg.AvgRating*10) / 10,
		RatingCount:     agg.RatingCount,
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

// availWindowWarning returns a non-blocking hint when from/to look like a
// same-day window typed backwards. It cannot distinguish that from a
// genuine overnight window (e.g. 22:00-06:00, which is valid and already
// handled correctly by withinWindow) — it only flags the ambiguous case
// so a shopkeeper can double check, never blocks the save.
func availWindowWarning(from, to *string) string {
	if from == nil || to == nil {
		return ""
	}
	if *from >= *to {
		return "avail_from is not before avail_to — if this isn't an overnight window (e.g. 22:00-06:00), check for a typo"
	}
	return ""
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
	Name        string   `json:"name"`
	Price       int      `json:"price"`
	PhotoURL    string   `json:"photo_url"`
	Diet        string   `json:"diet"`
	Tags        []string `json:"tags"`
	AvailFrom   *string  `json:"avail_from"`
	AvailTo     *string  `json:"avail_to"`
	IsAvailable *bool    `json:"is_available"`
}

type MenuService struct {
	repo       repository.MenuRepo
	orderRepo  repository.OrderRepo
	ratingRepo repository.RatingRepo
	hub        *realtime.Hub
	cfg        *config.Config
}

func NewMenuService(repo repository.MenuRepo, orderRepo repository.OrderRepo, ratingRepo repository.RatingRepo, hub *realtime.Hub, cfg *config.Config) *MenuService {
	return &MenuService{repo: repo, orderRepo: orderRepo, ratingRepo: ratingRepo, hub: hub, cfg: cfg}
}

// now returns the current time in the configured business timezone, so
// availability windows are evaluated in the canteen's local time regardless of
// where the server runs.
func (s *MenuService) now() time.Time {
	return time.Now().In(s.cfg.Location())
}

func (s *MenuService) ListAvailable(ctx context.Context) ([]MenuItemResponse, error) {
	items, err := s.repo.FindAll(ctx, true)
	if err != nil {
		return nil, err
	}
	counts, err := s.orderCountsToday(ctx)
	if err != nil {
		return nil, err
	}
	aggs, err := s.ratingRepo.GetMenuAggregates(ctx)
	if err != nil {
		return nil, err
	}
	return toMenuResponses(items, s.now(), counts, aggs), nil
}

func (s *MenuService) ListAll(ctx context.Context) ([]MenuItemResponse, error) {
	items, err := s.repo.FindAll(ctx, false)
	if err != nil {
		return nil, err
	}
	counts, err := s.orderCountsToday(ctx)
	if err != nil {
		return nil, err
	}
	aggs, err := s.ratingRepo.GetMenuAggregates(ctx)
	if err != nil {
		return nil, err
	}
	return toMenuResponses(items, s.now(), counts, aggs), nil
}

// orderCountsToday returns per-menu-item ordered qty for the current business
// day, used to populate each item's order_count_today (trending).
func (s *MenuService) orderCountsToday(ctx context.Context) (map[uint]int, error) {
	today := models.DayOf(s.now())
	return s.orderRepo.SumOrderedQtyByDate(ctx, today)
}

func toMenuResponses(items []models.MenuItem, now time.Time, counts map[uint]int, aggs map[uint]repository.MenuRatingAggregate) []MenuItemResponse {
	out := make([]MenuItemResponse, 0, len(items))
	for _, it := range items {
		out = append(out, ToMenuItemResponse(it, now, counts[it.ID], aggs[it.ID]))
	}
	return out
}

func (s *MenuService) validateAndNormalize(input *MenuItemInput) error {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return ErrBadRequest("name is required")
	}
	if len(input.Name) > 100 {
		return ErrBadRequest("name must be 100 characters or fewer")
	}
	if input.Price <= 0 {
		return ErrBadRequest("price must be greater than 0")
	}
	input.Diet = strings.TrimSpace(input.Diet)
	if input.Diet == "" {
		return ErrBadRequest("diet is required")
	}
	if input.Diet != "veg" && input.Diet != "non_veg" {
		return ErrBadRequest("diet must be 'veg' or 'non_veg'")
	}
	input.Tags = normalizeTags(input.Tags)
	if input.PhotoURL != "" && !strings.HasPrefix(input.PhotoURL, "https://") && !strings.HasPrefix(input.PhotoURL, "http://") {
		return ErrBadRequest("photo_url must be an http:// or https:// URL")
	}
	input.AvailFrom = normalizeTimeStr(input.AvailFrom)
	input.AvailTo = normalizeTimeStr(input.AvailTo)
	if input.AvailFrom != nil && !hhmmRe.MatchString(*input.AvailFrom) {
		return ErrBadRequest("avail_from must be HH:MM")
	}
	if input.AvailTo != nil && !hhmmRe.MatchString(*input.AvailTo) {
		return ErrBadRequest("avail_to must be HH:MM")
	}
	// Require both or neither — a half-set window is always a mistake.
	if (input.AvailFrom == nil) != (input.AvailTo == nil) {
		return ErrBadRequest("set both avail_from and avail_to, or leave both empty")
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

// normalizeTags trims each tag, drops blanks, and de-dupes case-insensitively
// (first occurrence wins for casing). The result is always non-nil so it is
// stored — and later serialized — as [] rather than null.
func normalizeTags(tags []string) []string {
	out := make([]string, 0, len(tags))
	seen := make(map[string]struct{}, len(tags))
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if len(t) > 40 {
			t = t[:40]
		}
		key := strings.ToLower(t)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, t)
	}
	return out
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
		Diet:        input.Diet,
		Tags:        datatypes.NewJSONSlice(input.Tags),
		AvailFrom:   input.AvailFrom,
		AvailTo:     input.AvailTo,
		IsAvailable: isAvailable,
	}
	if err := s.repo.Save(ctx, &item); err != nil {
		return MenuItemResponse{}, err
	}
	s.hub.NotifyMenuUpdate()
	// A brand-new item has no orders today and no ratings.
	resp := ToMenuItemResponse(item, s.now(), 0, repository.MenuRatingAggregate{})
	resp.AvailWindowWarning = availWindowWarning(item.AvailFrom, item.AvailTo)
	return resp, nil
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
	item.Diet = input.Diet
	item.Tags = datatypes.NewJSONSlice(input.Tags)
	item.AvailFrom = input.AvailFrom
	item.AvailTo = input.AvailTo
	if input.IsAvailable != nil {
		item.IsAvailable = *input.IsAvailable
	}
	if err := s.repo.Save(ctx, item); err != nil {
		return MenuItemResponse{}, err
	}
	s.hub.NotifyMenuUpdate()
	counts, err := s.orderCountsToday(ctx)
	if err != nil {
		return MenuItemResponse{}, err
	}
	aggs, err := s.ratingRepo.GetMenuAggregates(ctx)
	if err != nil {
		return MenuItemResponse{}, err
	}
	resp := ToMenuItemResponse(*item, s.now(), counts[item.ID], aggs[item.ID])
	resp.AvailWindowWarning = availWindowWarning(item.AvailFrom, item.AvailTo)
	return resp, nil
}

func (s *MenuService) Delete(ctx context.Context, id uint) error {
	// Block the delete if any in-flight order still references this item.
	// This prevents orphaned order_items with a dangling menu_item_id.
	active, err := s.orderRepo.HasActiveItemsForMenuItem(ctx, id)
	if err != nil {
		return err
	}
	if active {
		return ErrConflict("cannot delete a menu item that is part of an active order")
	}
	if err := s.repo.Delete(ctx, id); err != nil {
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
	counts, err := s.orderCountsToday(ctx)
	if err != nil {
		return MenuItemResponse{}, err
	}
	aggs, err := s.ratingRepo.GetMenuAggregates(ctx)
	if err != nil {
		return MenuItemResponse{}, err
	}
	return ToMenuItemResponse(*item, s.now(), counts[item.ID], aggs[item.ID]), nil
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
