import { useEffect, useRef } from 'react';
import { getToken } from '../api/client';
import type { Order } from '../api/types';

export interface SSEMessage {
  type: string;
  order?: Order;
  [key: string]: unknown;
}

const MAX_BACKOFF_MS = 15_000;
const BASE_BACKOFF_MS = 1_000;

/**
 * Subscribes to a Khaao SSE endpoint with the auth token as a query param
 * (required since EventSource cannot set an Authorization header). Silently
 * reconnects with exponential backoff on error/disconnect for as long as the
 * hook stays mounted and `path` is non-null.
 */
export function useSSE(path: string | null, onMessage: (msg: SSEMessage) => void): void {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!path) return;

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;

    function connect(): void {
      if (stopped) return;
      const token = getToken();
      const separator = path!.includes('?') ? '&' : '?';
      source = new EventSource(`${path}${separator}token=${encodeURIComponent(token ?? '')}`);

      source.onopen = () => {
        attempt = 0;
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
        if (stopped) return;
        const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [path]);
}
