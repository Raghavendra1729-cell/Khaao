package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"khaao/internal/config"
	"khaao/internal/middleware"
	"khaao/internal/services"
)

type PushController struct {
	cfg         *config.Config
	pushService *services.PushService
}

func NewPushController(cfg *config.Config, pushService *services.PushService) *PushController {
	return &PushController{
		cfg:         cfg,
		pushService: pushService,
	}
}

func (ctrl *PushController) GetVapidPublicKey(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"public_key": ctrl.cfg.VapidPublicKey})
}

type subscribeRequest struct {
	Endpoint string `json:"endpoint" binding:"required"`
	Keys     struct {
		P256dh string `json:"p256dh" binding:"required"`
		Auth   string `json:"auth" binding:"required"`
	} `json:"keys" binding:"required"`
}

func (ctrl *PushController) Subscribe(c *gin.Context) {
	var req subscribeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, services.ErrBadRequest(err.Error()))
		return
	}

	userID := middleware.UserID(c)
	if userID == 0 {
		respondError(c, services.ErrUnauthorized("missing user context"))
		return
	}

	if err := ctrl.pushService.Subscribe(c.Request.Context(), userID, req.Endpoint, req.Keys.P256dh, req.Keys.Auth); err != nil {
		respondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
