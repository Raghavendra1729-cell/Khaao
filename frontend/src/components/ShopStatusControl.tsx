import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getShopStatus, setShopStatus } from '../api/shop';
import { ApiError } from '../api/client';
import type { ShopState } from '../api/types';
import { formatTime } from '../lib/format';
import { Button } from './Button';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';

const STATE_META: Record<
  ShopState,
  { label: string; labelHi: string; dot: string; text: string; chip: string }
> = {
  open: {
    label: 'Open',
    labelHi: 'खुला',
    dot: 'bg-brand',
    text: 'text-brand-dark',
    chip: 'border-brand/40 bg-brand-light',
  },
  paused: {
    label: 'Paused',
    labelHi: 'रुका हुआ',
    dot: 'bg-turmeric',
    text: 'text-turmeric-deep',
    chip: 'border-turmeric/40 bg-turmeric-pale',
  },
  closed: {
    label: 'Closed',
    labelHi: 'बंद',
    dot: 'bg-stamp',
    text: 'text-stamp-dark',
    chip: 'border-stamp/40 bg-stamp-light',
  },
};

const OPTIONS: ShopState[] = ['open', 'paused', 'closed'];

/** Current local time + 30 min as "HH:MM" — a sensible default reopen time. */
function defaultReopenTime(): string {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Turn an "HH:MM" (local) into an RFC3339 instant, rolling to tomorrow if it's
 * already past today. */
function reopenTimeToISO(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export function ShopStatusControl() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { language } = useLanguage();
  const statusQuery = useQuery({ queryKey: ['shop', 'status'], queryFn: getShopStatus });

  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ShopState | null>(null);
  const [reopenTime, setReopenTime] = useState(defaultReopenTime);
  const [error, setError] = useState<string | null>(null);

  const status = statusQuery.data;
  const current: ShopState = status?.state ?? 'open';
  const meta = STATE_META[current];

  const mutation = useMutation({
    mutationFn: (next: ShopState) =>
      setShopStatus(next, next === 'paused' ? reopenTimeToISO(reopenTime) : null),
    onSuccess: (data) => {
      queryClient.setQueryData(['shop', 'status'], data);
      queryClient.invalidateQueries({ queryKey: ['shop', 'status'] });
      const label = STATE_META[data.state].label.toLowerCase();
      showToast(
        language === 'hi' ? `कैंटीन अब ${STATE_META[data.state].labelHi} है।` : `Canteen is now ${label}.`,
        'success',
      );
      close();
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError
          ? err.message
          : language === 'hi'
            ? 'स्थिति नहीं बदली जा सकी।'
            : 'Could not change status.';
      setError(msg);
      showToast(msg, 'error');
    },
  });

  function openControl() {
    setTarget(null);
    setError(null);
    setReopenTime(defaultReopenTime());
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setTarget(null);
    setError(null);
  }

  function pick(next: ShopState) {
    setError(null);
    setTarget(next);
  }

  return (
    <>
      <button
        type="button"
        onClick={openControl}
        className={`flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-semibold transition active:scale-[0.97] ${meta.chip} ${meta.text}`}
        aria-label={
          language === 'hi'
            ? `कैंटीन स्थिति: ${meta.labelHi}. बदलने के लिए टैप करें।`
            : `Canteen status: ${meta.label}. Tap to change.`
        }
      >
        <span
          className={`h-2 w-2 rounded-full ${meta.dot} ${current !== 'open' ? 'animate-soft-pulse' : ''}`}
        />
        <span>{language === 'hi' ? meta.labelHi : meta.label}</span>
      </button>

      <Modal
        open={open}
        onClose={close}
        title={language === 'hi' ? 'कैंटीन स्थिति' : 'Canteen status'}
        subtitle={
          current === 'paused' && status?.reopen_at
            ? language === 'hi'
              ? `अभी रुका हुआ — फिर से खुलने का समय ${formatTime(status.reopen_at)}`
              : `Currently paused — reopens at ${formatTime(status.reopen_at)}`
            : language === 'hi'
              ? `अभी ${meta.labelHi}`
              : `Currently ${meta.label.toLowerCase()}`
        }
      >
        <div className="grid grid-cols-3 gap-2">
          {OPTIONS.map((opt) => {
            const m = STATE_META[opt];
            const active = target ? target === opt : current === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => pick(opt)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-sm font-semibold transition ${
                  active
                    ? `${m.chip} ${m.text} ring-2 ring-brand/40`
                    : 'border-edge bg-paper text-ink/60 hover:bg-ink/5'
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${m.dot}`} />
                <span className="mt-0.5">{language === 'hi' ? m.labelHi : m.label}</span>
              </button>
            );
          })}
        </div>

        {target && target !== current && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-edge bg-steel/20 p-3">
            {target === 'paused' && (
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-ink/70">
                  {language === 'hi' ? 'फिर से खुलने का समय' : 'Reopens at'}
                </span>
                <input
                  type="time"
                  value={reopenTime}
                  // A cleared native time input (the browser's own "x", or
                  // Backspace) fires onChange with "" — reopenTimeToISO("")
                  // would call Date#setHours(NaN, NaN, ...), producing an
                  // Invalid Date whose toISOString() throws inside the
                  // mutation. Falling back here, at the same boundary
                  // History.tsx's date stepper guards, keeps reopenTime
                  // always parseable.
                  onChange={(e) => setReopenTime(e.target.value || defaultReopenTime())}
                  className="min-h-[44px] w-full rounded-xl border border-edge bg-paper px-3 text-base focus:border-brand"
                />
                <span className="mt-1 block text-xs text-ink/50">
                  {language === 'hi' ? (
                    <>छात्र देखेंगे: “On a break — reopens at {reopenTime}”।</>
                  ) : (
                    <>Students see “On a break — reopens at {reopenTime}”.</>
                  )}
                </span>
              </label>
            )}
            {target === 'closed' && (
              <p className="text-sm text-ink/70">
                {language === 'hi' ? (
                  <>छात्र देखेंगे: “The canteen is closed.” फिर से खोलने तक कोई नया ऑर्डर नहीं।</>
                ) : (
                  <>Students see “The canteen is closed.” No new orders until you reopen.</>
                )}
              </p>
            )}
            {target === 'open' && (
              <p className="text-sm text-ink/70">
                {language === 'hi'
                  ? 'छात्र फिर से ऑर्डर कर सकते हैं। पहले अपने मेन्यू और स्टॉक की समीक्षा कर लें।'
                  : 'Students can order again. Take a moment to review your menu and stock first.'}
              </p>
            )}

            {(target === 'paused' || target === 'closed') && (
              <p className="text-xs text-ink/50">
                {language === 'hi'
                  ? 'लंबित ऑर्डर स्वतः अस्वीकार हो जाएंगे। पहले से स्वीकृत ऑर्डर पूरे करने होंगे या रद्द करने होंगे।'
                  : 'Pending orders will be automatically declined. Already-accepted orders must be finished or cancelled first.'}
              </p>
            )}

            {error && (
              <div className="rounded-lg border border-stamp/40 bg-stamp-light px-3 py-2 text-sm font-medium text-stamp-dark">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="ghost" className="flex-1" onClick={close}>
                {language === 'hi' ? 'रद्द करें' : 'Cancel'}
              </Button>
              <Button
                type="button"
                variant={target === 'open' ? 'primary' : 'danger'}
                className="flex-1"
                loading={mutation.isPending}
                onClick={() => mutation.mutate(target)}
              >
                <span>
                  {language === 'hi'
                    ? target === 'open'
                      ? 'खुला'
                      : target === 'paused'
                        ? 'रुका हुआ'
                        : 'बंद'
                    : target === 'open'
                      ? 'Reopen'
                      : target === 'paused'
                        ? 'Pause'
                        : 'Close'}
                </span>
              </Button>
            </div>
          </div>
        )}

        {target && target === current && (
          <div className="mt-4 rounded-xl border border-edge bg-steel/30 px-4 py-3 text-center text-sm text-ink/50">
            {language === 'hi'
              ? `पहले से ही ${STATE_META[current].labelHi} है।`
              : `Already ${STATE_META[current].label.toLowerCase()}.`}
          </div>
        )}
      </Modal>
    </>
  );
}
