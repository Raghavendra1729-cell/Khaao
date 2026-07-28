import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StatusStamps } from './StatusStamps';
import type { OrderStatus } from '../../api/types';

// STATUS.md § 9.12 Y2 — `STAMP_BASE` used to apply an opacity modifier
// directly to `currentColor` as the stamp's ink fill. Tailwind 3.4 (this
// project's version) can't do that — there's no color channel to
// interpolate — so the utility was silently dropped at build time. A test
// that only reads the rendered className string would have passed against
// the broken code (the class was right there in the JSX), so this test
// instead builds the app and checks the fill class each stamp emits
// actually landed as a real CSS rule in the compiled stylesheet.
//
// Note: deliberately not spelling the old dead utility out as a contiguous
// literal anywhere in this file — Tailwind's content scanner does raw
// substring extraction over every matched .tsx file, test files included,
// so writing it verbatim here would itself regenerate the dead rule in the
// build this test triggers.

let cssContent = '';

beforeAll(() => {
  // A real `vite build` (a couple of seconds here) — slow for a unit test,
  // but this is exactly the class of bug (a utility the Tailwind JIT
  // silently drops) a className-only assertion cannot catch.
  execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'pipe' });
  const distAssets = path.join(process.cwd(), 'dist', 'assets');
  const cssFiles = readdirSync(distAssets).filter((f) => f.endsWith('.css'));
  cssContent = cssFiles.map((f) => readFileSync(path.join(distAssets, f), 'utf-8')).join('\n');
}, 60_000);

/** Every `bg-*` utility class on a stamp span, excluding the unlanded
 * (dashed-outline, no fill) state's explicit `bg-transparent`. */
function fillClassesOf(container: HTMLElement): string[] {
  const classes = new Set<string>();
  container.querySelectorAll('span').forEach((el) => {
    el.className.split(/\s+/).forEach((c) => {
      if (/^bg-/.test(c) && c !== 'bg-transparent') classes.add(c);
    });
  });
  return Array.from(classes);
}

// Tailwind escapes punctuation (like the `/` in an opacity modifier) in the
// generated selector — `bg-ink/10` in JSX becomes the CSS selector
// `.bg-ink\/10` in the compiled stylesheet.
function asEscapedSelector(cls: string): string {
  return `.${cls.replace(/([/:.])/g, '\\$1')}`;
}

describe('StatusStamps — ink fill actually ships as CSS (Y2)', () => {
  const cases: { status: OrderStatus; label: string }[] = [
    { status: 'submitted', label: 'submitted' },
    { status: 'preparing', label: 'preparing' },
    { status: 'ready', label: 'ready' },
    { status: 'completed', label: 'completed' },
    { status: 'rejected', label: 'void (rejected)' },
  ];

  it.each(cases)('$label stamp carries a fill class present in the compiled stylesheet', ({ status }) => {
    const { container } = render(<StatusStamps status={status} />);
    const fillClasses = fillClassesOf(container);
    // Every landed/void stamp must have at least one real fill utility —
    // an outline with no ink wash is the bug (§ 9.2's signature element
    // shipping with no ink fill).
    expect(fillClasses.length).toBeGreaterThan(0);
    for (const cls of fillClasses) {
      expect(cssContent).toContain(asEscapedSelector(cls));
    }
  });

  it('never emits the old currentColor-opacity utility', () => {
    // Built at runtime (not a literal in this file) so Tailwind's build-time
    // content scan never sees it, for the same reason noted at the top of
    // this file.
    const deadUtility = ['bg', 'current/10'].join('-');
    const { container } = render(<StatusStamps status="submitted" />);
    expect(container.innerHTML).not.toContain(deadUtility);
  });
});
