// Package controllers is the HTTP layer: request binding and response
// shaping only. All business logic lives in internal/services.
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

// AuthController handles signup/login/me.
type AuthController struct {
	auth *services.AuthService
}

// NewAuthController builds an AuthController.
func NewAuthController(auth *services.AuthService) *AuthController {
	return &AuthController{auth: auth}
}

type signupRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Signup handles POST /api/auth/signup.
func (ac *AuthController) Signup(c *gin.Context) {
	var req signupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	user, token, err := ac.auth.Signup(req.Name, req.Email, req.Password)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"token": token, "user": services.ToUserResponse(user)})
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Login handles POST /api/auth/login.
func (ac *AuthController) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	user, token, err := ac.auth.Login(req.Email, req.Password)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": token, "user": services.ToUserResponse(user)})
}

type googleLoginRequest struct {
	Credential string `json:"credential"`
}

// Google handles POST /api/auth/google: sign in with a Google ID token.
func (ac *AuthController) Google(c *gin.Context) {
	var req googleLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	user, token, err := ac.auth.GoogleLogin(c.Request.Context(), req.Credential)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": token, "user": services.ToUserResponse(user)})
}

type guestLoginRequest struct {
	Name string `json:"name"`
}

// Guest handles POST /api/auth/guest: book without an account.
func (ac *AuthController) Guest(c *gin.Context) {
	var req guestLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	user, token, err := ac.auth.GuestLogin(req.Name)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"token": token, "user": services.ToUserResponse(user)})
}

// Config handles GET /api/auth/config (public): which sign-in methods the
// login screen should offer.
func (ac *AuthController) Config(c *gin.Context) {
	c.JSON(http.StatusOK, ac.auth.AuthConfig())
}

// Me handles GET /api/auth/me.
func (ac *AuthController) Me(c *gin.Context) {
	user, err := ac.auth.GetUser(middleware.UserID(c))
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": services.ToUserResponse(user)})
}

// respondError maps a services.AppError to {"error": message} with its
// status; anything else is logged and reported as a generic 500.
func respondError(c *gin.Context, err error) {
	var appErr *services.AppError
	if errors.As(err, &appErr) {
		c.JSON(appErr.Status, gin.H{"error": appErr.Message})
		return
	}
	log.Printf("khaao: internal error: %v", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
}

// parseUintParam parses a numeric URL path param.
func parseUintParam(c *gin.Context, name string) (uint, error) {
	v, err := strconv.ParseUint(c.Param(name), 10, 64)
	if err != nil {
		return 0, err
	}
	return uint(v), nil
}
