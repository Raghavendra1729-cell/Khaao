package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Health handles GET /api/health — a simple liveness check. Returns 200 with
// {"ok": true}. A load balancer or k8s probe can hit this without a token.
func Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
