import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useSSE, type SSEMessage } from '../hooks/useSSE';
import { useToast } from './Toast';
import { playReadyChime, playStatusChange } from '../lib/sound';
import { isActiveOrderStatus, type Order, type OrderStatus } from '../api/types';
import { formatPrice } from '../lib/format';

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
  const rejectedItemsRef = useRef<Map<number, Set<number>>>(new Map());

  const handleMessage = useCallback(
    (msg: SSEMessage) => {
      if (msg.type === 'order_update' && msg.order) {
        const order = msg.order;
        queryClient.setQueryData(['orders', 'active'], isActiveOrderStatus(order.status) ? order : null);
        queryClient.invalidateQueries({ queryKey: ['orders', 'history'] });

        const orderId = order.id;
        if (!rejectedItemsRef.current.has(orderId)) {
          // New order id — reset tracking so we don't carry stale state from a
          // previous order, and don't treat already-rejected items as "new".
          rejectedItemsRef.current.clear();
          const initialRejected = new Set<number>();
          order.items.forEach((item) => {
            if (item.status === 'rejected') initialRejected.add(item.id);
          });
          rejectedItemsRef.current.set(orderId, initialRejected);
        }

        const seenRejected = rejectedItemsRef.current.get(orderId)!;
        const newlyRejectedItems: typeof order.items = [];
        order.items.forEach((item) => {
          if (item.status === 'rejected' && !seenRejected.has(item.id)) {
            newlyRejectedItems.push(item);
          }
        });

        const prevStatus = prevStatusRef.current;
        // A whole order being rejected (full reject, or every item trimmed at
        // accept time) also marks every item rejected — but that case already
        // has its own clear "order was rejected" message below and shouldn't
        // be swallowed by the partial-trim wording.
        const orderNewlyFullyRejected = order.status === 'rejected' && prevStatus !== 'rejected';

        let didNotifyTrim = false;
        if (newlyRejectedItems.length > 0 && !orderNewlyFullyRejected) {
          didNotifyTrim = true;
          let toastMsg = '';
          if (newlyRejectedItems.length <= 3) {
            const listStr = newlyRejectedItems.map((i) => `${i.name} ×${i.qty}`).join(', ');
            toastMsg = `${newlyRejectedItems.length} item(s) removed from your order: ${listStr} — new total ${formatPrice(order.total_price)}.`;
          } else {
            toastMsg = `${newlyRejectedItems.length} items removed — new total ${formatPrice(order.total_price)}.`;
          }
          showToast(toastMsg, 'info');
          playStatusChange();
        }
        newlyRejectedItems.forEach((i) => seenRejected.add(i.id));

        if (order.status !== prevStatus) {
          if (!didNotifyTrim) {
            if (order.status === 'ready') {
              playReadyChime();
              if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate([200, 100, 200]); // buzz phones on silent
              }
              if (
                typeof Notification !== 'undefined' &&
                Notification.permission === 'granted' &&
                'serviceWorker' in navigator
              ) {
                // The Notification() constructor isn't supported on iOS
                // Safari — only registration.showNotification() from a
                // service worker is. Same call path as the SW's own `push`
                // listener, so it works identically in-tab or backgrounded.
                navigator.serviceWorker.ready.then((registration) => {
                  registration.showNotification('Khaao — order ready', {
                    body: `Token #${order.order_no} is ready. Pick up at the counter.`,
                    icon: '/icon-192.png',
                  });
                });
              }
              if (!location.pathname.startsWith('/order')) {
                showToast(`Token #${order.order_no} is ready — tap "Order status" to view.`, 'success');
              }
            } else {
              if (prevStatus !== null) {
                playStatusChange();
                if (order.status === 'preparing') {
                  showToast(`Token #${order.order_no} is now being prepared.`, 'info');
                } else if (order.status === 'partially_ready') {
                  showToast(`Token #${order.order_no} is partially ready.`, 'info');
                } else if (order.status === 'awaiting_payment') {
                  showToast(`Token #${order.order_no} is ready! Please pay at the counter.`, 'success');
                } else if (order.status === 'completed') {
                  showToast(`Token #${order.order_no} is completed. Thank you!`, 'success');
                } else if (order.status === 'rejected') {
                  showToast(
                    `Token #${order.order_no} was declined by the canteen — some items may be unavailable. Please place a new order.`,
                    'error',
                  );
                } else if (order.status === 'expired') {
                  showToast(`Token #${order.order_no} expired — the pickup window was missed.`, 'error');
                } else if (order.status === 'cancelled') {
                  showToast(`Token #${order.order_no} was cancelled.`, 'info');
                }
              } else {
                if (order.status === 'rejected') {
                  showToast(
                    `Token #${order.order_no} was declined by the canteen — some items may be unavailable. Please place a new order.`,
                    'error',
                  );
                } else if (order.status === 'expired') {
                  showToast(`Token #${order.order_no} expired — the pickup window was missed.`, 'error');
                }
              }
            }
          }
        }
        prevStatusRef.current = order.status;
      } else if (msg.type === 'menu_update') {
        queryClient.invalidateQueries({ queryKey: ['menu'] });
      } else if (msg.type === 'shop_status') {
        queryClient.invalidateQueries({ queryKey: ['shop-status'] });
      }
    },
    [queryClient, showToast, location.pathname],
  );

  const handleOpen = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['orders', 'active'] });
    queryClient.invalidateQueries({ queryKey: ['orders', 'history'] });
    queryClient.invalidateQueries({ queryKey: ['menu'] });
    queryClient.invalidateQueries({ queryKey: ['shop-status'] });
  }, [queryClient]);

  useSSE('/api/stream', handleMessage, handleOpen);

  return null;
}
