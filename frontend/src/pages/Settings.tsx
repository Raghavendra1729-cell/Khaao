import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { GetTheApp } from '../components/settings/GetTheApp';
import { NotificationSettings } from '../components/settings/NotificationSettings';

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
        {/* TODO(STATUS.md § 9.10-S3): who runs Khaao, what it stores, and the
            "we will never ask you to pay in the app" line belong here. Not
            implemented — do not fabricate operator/contact/data-handling
            claims; that's this task's own explicit warning. */}
        <p className="text-sm text-ink/40">{showHindi ? 'जल्द आ रहा है।' : 'Coming soon.'}</p>
      </Card>

      {/* TODO(STATUS.md § 9.10-S4): build identity (short git SHA + build
          timestamp, injected via Vite `define`) belongs here as small mono
          footer text. Not implemented — do not fabricate a version string. */}
    </div>
  );
}
