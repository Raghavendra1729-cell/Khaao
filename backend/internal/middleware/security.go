package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// SecurityHeaders sets conservative security response headers suitable for an
// API backend behind a TLS-terminating proxy. HSTS is intentionally left to
// the proxy (it owns the TLS/HTTPS decision).
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		c.Next()
	}
}

// MaxBodyBytes caps request-body size to guard against memory-abuse. GET and
// SSE requests carry no body, so the cap is harmless for them; oversized bodies
// yield a 413 when the handler reads past the limit.
func MaxBodyBytes(max int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, max)
		c.Next()
	}
}
