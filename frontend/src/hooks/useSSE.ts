import { useEffect, useRef } from 'react';
import { ApiError } from '../api/client';
import { mintSSETicket } from '../api/auth';
import type { Order } from '../api/types';

export interface SSEMessage {
  type: string;
  order?: Order;
  [key: string]: unknown;
}

const MAX_BACKOFF_MS = 15_000;
const BASE_BACKOFF_MS = 1_000;

/**
 * Subscribes to a Khaao SSE endpoint, authenticating each connection with a
 * short-lived single-use ticket (`?ticket=`) minted just-in-time via
 * POST /api/auth/sse-ticket — never the long-lived JWT itself, which
 * `EventSource` can't send as an Authorization header and which, put
 * directly in a URL, would leak into proxy/access logs and browser history
 * for its full 7-day lifetime (STATUS.md § P1-b). A fresh ticket is minted
 * for every connection attempt, including reconnects — tickets are one-use
 * and expire in ~60s, so a stale one is never retried.
 *
 * Reconnects with exponential backoff (capped at MAX_BACKOFF_MS) on
 * error/disconnect for as long as the hook stays mounted and `path` is
 * non-null — it retries forever on network/EventSource failures, since a
 * flaky connection (campus Wi-Fi dead zone, elevator, network switch) says
 * nothing about whether the session itself is still valid. Only a genuine
 * 401 from the ticket-mint call proves the session is dead; that path is
 * already handled globally by apiFetch (clears storage, dispatches
 * khaao:unauthorized) — this hook just stops retrying when it sees one.
 *
 * `onOpen`, if given, fires on every successful (re)connect, including the
 * first — pass a callback that invalidates whatever queries this stream
 * normally keeps fresh, so a client that missed an event while disconnected
 * (network blip, tab backgrounded, server restart) still ends up correct.
 */
export function useSSE(path: string | null, onMessage: (msg: SSEMessage) => void, onOpen?: () => void): void {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!path) return;

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;

    function scheduleReconnect(): void {
      if (stopped) return;
      const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    }

    function connect(): void {
      if (stopped) return;

      // Mint a brand-new ticket for this specific connection attempt (never
      // reuse one across reconnects — a ticket is one-use and short-lived,
      // see backend services.SSETicketService).
      mintSSETicket()
        .then((ticket) => {
          if (stopped) return;
          const separator = path!.includes('?') ? '&' : '?';
          source = new EventSource(`${path}${separator}ticket=${encodeURIComponent(ticket)}`);

          source.onopen = () => {
            attempt = 0; // reset backoff on a successful connection
            // A dropped connection (or a server restart between a DB commit
            // and its broadcast — see STATUS.md § SSE replay guarantee) can
            // mean an event never reached us. Every (re)connect refetches
            // source-of-truth queries so a missed event can't leave stale
            // data on screen.
            onOpenRef.current?.();
          };

          source.onmessage = (event: MessageEvent<string>) => {
            try {
              const data = JSON.parse(event.data) as SSEMessage;
              onMessageRef.current(data);
            } catch {
              // Malformed payload — ignore, the next message will still land.
            }
          };

          source.onerror = () => {
            source?.close();
            source = null;
            scheduleReconnect();
          };
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 401) {
            // apiFetch already cleared storage and dispatched
            // khaao:unauthorized on the 401 — the session is genuinely gone,
            // so don't keep burning retries minting tickets for it.
            return;
          }
          // Network blip or a transient server error minting the ticket —
          // treat exactly like any other failed connection attempt.
          scheduleReconnect();
        });
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [path]);
}
