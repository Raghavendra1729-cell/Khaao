import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time throws anywhere below it. Without this, an installed
 * PWA has no browser chrome to refresh with, so an uncaught error is a
 * permanent white screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-steel p-6 text-center">
          <div className="max-w-sm rounded-xl2 border border-edge bg-paper p-6 shadow-ticket">
            <p className="font-display text-lg font-bold text-ink">Something went wrong</p>
            <p className="mt-2 text-sm text-ink/70">
              The app hit an unexpected error. Reloading usually fixes it.
            </p>
            <button
              type="button"
              onClick={() => location.reload()}
              className="mt-4 w-full rounded-lg bg-brand px-4 py-2.5 font-display text-sm font-semibold text-white active:bg-brand-dark"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
