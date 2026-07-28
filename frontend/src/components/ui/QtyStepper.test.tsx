import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QtyStepper } from './QtyStepper';

// Guards STATUS.md § 9.9-Y9: QtyStepper is the most-tapped control in the
// app and was missed in the earlier text-glyph → inline-SVG sweep (Toast,
// Modal, etc. already went through it). It also gave a screen-reader user
// no feedback at all when tapping +/- — the value changed with no
// announcement.
describe('QtyStepper (STATUS.md § 9.9-Y9)', () => {
  it('renders both controls as inline stroke SVGs, not text glyphs', () => {
    render(<QtyStepper value={2} onChange={vi.fn()} />);
    const decrease = screen.getByLabelText('Decrease quantity');
    const increase = screen.getByLabelText('Increase quantity');

    expect(decrease.querySelector('svg')).toBeInTheDocument();
    expect(increase.querySelector('svg')).toBeInTheDocument();
    // No stray "−" / "+" text glyphs left behind as button text content.
    expect(decrease.textContent).toBe('');
    expect(increase.textContent).toBe('');
  });

  it('exposes the quantity in a live region with an accessible name naming what it counts', () => {
    render(<QtyStepper value={3} onChange={vi.fn()} label="Chai" />);
    const liveValue = screen.getByLabelText('Chai quantity: 3');
    expect(liveValue).toHaveAttribute('aria-live', 'polite');
  });

  it('falls back to a generic accessible name when no label is given', () => {
    render(<QtyStepper value={0} onChange={vi.fn()} />);
    const liveValue = screen.getByLabelText('Quantity: 0');
    expect(liveValue).toHaveAttribute('aria-live', 'polite');
  });

  it('updates the live region text as the value changes', () => {
    const { rerender } = render(<QtyStepper value={1} onChange={vi.fn()} label="Samosa" />);
    expect(screen.getByLabelText('Samosa quantity: 1')).toBeInTheDocument();
    rerender(<QtyStepper value={2} onChange={vi.fn()} label="Samosa" />);
    expect(screen.getByLabelText('Samosa quantity: 2')).toBeInTheDocument();
  });

  it('clamps decrease at min and calls onChange with the next value otherwise', () => {
    const onChange = vi.fn();
    render(<QtyStepper value={1} onChange={onChange} min={0} />);
    fireEvent.click(screen.getByLabelText('Decrease quantity'));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('disables decrease at min', () => {
    render(<QtyStepper value={0} onChange={vi.fn()} min={0} />);
    expect(screen.getByLabelText('Decrease quantity')).toBeDisabled();
  });

  it('clamps increase at max and disables the button at the ceiling', () => {
    const onChange = vi.fn();
    render(<QtyStepper value={4} onChange={onChange} max={5} />);
    const increase = screen.getByLabelText('Increase quantity');
    expect(increase).not.toBeDisabled();
    fireEvent.click(increase);
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('disables increase at the default max of 20 and names the reason for a11y', () => {
    render(<QtyStepper value={20} onChange={vi.fn()} />);
    const increase = screen.getByLabelText('Increase quantity — maximum 20 reached');
    expect(increase).toBeDisabled();
  });

  it('disables both buttons when disabled is set', () => {
    render(<QtyStepper value={2} onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText('Decrease quantity')).toBeDisabled();
    expect(screen.getByLabelText('Increase quantity')).toBeDisabled();
  });

  it('disables only increase when disableIncrease is set', () => {
    render(<QtyStepper value={2} onChange={vi.fn()} disableIncrease />);
    expect(screen.getByLabelText('Decrease quantity')).not.toBeDisabled();
    expect(screen.getByLabelText('Increase quantity')).toBeDisabled();
  });
});
