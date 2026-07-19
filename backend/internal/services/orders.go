package services

import (
	"context"
	"sort"
	"time"

	"khaao/internal/models"
	"khaao/internal/repository"
)

type OrderItemInput struct {
	MenuItemID uint `json:"menu_item_id"`
	Qty        int  `json:"qty"`
}

type OrderItemResponse struct {
	ID           uint   `json:"id"`
	MenuItemID   uint   `json:"menu_item_id"`
	Name         string `json:"name"`
	PhotoURL     string `json:"photo_url"`
	Qty          int    `json:"qty"`
	AllocatedQty int    `json:"allocated_qty"`
	HandedQty    int    `json:"handed_qty"`
	Status       string `json:"status"`
	PriceEach    int    `json:"price_each"`
}

type OrderResponse struct {
	ID           uint                `json:"id"`
	OrderNo      int                 `json:"order_no"`
	OrderDate    string              `json:"order_date"`
	Status       string              `json:"status"`
	TotalPrice   int                 `json:"total_price"`
	Paid         bool                `json:"paid"`
	CreatedAt    time.Time           `json:"created_at"`
	ReadyAt      *time.Time          `json:"ready_at"`
	ExpiresAt    *time.Time          `json:"expires_at"`
	StudentName  string              `json:"student_name,omitempty"`
	StudentEmail string              `json:"student_email,omitempty"`
	Items        []OrderItemResponse `json:"items"`
}

// normalizeDate trims a Postgres `date` column back down to "YYYY-MM-DD".
// database/sql scans a DATE column into a Go string via time.Time.Format,
// which yields an RFC3339 timestamp ("2026-07-13T00:00:00Z") rather than a
// bare date; the API contract (SPEC.md) promises "YYYY-MM-DD".
func normalizeDate(s string) string {
	if len(s) >= 10 {
		return s[:10]
	}
	return s
}

func ToOrderResponse(order models.Order, includeStudent bool) OrderResponse {
	sortedItems := append([]models.OrderItem(nil), order.Items...)
	sort.Slice(sortedItems, func(i, j int) bool { return sortedItems[i].ID < sortedItems[j].ID })

	items := make([]OrderItemResponse, 0, len(sortedItems))
	for _, it := range sortedItems {
		items = append(items, OrderItemResponse{
			ID:           it.ID,
			MenuItemID:   it.MenuItemID,
			Name:         it.Name,
			PhotoURL:     it.PhotoURL,
			Qty:          it.Qty,
			AllocatedQty: it.AllocatedQty,
			HandedQty:    it.HandedQty,
			Status:       string(it.Status),
			PriceEach:    it.PriceEach,
		})
	}

	resp := OrderResponse{
		ID:         order.ID,
		OrderNo:    order.OrderNo,
		OrderDate:  normalizeDate(order.OrderDate),
		Status:     string(order.Status),
		TotalPrice: order.TotalPrice,
		Paid:       order.Paid,
		CreatedAt:  order.CreatedAt,
		ReadyAt:    order.ReadyAt,
		ExpiresAt:  order.ExpiresAt,
		Items:      items,
	}
	if includeStudent {
		resp.StudentName = order.User.Name
		resp.StudentEmail = order.User.Email
	}
	return resp
}

type OrderService struct {
	orderRepo repository.OrderRepo
}

func NewOrderService(orderRepo repository.OrderRepo) *OrderService {
	return &OrderService{orderRepo: orderRepo}
}

func (s *OrderService) GetByID(ctx context.Context, id uint) (models.Order, error) {
	order, err := s.orderRepo.FindByID(ctx, id)
	if err != nil {
		return models.Order{}, err
	}
	if order == nil {
		return models.Order{}, ErrNotFound("order not found")
	}
	return *order, nil
}

func (s *OrderService) ActiveOrder(ctx context.Context, userID uint) (OrderResponse, error) {
	order, err := s.orderRepo.FindActiveByUserID(ctx, userID)
	if err != nil {
		return OrderResponse{}, err
	}
	if order == nil {
		return OrderResponse{}, ErrNotFound("no active order")
	}
	return ToOrderResponse(*order, false), nil
}

func (s *OrderService) OrderHistory(ctx context.Context, userID uint) ([]OrderResponse, error) {
	orders, err := s.orderRepo.FindHistoryByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]OrderResponse, 0, len(orders))
	for _, o := range orders {
		out = append(out, ToOrderResponse(o, false))
	}
	return out, nil
}

func (s *OrderService) ShopOrders(ctx context.Context) (incoming, active, awaitingPayment []OrderResponse, err error) {
	inc, err := s.orderRepo.FindIncoming(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	act, err := s.orderRepo.FindInProgress(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	ap, err := s.orderRepo.FindAwaitingPayment(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	
	incoming = make([]OrderResponse, 0, len(inc))
	for _, o := range inc {
		incoming = append(incoming, ToOrderResponse(o, true))
	}
	active = make([]OrderResponse, 0, len(act))
	for _, o := range act {
		active = append(active, ToOrderResponse(o, true))
	}
	awaitingPayment = make([]OrderResponse, 0, len(ap))
	for _, o := range ap {
		awaitingPayment = append(awaitingPayment, ToOrderResponse(o, true))
	}
	return incoming, active, awaitingPayment, nil
}

// HistoryItemCount is one row of the "items sold" breakdown.
type HistoryItemCount struct {
	Name string `json:"name"`
	Qty  int    `json:"qty"`
}

// HistoryCustomer is one row of the "who ordered" breakdown.
type HistoryCustomer struct {
	Name       string `json:"name"`
	OrderCount int    `json:"order_count"`
}

// HistoryInsights aggregates a day's completed orders for the shop's History
// panel. Computed over completed (paid) orders only, so it stays consistent
// with total_paid, which also counts only paid orders.
type HistoryInsights struct {
	OrderCount int                `json:"order_count"`
	ItemCounts []HistoryItemCount `json:"item_counts"`
	Customers  []HistoryCustomer  `json:"customers"`
}

// shopHistoryResponseLimit caps how many order rows ShopHistory returns for
// display. It only trims the response list, not the query itself — the
// insights below (totalPaid, item counts, customer counts) must still be
// computed over every order that day or they'd silently undercount on a
// busy day. FindTerminalByDate is already scoped to a single business day
// so this is a display cap, not a correctness fix like FindHistoryByUserID's
// LIMIT.
const shopHistoryResponseLimit = 200

func (s *OrderService) ShopHistory(ctx context.Context, date string) ([]OrderResponse, int, HistoryInsights, error) {
	orders, err := s.orderRepo.FindTerminalByDate(ctx, date)
	if err != nil {
		return nil, 0, HistoryInsights{}, err
	}

	out := make([]OrderResponse, 0, len(orders))
	totalPaid := 0
	itemQty := make(map[string]int)
	custOrders := make(map[string]int)
	insights := HistoryInsights{
		ItemCounts: []HistoryItemCount{},
		Customers:  []HistoryCustomer{},
	}
	for _, o := range orders {
		out = append(out, ToOrderResponse(o, true))
		if o.Paid {
			totalPaid += o.TotalPrice
		}
		if o.Status != models.OrderCompleted {
			continue
		}
		insights.OrderCount++
		name := o.User.Name
		if name == "" {
			name = o.User.Email
		}
		custOrders[name]++
		for _, it := range o.Items {
			if it.Status == models.ItemRejected {
				continue
			}
			itemQty[it.Name] += it.Qty
		}
	}

	for name, qty := range itemQty {
		insights.ItemCounts = append(insights.ItemCounts, HistoryItemCount{Name: name, Qty: qty})
	}
	sort.Slice(insights.ItemCounts, func(i, j int) bool {
		if insights.ItemCounts[i].Qty != insights.ItemCounts[j].Qty {
			return insights.ItemCounts[i].Qty > insights.ItemCounts[j].Qty
		}
		return insights.ItemCounts[i].Name < insights.ItemCounts[j].Name
	})

	for name, n := range custOrders {
		insights.Customers = append(insights.Customers, HistoryCustomer{Name: name, OrderCount: n})
	}
	sort.Slice(insights.Customers, func(i, j int) bool {
		if insights.Customers[i].OrderCount != insights.Customers[j].OrderCount {
			return insights.Customers[i].OrderCount > insights.Customers[j].OrderCount
		}
		return insights.Customers[i].Name < insights.Customers[j].Name
	})

	if len(out) > shopHistoryResponseLimit {
		out = out[:shopHistoryResponseLimit] // orders is already newest-first
	}
	return out, totalPaid, insights, nil
}
