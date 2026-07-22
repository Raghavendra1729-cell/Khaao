import { useSyncExternalStore } from 'react';

/**
 * A tiny module-level store for the shopkeeper's header notification symbol.
 * ShopRealtime (which owns the live orders query + SSE stream) calls
 * `pingShopNotification()` when a new order arrives or an order becomes fully
 * ready; the header bell reads `useShopNotification()` to show a dot and clears
 * it once the shopkeeper views the Orders screen. Kept outside React so the
 * writer (ShopRealtime, returns null) and the reader (Layout header) don't need
 * a shared provider wrapping them.
 */
let unseen = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function pingShopNotification(): void {
  if (unseen) return;
  unseen = true;
  emit();
}

export function clearShopNotification(): void {
  if (!unseen) return;
  unseen = false;
  emit();
}

export function useShopNotification(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => unseen,
    () => false,
  );
}
