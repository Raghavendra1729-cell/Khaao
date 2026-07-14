package controllers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"khaao/internal/config"
	"khaao/internal/middleware"
	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/services"
)

type ShopController struct {
	orderService *services.OrderService
	poolEngine   *services.PoolEngine
	hub          *realtime.Hub
	cfg          *config.Config
}

func NewShopController(os *services.OrderService, pe *services.PoolEngine, hub *realtime.Hub, cfg *config.Config) *ShopController {
	return &ShopController{orderService: os, poolEngine: pe, hub: hub, cfg: cfg}
}

func (sc *ShopController) Orders(c *gin.Context) {
	incoming, active, awaiting, err := sc.orderService.ShopOrders(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"incoming": incoming, "in_progress": active, "awaiting_payment": awaiting})
}

type acceptRequest struct {
	RejectedItemIDs []uint `json:"rejected_item_ids"`
}

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
	order, err := sc.poolEngine.Accept(c.Request.Context(), orderID, req.RejectedItemIDs)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

func (sc *ShopController) Reject(c *gin.Context) {
	orderID, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	order, err := sc.poolEngine.Reject(c.Request.Context(), orderID)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

func (sc *ShopController) Prep(c *gin.Context) {
	items, err := sc.poolEngine.PrepList(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

type doneRequest struct {
	Qty int `json:"qty"`
}

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
	if err := sc.poolEngine.MarkDone(c.Request.Context(), menuItemID, req.Qty); err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type handoverRequest struct {
	Qty int `json:"qty"`
}

func (sc *ShopController) Handover(c *gin.Context) {
	orderID, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	itemID, err := parseUintParam(c, "itemID")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item id"})
		return
	}
	req := handoverRequest{Qty: 1}
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
	}
	order, err := sc.poolEngine.Handover(c.Request.Context(), orderID, itemID, req.Qty)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

func (sc *ShopController) RemoveItem(c *gin.Context) {
	orderID, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	itemID, err := parseUintParam(c, "itemID")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item id"})
		return
	}
	order, err := sc.poolEngine.RemoveItem(c.Request.Context(), orderID, itemID)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

func (sc *ShopController) Paid(c *gin.Context) {
	orderID, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	order, err := sc.poolEngine.Paid(c.Request.Context(), orderID)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

func (sc *ShopController) History(c *gin.Context) {
	date := c.Query("date")
	if date == "" {
		date = models.DayOf(time.Now().In(sc.cfg.Location()))
	} else if _, err := time.Parse("2006-01-02", date); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "date must be YYYY-MM-DD"})
		return
	}
	orders, totalPaid, insights, err := sc.orderService.ShopHistory(c.Request.Context(), date)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders, "total_paid": totalPaid, "insights": insights})
}

func (sc *ShopController) Stream(c *gin.Context) {
	streamSSE(c, sc.hub, middleware.UserID(c), "shopkeeper")
}
