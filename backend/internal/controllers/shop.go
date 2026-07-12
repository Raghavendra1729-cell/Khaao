package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"khaao/internal/middleware"
	"khaao/internal/realtime"
	"khaao/internal/services"
)

// ShopController handles the shopkeeper dashboard endpoints: incoming/
// active/ready orders, accept/reject, prep list, done, close order, close
// day, and the shop SSE stream.
type ShopController struct {
	engine *services.Engine
	hub    *realtime.Hub
}

// NewShopController builds a ShopController.
func NewShopController(engine *services.Engine, hub *realtime.Hub) *ShopController {
	return &ShopController{engine: engine, hub: hub}
}

// Orders handles GET /api/shop/orders.
func (sc *ShopController) Orders(c *gin.Context) {
	incoming, active, ready, err := sc.engine.ShopOrders()
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"incoming": incoming, "active": active, "ready": ready})
}

type acceptRequest struct {
	RejectedItemIDs []uint `json:"rejected_item_ids"`
}

// Accept handles POST /api/shop/orders/:id/accept.
func (sc *ShopController) Accept(c *gin.Context) {
	orderID, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var req acceptRequest
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
	}
	order, err := sc.engine.Accept(orderID, req.RejectedItemIDs)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

// Reject handles POST /api/shop/orders/:id/reject.
func (sc *ShopController) Reject(c *gin.Context) {
	orderID, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	order, err := sc.engine.Reject(orderID)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

// Prep handles GET /api/shop/prep.
func (sc *ShopController) Prep(c *gin.Context) {
	items, err := sc.engine.PrepList()
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

type doneRequest struct {
	Qty int `json:"qty"`
}

// Done handles POST /api/shop/prep/:menu_item_id/done.
func (sc *ShopController) Done(c *gin.Context) {
	menuItemID, err := parseUintParam(c, "menu_item_id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid menu item id"})
		return
	}
	req := doneRequest{Qty: 1}
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
	}
	if err := sc.engine.MarkDone(menuItemID, req.Qty); err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Close handles POST /api/shop/orders/:id/close.
func (sc *ShopController) Close(c *gin.Context) {
	orderID, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	order, err := sc.engine.CloseOrder(orderID)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

// History handles GET /api/shop/history: today's finished orders plus the
// paid total, for counter reconciliation.
func (sc *ShopController) History(c *gin.Context) {
	orders, totalPaid, err := sc.engine.ShopHistory()
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders, "total_paid": totalPaid})
}

// CloseDay handles POST /api/shop/day/close.
func (sc *ShopController) CloseDay(c *gin.Context) {
	if err := sc.engine.CloseDay(); err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Stream handles GET /api/shop/stream (shop dashboard SSE events).
func (sc *ShopController) Stream(c *gin.Context) {
	streamSSE(c, sc.hub, middleware.UserID(c), "shopkeeper")
}
