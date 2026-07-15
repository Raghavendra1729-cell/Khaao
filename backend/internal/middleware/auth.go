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

// bearerToken reads the JWT from "Authorization: Bearer <t>". This is now
// the only way to present a JWT — the SSE endpoints, which used to accept
// "?token=<jwt>" in the query string because EventSource can't set custom
// headers, now authenticate via a short-lived single-use ticket instead (see
// RequireSSEAuth) so the long-lived JWT never has to appear in a URL.
// Previously a 7-day JWT sitting in the query string was visible in
// proxy/access logs and browser history for the token's whole lifetime
// (STATUS.md § P1-b). This is a clean cutover, not a temporary fallback:
// raw JWTs in the query string are no longer accepted anywhere.
func bearerToken(c *gin.Context) string {
	auth := c.GetHeader("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}

// RequireAuth validates the JWT and stashes user_id/role in the context.
// The role comes from a DB lookup, not the token claim, so allowlist or role
// changes take effect on the user's next request rather than at token expiry.
func RequireAuth(cfg *config.Config, authSvc *services.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c)
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

// RequireSSEAuth authenticates an SSE (EventSource) connection via a
// short-lived, single-use ticket passed as "?ticket=", minted moments
// earlier by an authenticated call to POST /api/auth/sse-ticket. EventSource
// cannot set an Authorization header, so this is the replacement for putting
// the real JWT in the query string (STATUS.md § P1-b). A ticket is opaque,
// expires after services.SSETicketTTL, and is consumed (deleted) on first
// use, so even if it ends up in a log line it's worthless moments later.
func RequireSSEAuth(authSvc *services.AuthService, tickets *services.SSETicketService) gin.HandlerFunc {
	return func(c *gin.Context) {
		ticket := c.Query("ticket")
		if ticket == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing ticket"})
			return
		}
		userID, ok := tickets.Consume(ticket)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired ticket"})
			return
		}
		user, err := authSvc.GetUser(c.Request.Context(), userID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unknown user"})
			return
		}
		c.Set(ContextUserID, userID)
		c.Set(ContextRole, string(user.Role))
		c.Next()
	}
}

// RequireRole aborts with 403 unless the authenticated user has the given
// role. Must run after RequireAuth or RequireSSEAuth.
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

// UserID reads the authenticated user id set by RequireAuth or
// RequireSSEAuth.
func UserID(c *gin.Context) uint {
	v, _ := c.Get(ContextUserID)
	id, _ := v.(uint)
	return id
}
