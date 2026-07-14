import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSSE, type SSEMessage } from '../hooks/useSSE';
import { getShopOrders } from '../api/shop';
import { playIncomingAlert, playOrderComplete } from '../lib/sound';
import { pingShopNotification } from './shopNotifications';

/**
 * Mounted once for the whole shopkeeper session (in Layout). Owns the
 * ['shop','orders'] query so it stays "active" and refetches on every
 * orders_update event regardless of which shop page is open — that's what
 * lets us beep the instant the incoming count grows, even while the
 * shopkeeper is on the Prep or Menu screen.
 *
 * Also detects when an order transitions to fully ready (awaiting_payment)
 * so we can play playOrderComplete() and ping the header notification.
 */
export function ShopRealtime() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['shop', 'orders'], queryFn: getShopOrders });

  // Track previous incoming count to detect new-order arrivals.
  const prevIncomingCountRef = useRef<number | null>(null);

  // Track the set of order IDs that were in awaiting_payment last tick,
  // so we can detect when an order first enters that bucket (= fully ready).
  const prevAwaitingIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!data) return;

    // ── New order alert ────────────────────────────────────────────────────
    const count = data.incoming.length;
    if (prevIncomingCountRef.current !== null && count > prevIncomingCountRef.current) {
      playIncomingAlert();
      pingShopNotification();
    }
    prevIncomingCountRef.current = count;

    // ── Fully-ready / awaiting-payment transition ─────────────────────────
    // An order enters awaiting_payment when every non-rejected item has been
    // handed over. We fire the shopkeeper's distinct chime and a notification
    // dot the first time each order ID appears in that bucket.
    const currentAwaitingIds = new Set(data.awaiting_payment.map((o) => o.id));
    for (const id of currentAwaitingIds) {
      if (!prevAwaitingIdsRef.current.has(id)) {
        // Newly entered awaiting_payment — play chime and badge.
        playOrderComplete();
        pingShopNotification();
        break; // one chime even if multiple orders became ready simultaneously
      }
    }
    prevAwaitingIdsRef.current = currentAwaitingIds;
  }, [data]);

  const handleMessage = useCallback(
    (msg: SSEMessage) => {
      if (msg.type === 'orders_update') {
        queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });
        queryClient.invalidateQueries({ queryKey: ['shop', 'history'] });
      } else if (msg.type === 'prep_update') {
        queryClient.invalidateQueries({ queryKey: ['shop', 'prep'] });
      } else if (msg.type === 'menu_update') {
        queryClient.invalidateQueries({ queryKey: ['shop', 'menu'] });
      }
    },
    [queryClient],
  );

  useSSE('/api/shop/stream', handleMessage);

  return null;
}
