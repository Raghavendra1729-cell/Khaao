package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// contentSecurityPolicy mirrors the one set in deploy/Caddyfile for the
// static frontend bundle — see that file for why each source is listed
// (Firebase Google auth, Cloudinary direct upload). Setting it here too is
// defense in depth for API JSON responses (a CSP on a JSON response mostly
// matters if it's ever navigated to directly), matching how
// X-Content-Type-Options/Referrer-Policy are already layered in both
// places. THE CADDYFILE COPY IS THE ONE THAT ACTUALLY PROTECTS THE
// BROWSER-RENDERED APP — the frontend's HTML/JS is served by Caddy in
// production, not by this Go process. NOT YET LIVE-VERIFIED against a real
// Firebase Google sign-in + Cloudinary upload (this repo's dev setup can't
// drive that popup flow end-to-end) — test both before trusting this in
// production; a CSP violation here fails silently (login or photo upload
// just stops working, no obvious error).
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' blob: data: https://res.cloudinary.com https://*.googleusercontent.com; " +
	"connect-src 'self' https://api.cloudinary.com https://*.googleapis.com; " +
	"frame-src https://*.firebaseapp.com; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"form-action 'self'"

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
		h.Set("Content-Security-Policy", contentSecurityPolicy)
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
