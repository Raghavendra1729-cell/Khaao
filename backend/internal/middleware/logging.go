package middleware

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
)

// RequestLogger logs one structured line per request: method, path, status,
// latency, and the authenticated user id if RequireAuth/RequireSSEAuth ran
// before this point in the chain and set one. Runs right after
// gin.Recovery() so a panic is still logged (Recovery turns it into a 500
// before this handler's post-c.Next() logging fires).
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		status := c.Writer.Status()
		attrs := []any{
			"method", c.Request.Method,
			"path", c.FullPath(),
			"status", status,
			"latency_ms", time.Since(start).Milliseconds(),
		}
		if uid, ok := c.Get(ContextUserID); ok {
			attrs = append(attrs, "user_id", uid)
		}

		switch {
		case status >= 500:
			slog.Error("request", attrs...)
		case status == 409 || status == 401 || status == 403:
			// Conflicts and auth failures are worth a Warn even though
			// they're expected traffic, not bugs — this is where STATUS.md's
			// P2-a "alert on auth failures / tx conflicts / order-state
			// transition failures" surfaces for free, since every mutation's
			// outcome ends up in this one place.
			slog.Warn("request", attrs...)
		default:
			slog.Info("request", attrs...)
		}
	}
}
