package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"khaao/internal/config"
)

// CORS allows the configured FRONTEND_ORIGIN, including the Authorization
// header (needed since the SPA sends bearer tokens).
func CORS(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", cfg.FrontendOrigin)
		c.Header("Vary", "Origin")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Header("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
