import type { CSSProperties } from 'react';
import type { Diet } from '../api/types';

interface VegMarkProps {
  diet: Diet;
  /** Outer square size in px. */
  size?: number;
  className?: string;
}

/**
 * The FSSAI veg / non-veg mark every Indian student already reads at a glance:
 * a bordered square holding a filled dot (veg) or an upward triangle (non-veg).
 * Far clearer — and more native to a canteen — than a coloured word or pill.
 */
export function VegMark({ diet, size = 15, className = '' }: VegMarkProps) {
  const isVeg = diet === 'veg';
  const color = isVeg ? '#3F5D48' /* brand moss */ : '#AE3327' /* stamp red */;
  const inner = Math.round(size * 0.52);
  const border = Math.max(1, Math.round(size / 12));

  const boxStyle: CSSProperties = {
    width: size,
    height: size,
    borderColor: color,
    borderWidth: border,
    borderStyle: 'solid',
    borderRadius: 2,
  };

  const glyphStyle: CSSProperties = isVeg
    ? { width: inner, height: inner, background: color, borderRadius: 9999 }
    : {
        width: 0,
        height: 0,
        borderLeft: `${inner / 2}px solid transparent`,
        borderRight: `${inner / 2}px solid transparent`,
        borderBottom: `${inner}px solid ${color}`,
      };

  return (
    <span
      role="img"
      aria-label={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
      title={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
      className={`inline-flex shrink-0 items-center justify-center bg-paper ${className}`}
      style={boxStyle}
    >
      <span aria-hidden style={glyphStyle} />
    </span>
  );
}
