package realtime

import "testing"

// TestHubDropsSlowConsumerByClosingChannel guards the R21 fix: a client
// whose channel is full (not draining fast enough) must be dropped by
// closing its channel, not silently ignored. Closing lets the SSE handler's
// read loop end immediately and the browser reconnect (see
// controllers.streamSSE's `msg, ok := <-client.Messages()`), instead of the
// client sitting stale until some unrelated future event happens to land
// after it catches up.
func TestHubDropsSlowConsumerByClosingChannel(t *testing.T) {
	hub := NewHub()
	client := hub.Register(1, "student")

	// Fill the client's buffered channel (32 slots) without draining it —
	// a blocked/slow reader.
	for i := 0; i < 32; i++ {
		hub.NotifyOrderUpdate(1, map[string]any{"n": i})
	}

	// The channel is now full; this send must find it full and drop the
	// client (delete + close) rather than just discarding the event.
	hub.NotifyOrderUpdate(1, map[string]any{"n": "overflow"})

	// Drain exactly the 32 buffered messages that made it through before
	// the drop.
	for i := 0; i < 32; i++ {
		select {
		case _, ok := <-client.Messages():
			if !ok {
				t.Fatalf("channel closed early at buffered message %d, expected 32 first", i)
			}
		default:
			t.Fatalf("expected a buffered message at index %d", i)
		}
	}

	// After draining the buffer, the channel must be closed — proving the
	// overflowing send dropped the client instead of silently no-oping.
	select {
	case _, ok := <-client.Messages():
		if ok {
			t.Fatal("expected the client's channel to be closed after a dropped send, got another message instead")
		}
	default:
		t.Fatal("expected the closed channel to be immediately readable (ok=false), got nothing")
	}

	// A closed client must not still be tracked — the next fan-out should
	// not panic trying to send to it again, and Unregister (called by the
	// deferred cleanup in the real SSE handler) must be a safe no-op.
	hub.NotifyOrderUpdate(1, map[string]any{"n": "after-drop"})
	hub.Unregister(client)
}
