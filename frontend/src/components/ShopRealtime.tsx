import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSSE, type SSEMessage } from '../hooks/useSSE';
import { getShopOrders } from '../api/shop';
import { playIncomingAlert } from '../lib/sound';

/**
 * Mounted once for the whole shopkeeper session (in Layout). Owns the
 * ['shop','orders'] query so it stays "active" and refetches on every
 * orders_update event regardless of which shop page is open — that's what
 * lets us beep the instant the incoming count grows, even while the
 * shopkeeper is on the Prep or Menu screen.
 */
export function ShopRealtime() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['shop', 'orders'], queryFn: getShopOrders });
  const prevIncomingCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (!data) return;
    const count = data.incoming.length;
    if (prevIncomingCountRef.current !== null && count > prevIncomingCountRef.current) {
      playIncomingAlert();
    }
    prevIncomingCountRef.current = count;
  }, [data]);

  const handleMessage = useCallback(
    (msg: SSEMessage) => {
      if (msg.type === 'orders_update') {
        queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });
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
