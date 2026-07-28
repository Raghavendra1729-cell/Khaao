import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './Modal';

// STATUS.md § 9.12 Y3/Y7/Y10 — three independent regression tests against
// the same component, one file per the established convention of grouping
// tests with the component they exercise.

describe('Modal — accessible name (Y3)', () => {
  it('exposes an accessible name matching the title prop', () => {
    render(
      <Modal open onClose={() => {}} title="Your order">
        <p>content</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Your order' })).toBeInTheDocument();
  });

  it('still exposes a non-empty accessible name with no title, and no dangling aria-labelledby', () => {
    render(
      <Modal open onClose={() => {}}>
        <p>content</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    // A non-empty accessible name — jsdom + testing-library compute this via
    // the accessible-name algorithm, so this fails if aria-label is missing
    // or empty.
    expect(dialog).toHaveAccessibleName();
    const labelledBy = dialog.getAttribute('aria-labelledby');
    if (labelledBy) {
      // If present at all, every id it references must resolve to a real
      // element — a dangling reference is the bug this test guards against.
      for (const id of labelledBy.split(/\s+/)) {
        expect(document.getElementById(id)).not.toBeNull();
      }
    }
  });
});

describe('Modal — dvh sizing (Y7)', () => {
  // jsdom cannot evaluate viewport units (dvh/vh have no meaning without a
  // real layout engine), so this is a weak, syntactic test: it only proves
  // the class list carries `dvh` instead of `vh`, not that it renders
  // correctly on a phone with a dynamic viewport.
  it('sizes the sheet with dvh, not vh', () => {
    render(
      <Modal open onClose={() => {}} title="Sized">
        <p>content</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toMatch(/max-h-\[92dvh\]/);
    expect(dialog.className).toMatch(/sm:max-h-\[88dvh\]/);
    expect(dialog.className).not.toMatch(/max-h-\[92vh\]/);
    expect(dialog.className).not.toMatch(/sm:max-h-\[88vh\]/);
  });
});

describe('Modal — drag-close guard (Y10)', () => {
  it('does not close when a mousedown starts inside the sheet and the click lands on the backdrop', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Drag test">
        <p>content</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;

    // Simulate a drag: press down inside the sheet, release on the backdrop.
    // The browser fires `click` on the nearest common ancestor of
    // mousedown/mouseup targets — the backdrop — so without a start-target
    // guard this closes the modal even though the user never intended to
    // dismiss it.
    fireEvent.mouseDown(dialog);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a full click that both starts and ends on the backdrop', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Backdrop click">
        <p>content</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
