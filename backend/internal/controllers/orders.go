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

type OrderController struct {
	orderService *services.OrderService
	poolEngine   *services.PoolEngine
	hub          *realtime.Hub
}

func NewOrderController(os *services.OrderService, pe *services.PoolEngine, hub *realtime.Hub) *OrderController {
	return &OrderController{orderService: os, poolEngine: pe, hub: hub}
}

type createOrderRequest struct {
	Items []services.OrderItemInput `json:"items"`
}

func (oc *OrderController) Create(c *gin.Context) {
	var req createOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	order, err := oc.poolEngine.CreateOrder(c.Request.Context(), middleware.UserID(c), req.Items)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"order": order})
}

func (oc *OrderController) Active(c *gin.Context) {
	order, err := oc.orderService.ActiveOrder(c.Request.Context(), middleware.UserID(c))
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

func (oc *OrderController) History(c *gin.Context) {
	orders, err := oc.orderService.OrderHistory(c.Request.Context(), middleware.UserID(c))
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders})
}

func (oc *OrderController) Cancel(c *gin.Context) {
	orderID, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	order, err := oc.poolEngine.Cancel(c.Request.Context(), orderID, middleware.UserID(c))
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": order})
}

func (oc *OrderController) Stream(c *gin.Context) {
	streamSSE(c, oc.hub, middleware.UserID(c), "student")
}

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
