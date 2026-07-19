// Package realtime implements an in-memory SSE hub: per-connection channels
// keyed by user id / role, used to push order, prep and menu events to
// connected students and shopkeepers.
package realtime

import (
	"encoding/json"
	"sync"
)

// Client is a single connected SSE stream (one browser tab).
type Client struct {
	ch     chan []byte
	userID uint
	role   string
}

// Hub fans out events to all connected clients. Safe for concurrent use.
type Hub struct {
	mu      sync.Mutex
	clients map[*Client]struct{}
}

// NewHub creates an empty hub.
func NewHub() *Hub {
	return &Hub{clients: make(map[*Client]struct{})}
}

// Register creates and tracks a new client for the given user/role.
func (h *Hub) Register(userID uint, role string) *Client {
	c := &Client{
		ch:     make(chan []byte, 32),
		userID: userID,
		role:   role,
	}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	return c
}

// Unregister removes and closes a client's channel.
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.ch)
	}
}

// CloseAll closes every connected client's channel and empties the hub.
// net/http's Server.Shutdown waits for active handlers to return but does
// not cancel their request contexts, and streamSSE only ever exits on
// client disconnect or a channel close — so with even one stream open,
// every graceful shutdown would otherwise stall for the full shutdown
// timeout and the streams would die abruptly anyway when the process
// exits. Call this right before Shutdown: each handler's `msg, ok :=
// <-client.Messages()` sees ok=false and returns immediately, the browser
// sees a closed connection and reconnects (the same self-heal path R21's
// drop-on-full-channel already exercises daily), and Shutdown completes in
// milliseconds instead of stalling.
func (h *Hub) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		close(c.ch)
		delete(h.clients, c)
	}
}

// Messages returns the channel the SSE handler should read from.
func (c *Client) Messages() <-chan []byte {
	return c.ch
}

// send delivers payload to c's channel. If it's full (a slow consumer not
// draining fast enough), c is dropped and its channel closed instead of
// silently discarding the event — otherwise the client wouldn't learn it
// missed something until whatever future event happens to land after it
// catches up, which could leave a stale screen up indefinitely. Closing the
// channel ends the SSE handler's read loop immediately (its `msg, ok :=
// <-client.Messages()` sees ok=false and returns), which the browser sees
// as a closed connection and reconnects to — useSSE's onOpen then refetches
// everything fresh, so a dropped client self-heals on its next event burst
// rather than staying silently stale.
//
// Must be called with h.mu already held — every caller (sendToUser,
// broadcastRole, broadcastAll) holds it for the whole fan-out loop. Deletes
// from h.clients directly rather than calling the public Unregister method,
// which would deadlock re-acquiring the same lock. Deleting the loop's
// current map key mid-range is well-defined in Go (safe, no skipped/
// re-visited entries), so this is safe to call from inside those loops.
func (h *Hub) send(c *Client, payload []byte) {
	select {
	case c.ch <- payload:
	default:
		delete(h.clients, c)
		close(c.ch)
	}
}

// sendToUser delivers payload to every client belonging to userID.
func (h *Hub) sendToUser(userID uint, payload []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		if c.userID == userID {
			h.send(c, payload)
		}
	}
}

// broadcastRole delivers payload to every client with the given role.
func (h *Hub) broadcastRole(role string, payload []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		if c.role == role {
			h.send(c, payload)
		}
	}
}

// broadcastAll delivers payload to every connected client.
func (h *Hub) broadcastAll(payload []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		h.send(c, payload)
	}
}

type event struct {
	Type  string `json:"type"`
	Order any    `json:"order,omitempty"`
}

func marshal(e event) []byte {
	b, err := json.Marshal(e)
	if err != nil {
		// event payloads are always simple structs; this should never fail.
		return []byte(`{"type":"error"}`)
	}
	return b
}

// NotifyOrderUpdate sends the full order to the owning student.
func (h *Hub) NotifyOrderUpdate(studentUserID uint, order any) {
	h.sendToUser(studentUserID, marshal(event{Type: "order_update", Order: order}))
}

// NotifyMenuUpdate tells every connected client (student and shop) to
// refetch the menu.
func (h *Hub) NotifyMenuUpdate() {
	h.broadcastAll(marshal(event{Type: "menu_update"}))
}

// NotifyShopOrdersUpdate tells shop dashboards to refetch their order lists.
func (h *Hub) NotifyShopOrdersUpdate() {
	h.broadcastRole("shopkeeper", marshal(event{Type: "orders_update"}))
}

// NotifyShopPrepUpdate tells shop dashboards to refetch the prep list.
func (h *Hub) NotifyShopPrepUpdate() {
	h.broadcastRole("shopkeeper", marshal(event{Type: "prep_update"}))
}

// NotifyShopStatusUpdate tells every connected client (student and shop) to
// refetch the shop's open/paused/closed status.
func (h *Hub) NotifyShopStatusUpdate() {
	h.broadcastAll(marshal(event{Type: "shop_status"}))
}
