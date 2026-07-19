import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  onCancel: () => void;
  /** Called with the checkbox's checked state (false if no checkboxLabel was given). */
  onConfirm: (checked: boolean) => void;
  /** If set, renders an optional checkbox above the actions (e.g. "also mark out of stock"). */
  checkboxLabel?: string;
}

/**
 * The one confirm/destructive-action prompt for the whole app, built on
 * Modal so every confirm gets a portal, Escape-to-cancel, backdrop-tap, and
 * scroll lock for free — window.confirm() gives none of those and looks
 * jarringly out of place inside an installed PWA.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  onCancel,
  onConfirm,
  checkboxLabel,
}: ConfirmDialogProps) {
  const [checked, setChecked] = useState(false);
  const { user } = useAuth();
  const { language } = useLanguage();
  // Gated by role, not just language — this dialog is shared by shop and
  // student call sites, and several of the latter only override
  // confirmLabel (not cancelLabel), so an ungated default would leak a
  // shopkeeper's stored Hindi preference into a student-facing "Cancel"
  // button on a shared device/browser (same guard as Layout.tsx's
  // AvatarMenu / PushNotificationSetup's showHindi).
  const showHindi = user?.role === 'shopkeeper' && language === 'hi';
  const resolvedConfirmLabel = confirmLabel ?? (showHindi ? 'पुष्टि करें' : 'Confirm');
  const resolvedCancelLabel = cancelLabel ?? (showHindi ? 'रद्द करें' : 'Cancel');

  // Reset so a stale check from a previous open doesn't carry over.
  useEffect(() => {
    if (open) setChecked(false);
  }, [open]);

  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink/70">{body}</p>
        {checkboxLabel && (
          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-edge px-3 py-2">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="h-5 w-5 accent-stamp"
            />
            <span className="flex-1 text-sm font-medium text-ink">{checkboxLabel}</span>
          </label>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onCancel}>
            {resolvedCancelLabel}
          </Button>
          <Button variant={variant} className="flex-1" onClick={() => onConfirm(checked)}>
            {resolvedConfirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
