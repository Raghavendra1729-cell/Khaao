import { describe, expect, it, vi } from 'vitest';
import {
  cloudinaryThumb,
  formatCountdown,
  formatPrice,
  paiseToRupeesInput,
  rupeesToPaise,
  secondsUntil,
} from './format';

describe('formatPrice', () => {
  it('formats integer paise as a rupee string with 2 decimals', () => {
    expect(formatPrice(10000)).toBe('₹100.00');
    expect(formatPrice(150)).toBe('₹1.50');
    expect(formatPrice(0)).toBe('₹0.00');
  });

  it('rounds to the nearest paise-derived cent', () => {
    expect(formatPrice(999)).toBe('₹9.99');
  });
});

describe('rupeesToPaise', () => {
  it('parses a decimal rupee string into integer paise', () => {
    expect(rupeesToPaise('100.00')).toBe(10000);
    expect(rupeesToPaise('1.5')).toBe(150);
    expect(rupeesToPaise('9.99')).toBe(999);
  });

  it('accepts a number directly', () => {
    expect(rupeesToPaise(45.5)).toBe(4550);
  });

  it('returns 0 for unparseable input instead of NaN', () => {
    expect(rupeesToPaise('not a number')).toBe(0);
    expect(rupeesToPaise('')).toBe(0);
  });

  it('rounds fractional-paise results', () => {
    // 33.333 rupees -> 3333.3 paise, rounds to 3333
    expect(rupeesToPaise('33.333')).toBe(3333);
  });
});

describe('paiseToRupeesInput', () => {
  it('formats integer paise back into a 2-decimal rupee string for a form input', () => {
    expect(paiseToRupeesInput(10000)).toBe('100.00');
    expect(paiseToRupeesInput(150)).toBe('1.50');
    expect(paiseToRupeesInput(0)).toBe('0.00');
  });

  it('round-trips with rupeesToPaise', () => {
    expect(rupeesToPaise(paiseToRupeesInput(4550))).toBe(4550);
  });
});

describe('secondsUntil', () => {
  it('returns 0 for a null timestamp', () => {
    expect(secondsUntil(null)).toBe(0);
  });

  it('returns 0 (clamped) for a timestamp already in the past', () => {
    expect(secondsUntil(new Date(Date.now() - 60_000).toISOString())).toBe(0);
  });

  it('returns the whole seconds remaining until a future timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const future = new Date('2026-01-01T00:00:10.000Z').toISOString();
    expect(secondsUntil(future)).toBe(10);
    vi.useRealTimers();
  });
});

describe('formatCountdown', () => {
  it('formats seconds as m:ss', () => {
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(5)).toBe('0:05');
  });

  it('clamps negative input to 0:00', () => {
    expect(formatCountdown(-30)).toBe('0:00');
  });
});

describe('cloudinaryThumb', () => {
  const cloudinaryUrl = 'https://res.cloudinary.com/demo/image/upload/v1234/menu/chai.jpg';

  it('injects f_auto,q_auto,w_<width> right after /upload/', () => {
    expect(cloudinaryThumb(cloudinaryUrl, 128)).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_128/v1234/menu/chai.jpg',
    );
  });

  it('rounds a fractional width', () => {
    expect(cloudinaryThumb(cloudinaryUrl, 127.6)).toContain('w_128/');
  });

  it('passes through a non-Cloudinary URL unchanged', () => {
    const other = 'https://example.com/photo.jpg';
    expect(cloudinaryThumb(other, 128)).toBe(other);
  });

  it('passes through a blob: preview URL unchanged', () => {
    const blob = 'blob:http://localhost:5173/abc-123';
    expect(cloudinaryThumb(blob, 128)).toBe(blob);
  });

  it('returns null for null/undefined/empty input', () => {
    expect(cloudinaryThumb(null, 128)).toBeNull();
    expect(cloudinaryThumb(undefined, 128)).toBeNull();
    expect(cloudinaryThumb('', 128)).toBeNull();
  });
});
