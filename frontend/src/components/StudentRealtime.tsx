import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useSSE, type SSEMessage } from '../hooks/useSSE';
import { useToast } from './Toast';
import { playReadyChime } from '../lib/sound';
import { isActiveOrderStatus, type Order, type OrderStatus } from '../api/types';

/**
 * Mounted once for the whole student session (in Layout) so that order
 * updates — most importantly the transition to "ready" — are caught no
 * matter which page the student is currently looking at.
 */
export function StudentRealtime() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const location = useLocation();
  const prevStatusRef = useRef<OrderStatus | null>(
    queryClient.getQueryData<Order | null>(['orders', 'active'])?.status ?? null,
  );

  const handleMessage = useCallback(
    (msg: SSEMessage) => {
      if (msg.type === 'order_update' && msg.order) {
        const order = msg.order;
        queryClient.setQueryData(['orders', 'active'], isActiveOrderStatus(order.status) ? order : null);
        queryClient.invalidateQueries({ queryKey: ['orders', 'history'] });

        const wasReady = prevStatusRef.current === 'ready';
        if (order.status === 'ready' && !wasReady) {
          playReadyChime();
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate([200, 100, 200]); // buzz phones on silent
          }
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('Khaao — order ready', {
              body: `Order #${order.id} is ready. Pick up within 15 minutes.`,
            });
          }
          if (!location.pathname.startsWith('/order')) {
            showToast(`Order #${order.id} is ready — tap "Order status" to view.`, 'success');
          }
        } else if (order.status === 'rejected' && prevStatusRef.current !== 'rejected') {
          showToast(`Order #${order.id} was rejected by the canteen.`, 'error');
        } else if (order.status === 'expired' && prevStatusRef.current !== 'expired') {
          showToast(`Order #${order.id} expired — the pickup window was missed.`, 'error');
        }
        prevStatusRef.current = order.status;
      } else if (msg.type === 'menu_update') {
        queryClient.invalidateQueries({ queryKey: ['menu'] });
      }
    },
    [queryClient, showToast, location.pathname],
  );

  useSSE('/api/stream', handleMessage);

  return null;
}
