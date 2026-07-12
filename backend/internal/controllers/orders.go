package controllers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"khaao/internal/middleware"
	"khaao/internal/realtime"
	"khaao/internal/services"
)

// OrderController handles the student-facing order endpoints and the
// student SSE stream.
type OrderController struct {
	engine *services.Engine
	hub    *realtime.Hub
}

// NewOrderController builds an OrderController.
func NewOrderController(engine *services.Engine, hub *realtime.Hub) *OrderController {
	return &OrderController{engine: engine, hub: hub}
}

type createOrderRequest struct {
	Items []services.OrderItemInput `json:"items"`
}

// Create handles POST /api/orders.
func (oc *OrderController) Create(c *gin.Context) {
	var req createOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	order, err := oc.engine.CreateOrder(middleware.UserID(c), req.Items)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"order": order})
}

// Active handles GET /api/orders/active.
func (oc *OrderController) Active(c *gin.Context) {
	order, err := oc.engine.ActiveOrder(middleware.UserID(c))
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

// History handles GET /api/orders.
func (oc *OrderController) History(c *gin.Context) {
	orders, err := oc.engine.OrderHistory(middleware.UserID(c))
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders})
}

type addItemRequest struct {
	MenuItemID uint `json:"menu_item_id"`
	Qty        int  `json:"qty"`
}

// AddItem handles POST /api/orders/:id/items.
func (oc *OrderController) AddItem(c *gin.Context) {
	orderID, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var req addItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	order, err := oc.engine.AddItem(orderID, middleware.UserID(c), req.MenuItemID, req.Qty)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

// Cancel handles POST /api/orders/:id/cancel — allowed only while the order
// is still awaiting the shopkeeper's decision.
func (oc *OrderController) Cancel(c *gin.Context) {
	orderID, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	order, err := oc.engine.Cancel(orderID, middleware.UserID(c))
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

// Stream handles GET /api/stream (student's own SSE events).
func (oc *OrderController) Stream(c *gin.Context) {
	streamSSE(c, oc.hub, middleware.UserID(c), "student")
}

// streamSSE is the shared SSE loop used by both the student and shop
// streams: registers a hub client, writes each queued message as an SSE
// "data:" frame, flushes immediately, sends a ": ping" heartbeat comment
// every 25s, and cleans up when the client disconnects.
func streamSSE(c *gin.Context, hub *realtime.Hub, userID uint, role string) {
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	flusher.Flush()

	client := hub.Register(userID, role)
	defer hub.Unregister(client)

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	ctx := c.Request.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-client.Messages():
			if !ok {
				return
			}
			if _, err := fmt.Fprintf(c.Writer, "data: %s\n\n", msg); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := fmt.Fprint(c.Writer, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
