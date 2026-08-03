import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { GetTheApp } from '../components/settings/GetTheApp';
import { NotificationSettings } from '../components/settings/NotificationSettings';

// Vite replaces this at build time; the typeof guard keeps direct Vitest and
// other non-Vite module execution honest rather than crashing Settings.
const buildId = typeof __KHAOO_BUILD_ID__ === 'string' ? __KHAOO_BUILD_ID__ : 'local';

/**
 * Settings — reachable from AvatarMenu, available to both roles (STATUS.md
 * § 9.7 P1). Lazy-loaded as its own chunk via App.tsx's route-group `lazy()`
 * pattern, so it never lands in the student's initial bundle.
 */
export function SettingsPage() {
  const { user, logout } = useAuth();
  const { language } = useLanguage();
  const isShop = user?.role === 'shopkeeper';
  const showHindi = isShop && language === 'hi';

  return (
    <div className="flex flex-col gap-6 pb-4">
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
        {showHindi ? 'सेटिंग्स' : 'Settings'}
      </h1>

      <Card className="p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-ink">
          {showHindi ? 'ऐप डाउनलोड करें' : 'Get the app'}
        </h2>
        <GetTheApp isShop={isShop} />
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-ink">
          {showHindi ? 'सूचनाएं' : 'Notifications'}
        </h2>
        <NotificationSettings isShop={isShop} />
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-display text-lg font-bold text-ink">{showHindi ? 'खाता' : 'Account'}</h2>
        <dl className="flex flex-col gap-2.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink/50">{showHindi ? 'नाम' : 'Name'}</dt>
            <dd className="min-w-0 truncate font-medium text-ink">{user?.name}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink/50">{showHindi ? 'ईमेल' : 'Email'}</dt>
            <dd className="min-w-0 truncate font-medium text-ink">{user?.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink/50">{showHindi ? 'भूमिका' : 'Role'}</dt>
            <dd className="font-medium capitalize text-ink">
              {user?.role === 'shopkeeper' ? (showHindi ? 'दुकानदार' : 'Shopkeeper') : 'Student'}
            </dd>
          </div>
        </dl>
        <Button type="button" variant="secondary" fullWidth className="mt-4" onClick={logout}>
          {showHindi ? 'लॉग आउट' : 'Log out'}
        </Button>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 font-display text-lg font-bold text-ink">
          {showHindi ? 'Khaao के बारे में' : 'About Khaao'}
        </h2>
        <div className="flex flex-col gap-2 text-sm text-ink/70">
          <p>
            {showHindi
              ? 'Khaao कैंटीन के लिए पहले से ऑर्डर करने और टोकन के साथ पिक-अप करने का तरीका है।'
              : 'Khaao lets you order from the canteen ahead and pick up with a token.'}
          </p>
          <p>
            {showHindi
              ? 'हम आपके खाते, ऑर्डर और आइटम की जानकारी दिखाते हैं ताकि कैंटीन आपका ऑर्डर तैयार और पूरा कर सके।'
              : 'Your account, order, and item details are used to prepare your order and show its live status.'}
          </p>
          <p className="font-medium text-ink">
            {showHindi
              ? 'भुगतान हमेशा काउंटर पर होता है — Khaao कभी भी ऐप में भुगतान नहीं मांगेगा।'
              : 'Payment is always at the counter — Khaao will never ask you to pay in the app.'}
          </p>
          <p className="text-xs text-ink/50">
            {showHindi
              ? 'मदद चाहिए? अपनी कैंटीन टीम से उनके सामान्य सहायता माध्यम से बात करें।'
              : 'Need help? Contact your canteen team through their usual support channel.'}
          </p>
        </div>
      </Card>

      <p className="pb-safe text-center font-display text-[11px] text-ink/40">Build {buildId}</p>
    </div>
  );
}
