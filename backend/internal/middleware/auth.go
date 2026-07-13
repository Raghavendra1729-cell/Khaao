// Package middleware provides Gin middleware: JWT auth + role guard, CORS.
package middleware

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"khaao/internal/config"
	"khaao/internal/services"
)

const (
	ContextUserID = "user_id"
	ContextRole   = "role"
)

// extractToken reads the JWT from "Authorization: Bearer <t>" or the
// "?token=" query param (needed for EventSource, which can't set headers).
func extractToken(c *gin.Context) string {
	auth := c.GetHeader("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	if t := c.Query("token"); t != "" {
		return t
	}
	return ""
}

// RequireAuth validates the JWT and stashes user_id/role in the context.
// The role comes from a DB lookup, not the token claim, so allowlist or role
// changes take effect on the user's next request rather than at token expiry.
func RequireAuth(cfg *config.Config, authSvc *services.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing auth token"})
			return
		}
		claims, err := services.ParseToken(token, cfg.JWTSecret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			return
		}
		userID, err := strconv.ParseUint(claims.Subject, 10, 64)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token subject"})
			return
		}
		user, err := authSvc.GetUser(c.Request.Context(), uint(userID))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unknown user"})
			return
		}
		c.Set(ContextUserID, uint(userID))
		c.Set(ContextRole, string(user.Role))
		c.Next()
	}
}

// RequireRole aborts with 403 unless the authenticated user has the given
// role. Must run after RequireAuth.
func RequireRole(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		r, _ := c.Get(ContextRole)
		if r != role {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		c.Next()
	}
}

// UserID reads the authenticated user id set by RequireAuth.
func UserID(c *gin.Context) uint {
	v, _ := c.Get(ContextUserID)
	id, _ := v.(uint)
	return id
}
