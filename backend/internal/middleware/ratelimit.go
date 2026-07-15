// This file: per-user rate limiting for mutation endpoints, and a per-user
// cap on concurrent SSE connections.
//
// Both are keyed by authenticated user id, NOT client IP: this is a single
// college campus behind NAT, so hundreds of students can share one public
// IP — an IP-keyed limiter would either throttle an entire hostel building
// over one heavy user, or (if set loosely enough to avoid that) do nothing
// useful at all (STATUS.md § P1-c). Both are plain in-memory maps —
// appropriate for this project's deliberate single-instance topology
// (STATUS.md § Topology decision); do not reach for Redis here.
package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ---- Per-user mutation rate limiting (token bucket) -----------------------

// Limits below are deliberately generous — this is abuse/flood protection,
// not throttling of normal use:
//
//   - Student: 60 req/min sustained (1 token/sec refill), burst of 20. A
//     student's mutations are cart/order/cancel/rate actions — normal use is
//     a handful per minute; the burst absorbs rapid double-taps and rating
//     several items back-to-back right after a meal.
//   - Shopkeeper: 240 req/min sustained (4 tokens/sec refill), burst of 40.
//     During a lunch rush a single shopkeeper can legitimately fire many
//     mutations in quick succession — accepting/rejecting a stream of
//     incoming orders, marking many prep items done, handing items over one
//     by one, marking orders paid. 4x the student rate covers that without
//     leaving the door open to a runaway/scripted client.
const (
	studentBucketCapacity     = 20
	studentRefillPerSecond    = 1.0
	shopkeeperBucketCapacity  = 40
	shopkeeperRefillPerSecond = 4.0
)

type tokenBucket struct {
	tokens     float64
	lastRefill time.Time
}

// RateLimiter is a per-user-id token bucket limiter with separate,
// role-dependent capacity/refill settings. Safe for concurrent use.
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[uint]*tokenBucket
}

// NewRateLimiter creates an empty limiter. Bucket count is bounded by the
// number of distinct authenticated users who've made a mutation request —
// this college's whole student body is ~2000, a trivial amount of memory —
// so buckets are never evicted.
func NewRateLimiter() *RateLimiter {
	return &RateLimiter{buckets: make(map[uint]*tokenBucket)}
}

func limitsForRole(role string) (capacity, refillPerSecond float64) {
	if role == "shopkeeper" {
		return shopkeeperBucketCapacity, shopkeeperRefillPerSecond
	}
	return studentBucketCapacity, studentRefillPerSecond
}

// Allow reports whether userID may proceed right now, consuming one token if
// so. role selects which bucket size/refill rate applies.
func (rl *RateLimiter) Allow(userID uint, role string) bool {
	capacity, refillPerSecond := limitsForRole(role)

	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, ok := rl.buckets[userID]
	if !ok {
		b = &tokenBucket{tokens: capacity, lastRefill: now}
		rl.buckets[userID] = b
	}
	elapsed := now.Sub(b.lastRefill).Seconds()
	b.tokens = min(capacity, b.tokens+elapsed*refillPerSecond)
	b.lastRefill = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// RateLimitByUser rate-limits non-GET requests per authenticated user id.
// Plain GETs are exempt (this targets mutations, not browsing) and so are
// the SSE streams, which never route through this middleware at all — they
// authenticate via RequireSSEAuth on their own standalone route and are
// capped separately by LimitConcurrentSSE. Must run after RequireAuth.
func RateLimitByUser(limiter *RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodGet {
			c.Next()
			return
		}
		role, _ := c.Get(ContextRole)
		roleStr, _ := role.(string)
		if !limiter.Allow(UserID(c), roleStr) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "too many requests — please slow down and try again in a moment",
			})
			return
		}
		c.Next()
	}
}

// ---- Per-user concurrent SSE connection cap -------------------------------

// maxSSEConnectionsPerUser bounds how many simultaneous EventSource streams
// one user id may hold open at once. A legitimate user should need at most a
// couple of tabs/devices open simultaneously; capping at 3 stops one runaway
// client (a buggy tab loop, a scripted abuser) from holding enough
// long-lived connections to exhaust server file descriptors — each SSE
// connection costs exactly one fd (STATUS.md § Topology decision).
const maxSSEConnectionsPerUser = 3

// SSEConnectionLimiter tracks how many concurrent SSE connections each user
// id currently holds open. Safe for concurrent use.
type SSEConnectionLimiter struct {
	mu     sync.Mutex
	counts map[uint]int
}

// NewSSEConnectionLimiter creates an empty limiter.
func NewSSEConnectionLimiter() *SSEConnectionLimiter {
	return &SSEConnectionLimiter{counts: make(map[uint]int)}
}

func (l *SSEConnectionLimiter) acquire(userID uint) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.counts[userID] >= maxSSEConnectionsPerUser {
		return false
	}
	l.counts[userID]++
	return true
}

func (l *SSEConnectionLimiter) release(userID uint) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.counts[userID]--
	if l.counts[userID] <= 0 {
		delete(l.counts, userID)
	}
}

// LimitConcurrentSSE aborts with 429 if userID already holds
// maxSSEConnectionsPerUser open connections; otherwise it lets the
// (long-lived) stream handler run via c.Next() and releases the slot once
// that handler returns — i.e. once the connection actually closes. Must run
// after RequireSSEAuth (needs the user id already in context).
func LimitConcurrentSSE(limiter *SSEConnectionLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := UserID(c)
		if !limiter.acquire(userID) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "too many active connections for this account — close another tab and try again",
			})
			return
		}
		defer limiter.release(userID)
		c.Next()
	}
}
