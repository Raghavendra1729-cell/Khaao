import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from './Toast';

function Harness() {
  const { showToast } = useToast();
  return (
    <div>
      <button onClick={() => showToast('Error message', 'error')}>fire-error</button>
      <button onClick={() => showToast('Success message', 'success')}>fire-success</button>
      <button onClick={() => showToast('m1')}>fire-m1</button>
      <button onClick={() => showToast('m2')}>fire-m2</button>
      <button onClick={() => showToast('m3')}>fire-m3</button>
      <button onClick={() => showToast('m4')}>fire-m4</button>
    </div>
  );
}

function renderHarness() {
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

// Guards STATUS.md § 9.11-X4: three measured problems on the toast surface —
// a ~20px dismiss target (§ 9.1.2 requires 44px), a flat 5s timeout even for
// the highest-stakes copy the app sends (price drift, failed stock updates),
// and an unbounded stack that can grow past the viewport during an SSE burst.
describe('Toast (STATUS.md § 9.11-X4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives error toasts a longer auto-dismiss than success/info', async () => {
    renderHarness();
    fireEvent.click(screen.getByText('fire-error'));
    fireEvent.click(screen.getByText('fire-success'));

    await vi.advanceTimersByTimeAsync(5000);
    // Success is gone at 5s; the error toast must still be showing.
    expect(screen.queryByText('Success message')).not.toBeInTheDocument();
    expect(screen.getByText('Error message')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.queryByText('Error message')).not.toBeInTheDocument();
  });

  it('gives the dismiss button a 44px hit target', () => {
    renderHarness();
    fireEvent.click(screen.getByText('fire-error'));
    const dismissButton = screen.getByLabelText('Dismiss');
    expect(dismissButton.className).toMatch(/\bh-11\b/);
    expect(dismissButton.className).toMatch(/\bw-11\b/);
  });

  it('caps the visible stack and drops the oldest toast', () => {
    renderHarness();
    fireEvent.click(screen.getByText('fire-m1'));
    fireEvent.click(screen.getByText('fire-m2'));
    fireEvent.click(screen.getByText('fire-m3'));
    fireEvent.click(screen.getByText('fire-m4'));

    expect(screen.queryByText('m1')).not.toBeInTheDocument();
    expect(screen.getByText('m2')).toBeInTheDocument();
    expect(screen.getByText('m3')).toBeInTheDocument();
    expect(screen.getByText('m4')).toBeInTheDocument();
  });
});
