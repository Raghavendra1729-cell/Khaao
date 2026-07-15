package controllers

import (
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"khaao/internal/middleware"
	"khaao/internal/services"
)

type AuthController struct {
	auth    *services.AuthService
	tickets *services.SSETicketService
}

func NewAuthController(auth *services.AuthService, tickets *services.SSETicketService) *AuthController {
	return &AuthController{auth: auth, tickets: tickets}
}

type firebaseLoginRequest struct {
	IDToken string `json:"id_token"`
}

func (ac *AuthController) Firebase(c *gin.Context) {
	var req firebaseLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	user, token, err := ac.auth.FirebaseLogin(c.Request.Context(), req.IDToken)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": token, "user": services.ToUserResponse(user)})
}

func (ac *AuthController) Config(c *gin.Context) {
	c.JSON(http.StatusOK, ac.auth.AuthConfig())
}

func (ac *AuthController) Me(c *gin.Context) {
	user, err := ac.auth.GetUser(c.Request.Context(), middleware.UserID(c))
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": services.ToUserResponse(user)})
}

// SSETicket mints a short-lived, single-use ticket the caller can use once,
// as "?ticket=" on an SSE (EventSource) endpoint, in place of ever putting
// the real JWT in a URL. See services.SSETicketService for why (STATUS.md §
// P1-b).
func (ac *AuthController) SSETicket(c *gin.Context) {
	ticket, err := ac.tickets.Mint(middleware.UserID(c))
	if err != nil {
		respondError(c, services.ErrInternal("failed to mint ticket"))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ticket":     ticket,
		"expires_in": int(services.SSETicketTTL.Seconds()),
	})
}

func respondError(c *gin.Context, err error) {
	var appErr *services.AppError
	if errors.As(err, &appErr) {
		c.JSON(appErr.Status, gin.H{"error": appErr.Message})
		return
	}
	log.Printf("khaao: internal error: %v", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
}

func parseUintParam(c *gin.Context, name string) (uint, error) {
	v, err := strconv.ParseUint(c.Param(name), 10, 64)
	if err != nil {
		return 0, err
	}
	return uint(v), nil
}
