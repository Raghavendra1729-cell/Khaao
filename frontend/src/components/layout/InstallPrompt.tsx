import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { setInstallPromptShowing } from '../../lib/promptCoordination';
import { dismissInstallCard, isInstallCardDismissedRecently, useInstallState } from '../../lib/install';

/**
 * One-shot bottom-sheet nudge. `lib/install.ts` is the actual source of
 * truth for installability (shared with Settings' always-available "Get the
 * app" section, STATUS.md § 9.7 P2) — this component only decides whether to
 * show the nudge right now, and whether the student dismissed it recently
 * (time-boxed to ~30 days, P6). Settings is the permanent path, so this card
 * only needs to be polite, not a last chance.
 */
export function InstallPrompt() {
  const state = useInstallState();
  const [dismissedRecently, setDismissedRecently] = useState(isInstallCardDismissedRecently);

  const shouldShow = !dismissedRecently && (state.kind === 'promptable' || state.kind === 'ios-manual');

  // Claim (or release) the shared bottom-sheet slot for PushNotificationSetup
  // to check — see promptCoordination.ts. Release it on unmount too, even
  // though this component stays mounted for the app's lifetime in practice.
  useEffect(() => {
    setInstallPromptShowing(shouldShow);
  }, [shouldShow]);
  useEffect(() => () => setInstallPromptShowing(false), []);

  if (!shouldShow) {
    return null;
  }

  const handleInstallClick = () => {
    if (state.kind !== 'promptable') return;
    void state.prompt();
  };

  const handleDismiss = () => {
    dismissInstallCard();
    setDismissedRecently(true);
  };

  return (
    <Modal
      open
      onClose={handleDismiss}
      title="Get Khaao"
      size="sm"
      footer={
        state.kind === 'promptable' ? (
          <Button type="button" onClick={handleInstallClick} fullWidth>
            Download
          </Button>
        ) : undefined
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          {state.kind === 'ios-manual' ? (
            <p className="text-sm font-medium text-ink">
              Add to your home screen: tap <span className="font-semibold">Share</span>, then{' '}
              <span className="font-semibold">"Add to Home Screen"</span>.
            </p>
          ) : (
            <p className="text-sm text-ink/70">Order faster from your home screen.</p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink/50 hover:bg-ink/5 hover:text-ink transition"
          aria-label="Dismiss"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </Modal>
  );
}
