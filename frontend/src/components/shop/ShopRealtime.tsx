import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSSE, type SSEMessage } from '../../hooks/useSSE';
import { getShopOrders } from '../../api/shop';
import { playIncomingAlert, playOrderComplete } from '../../lib/sound';
import { pingShopNotification } from '../../lib/shopNotifications';
import { announce } from '../../lib/liveAnnouncer';
import { useLanguage } from '../../context/LanguageContext';

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
  const { language } = useLanguage();
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
      // G7: the one shop-side moment this live region covers — matches the
      // chime it rides alongside, nothing more.
      announce(language === 'hi' ? 'नया ऑर्डर आया है।' : 'New order received.');
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
  }, [data, language]);

  const handleMessage = useCallback(
    (msg: SSEMessage) => {
      if (msg.type === 'orders_update') {
        queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });
        queryClient.invalidateQueries({ queryKey: ['shop', 'history'] });
      } else if (msg.type === 'prep_update') {
        queryClient.invalidateQueries({ queryKey: ['shop', 'prep'] });
      } else if (msg.type === 'menu_update') {
        queryClient.invalidateQueries({ queryKey: ['shop', 'menu'] });
      } else if (msg.type === 'shop_status') {
        // hub.NotifyShopStatusUpdate broadcasts this to every client (students
        // AND shop). It was being dropped here, so the header status pill
        // (ShopStatusControl, keyed ['shop-status']) only ever updated from its
        // own mutation — a change made on another shopkeeper device never
        // reached this one until a full reload.
        queryClient.invalidateQueries({ queryKey: ['shop-status'] });
      }
    },
    [queryClient],
  );

  const handleOpen = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });
    queryClient.invalidateQueries({ queryKey: ['shop', 'prep'] });
    queryClient.invalidateQueries({ queryKey: ['shop', 'menu'] });
    queryClient.invalidateQueries({ queryKey: ['shop-status'] });
    // Otherwise the only thing that ever refreshes shop history is
    // handleMessage's orders_update branch — so a dropped SSE stream mid-
    // rush leaves the History tab's totals stale until some later,
    // unrelated order happens to complete (STATUS.md § 9.5 T5).
    queryClient.invalidateQueries({ queryKey: ['shop', 'history'] });
  }, [queryClient]);

  useSSE('/api/shop/stream', handleMessage, handleOpen);

  return null;
}
