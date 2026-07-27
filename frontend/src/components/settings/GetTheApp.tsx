import { useLanguage } from '../../context/LanguageContext';
import { Button } from '../ui/Button';
import { useInstallState } from '../../lib/install';

interface GetTheAppProps {
  /** Gates Hindi copy explicitly, matching AvatarMenu/PushNotificationSetup —
   * a shopkeeper's stored 'hi' preference must never leak into a student
   * session on a shared device. */
  isShop: boolean;
}

/** iOS's own Share glyph, drawn as an inline path — never an emoji (STATUS.md
 * § 9.2). An upward arrow leaving an open-top tray, matching the system icon
 * students already recognize from every other app's share sheet. */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink/10 font-display text-xs font-bold text-ink">
      {n}
    </span>
  );
}

/**
 * "Get the app" — Settings' always-available download surface (STATUS.md
 * § 9.7 P2). The one-shot InstallPrompt bottom sheet is the nudge; this is
 * the permanent path a student can always come back to, no matter how many
 * times they've dismissed the nudge or discarded a native prompt event.
 */
export function GetTheApp({ isShop }: GetTheAppProps) {
  const { language } = useLanguage();
  const showHindi = isShop && language === 'hi';
  const state = useInstallState();

  const benefitLine = showHindi
    ? 'होम स्क्रीन से खुलता है, कमज़ोर वाई-फाई पर भी चलता है, और बताता है कि खाना कब तैयार है।'
    : "Opens from your home screen, works on patchy Wi-Fi, and tells you when your food's ready.";

  return (
    <div className="flex flex-col gap-3">
      {state.kind === 'installed' && (
        <div className="flex items-center gap-2 py-1">
          <span className="-rotate-3 inline-flex items-center justify-center whitespace-nowrap rounded-full border-2 border-brand-dark bg-brand-dark/10 px-4 py-2 font-display text-sm font-bold uppercase tracking-wider text-brand-dark">
            {showHindi ? 'इंस्टॉल हो गया' : 'Installed'}
          </span>
        </div>
      )}

      {state.kind === 'promptable' && (
        <>
          <p className="text-sm text-ink/70">{benefitLine}</p>
          <Button type="button" onClick={() => void state.prompt()} fullWidth>
            {showHindi ? 'Khaao डाउनलोड करें' : 'Download Khaao'}
          </Button>
        </>
      )}

      {state.kind === 'ios-manual' && (
        <>
          <p className="text-sm text-ink/70">{benefitLine}</p>
          <ol className="flex flex-col gap-2.5">
            <li className="flex items-center gap-2.5 text-sm text-ink">
              <StepNumber n={1} />
              <span className="flex items-center gap-1.5">
                {showHindi ? 'टैप करें' : 'Tap'}
                <ShareIcon />
                <span className="font-semibold">Share</span>
              </span>
            </li>
            <li className="flex items-center gap-2.5 text-sm text-ink">
              <StepNumber n={2} />
              <span>
                {showHindi ? 'फिर टैप करें' : 'Then tap'}{' '}
                <span className="font-semibold">"Add to Home Screen"</span>
              </span>
            </li>
          </ol>
        </>
      )}

      {state.kind === 'unsupported' && (
        <p className="text-sm text-ink/70">
          {showHindi
            ? 'अपने फ़ोन पर यह साइट Chrome या Safari में खोलें ऐप डाउनलोड करने के लिए।'
            : 'Open this site in Chrome or Safari on your phone to download the app.'}
        </p>
      )}
    </div>
  );
}
