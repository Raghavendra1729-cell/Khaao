package services

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// SSETicketTTL is how long a minted SSE ticket remains valid before it must
// be consumed. Short-lived by design: a ticket only needs to survive the
// brief gap between the frontend calling POST /api/auth/sse-ticket and the
// browser opening the EventSource with it — not the life of the stream
// itself (once the stream is open it needs no further authentication).
const SSETicketTTL = 60 * time.Second

type sseTicketEntry struct {
	userID    uint
	expiresAt time.Time
}

// SSETicketService mints and consumes short-lived, single-use opaque
// tickets used to authenticate SSE (EventSource) connections without ever
// putting the long-lived Khaao JWT in a URL query string — a JWT there
// leaks into proxy/access logs and browser history for the token's full
// 7-day lifetime (STATUS.md § P1-b).
//
// Tickets live in a plain in-memory map. That's correct and sufficient given
// this project's deliberate single-instance topology (STATUS.md § Topology
// decision) — do not reach for Redis or a DB table here, that would be
// over-engineering for a single-process app.
type SSETicketService struct {
	mu      sync.Mutex
	tickets map[string]sseTicketEntry
}

// NewSSETicketService creates an empty ticket store.
func NewSSETicketService() *SSETicketService {
	return &SSETicketService{tickets: make(map[string]sseTicketEntry)}
}

// Mint creates a new single-use ticket bound to userID, valid for
// SSETicketTTL.
func (s *SSETicketService) Mint(userID uint) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	ticket := hex.EncodeToString(buf)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	s.tickets[ticket] = sseTicketEntry{userID: userID, expiresAt: time.Now().Add(SSETicketTTL)}
	return ticket, nil
}

// Consume looks up and deletes a ticket — one-use, whether or not it turns
// out to be expired — and returns the user id it was bound to. ok is false
// if the ticket doesn't exist or has already expired.
func (s *SSETicketService) Consume(ticket string) (uint, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, found := s.tickets[ticket]
	delete(s.tickets, ticket) // one-use regardless of outcome
	if !found || time.Now().After(entry.expiresAt) {
		return 0, false
	}
	return entry.userID, true
}

// sweepLocked drops expired tickets. Called opportunistically on Mint so a
// ticket that's minted but never used (e.g. the tab closed before
// EventSource opened) doesn't linger forever. Callers must already hold s.mu.
func (s *SSETicketService) sweepLocked() {
	now := time.Now()
	for k, v := range s.tickets {
		if now.After(v.expiresAt) {
			delete(s.tickets, k)
		}
	}
}
