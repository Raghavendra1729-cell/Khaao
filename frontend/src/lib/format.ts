// Money & time formatting helpers. Prices are always integer paise on the wire.

export function formatPrice(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/** Parse a rupee decimal string/number (as typed in a form) into integer paise. */
export function rupeesToPaise(rupees: string | number): number {
  const n = typeof rupees === 'string' ? parseFloat(rupees) : rupees;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Format integer paise as a rupee decimal string suitable for a number input. */
export function paiseToRupeesInput(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Seconds remaining until an RFC3339 timestamp, clamped to zero. */
export function secondsUntil(iso: string | null): number {
  if (!iso) return 0;
  const diffMs = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(diffMs / 1000));
}

export function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const CLOUDINARY_UPLOAD_MARKER = '/upload/';

/**
 * Injects an f_auto,q_auto,w_<widthPx> transform right after `/upload/` in a
 * Cloudinary delivery URL, so a phone photo uploaded at full size (4-8 MB)
 * is served at the size it's actually displayed at instead of downloaded
 * full-size into e.g. a 48px thumbnail. Any URL that isn't a Cloudinary
 * delivery URL (blob: previews, non-Cloudinary values) passes through
 * unchanged.
 */
export function cloudinaryThumb(url: string | null | undefined, widthPx: number): string | null {
  if (!url) return null;
  const markerIndex = url.indexOf(CLOUDINARY_UPLOAD_MARKER);
  if (markerIndex === -1) return url;
  const insertAt = markerIndex + CLOUDINARY_UPLOAD_MARKER.length;
  return `${url.slice(0, insertAt)}f_auto,q_auto,w_${Math.round(widthPx)}/${url.slice(insertAt)}`;
}
