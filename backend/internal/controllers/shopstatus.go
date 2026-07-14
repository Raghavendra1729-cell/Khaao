package controllers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"khaao/internal/services"
)

type ShopStatusController struct {
	svc *services.ShopStatusService
}

func NewShopStatusController(svc *services.ShopStatusService) *ShopStatusController {
	return &ShopStatusController{svc: svc}
}

// Get is the public GET /api/shop-status handler.
func (sc *ShopStatusController) Get(c *gin.Context) {
	status, err := sc.svc.Get(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, status)
}

type setShopStatusRequest struct {
	State    string     `json:"state"`
	ReopenAt *time.Time `json:"reopen_at"`
}

// Set is the shopkeeper POST /api/shop/status handler.
func (sc *ShopStatusController) Set(c *gin.Context) {
	var req setShopStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	status, err := sc.svc.Set(c.Request.Context(), req.State, req.ReopenAt)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, status)
}
