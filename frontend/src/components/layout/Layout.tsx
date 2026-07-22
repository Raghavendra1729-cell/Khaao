import type { ReactNode } from 'react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { LanguageProvider, useLanguage } from '../../context/LanguageContext';
import { getActiveOrder } from '../../api/orders';
import { getPrep, getShopOrders } from '../../api/shop';
import { StudentRealtime } from '../student/StudentRealtime';
import { ShopRealtime } from '../shop/ShopRealtime';
import { ShopStatusControl } from '../shop/ShopStatusControl';
import { useShopNotification, clearShopNotification } from '../../lib/shopNotifications';
import { InstallPrompt } from './InstallPrompt';
import { PushNotificationSetup } from './PushNotificationSetup';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { FullPageSpinner } from '../ui/Spinner';
import { useLiveAnnouncement } from '../../lib/liveAnnouncer';

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

// Simple single-path icons keep the bar light; shapes echo what each tab does.
const ICONS = {
  menu: 'M4 5h7v7H4zM13 5h7v7h-7zM4 15h7v5H4zM13 15h7v5h-7z',
  ticket:
    'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM14 6v12',
  inbox: 'M4 13l2-7h12l2 7M4 13v5h16v-5M4 13h5a3 3 0 0 0 6 0h5',
  flame:
    'M12 3c1 3-3 4.5-3 8a3 3 0 0 0 6 0c0-1.5-.8-2.5-.8-2.5C16.5 9.5 18 11 18 13.5A6 6 0 0 1 6 13.5C6 8.5 10.5 7 12 3z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  tag: 'M4 4h7l9 9-7 7-9-9zM8.5 8.5h0',
};

interface Tab {
  to: string;
  label: string;
  labelHi?: string;
  end: boolean;
  icon: keyof typeof ICONS;
}

const STUDENT_TABS: Tab[] = [
  { to: '/', label: 'Menu', end: true, icon: 'menu' },
  { to: '/order', label: 'Order', end: false, icon: 'ticket' },
];

const SHOP_TABS: Tab[] = [
  { to: '/shop', label: 'Orders', labelHi: 'ऑर्डर', end: true, icon: 'inbox' },
  { to: '/shop/prep', label: 'Prep', labelHi: 'तैयारी', end: false, icon: 'flame' },
  { to: '/shop/history', label: 'History', labelHi: 'इतिहास', end: false, icon: 'clock' },
  { to: '/shop/menu', label: 'Menu', labelHi: 'मेन्यू', end: false, icon: 'tag' },
];

function TabBadge({ children }: { children: ReactNode }) {
  return (
    <span className="absolute -right-2.5 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-turmeric px-1 text-[10px] font-bold text-white">
      {children}
    </span>
  );
}

/** Bell icon for the shop notification dot. */
function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/**
 * Reads the notification dot state and clears it automatically when the
 * shopkeeper is on the Orders page (/shop exact match).
 */
function ShopBell() {
  const hasNotification = useShopNotification();
  const location = useLocation();
  const isOnOrders = location.pathname === '/shop';

  useEffect(() => {
    if (isOnOrders && hasNotification) {
      clearShopNotification();
    }
  }, [isOnOrders, hasNotification]);

  return (
    <div
      className="relative flex items-center"
      aria-label={hasNotification ? 'New activity — tap Orders to view' : undefined}
    >
      <BellIcon />
      {hasNotification && (
        <span
          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-turmeric ring-2 ring-paper"
          aria-hidden
        />
      )}
    </div>
  );
}

/**
 * Compact segmented EN/हिं toggle for the shop header. Shopkeeper-only —
 * never rendered for students (gated by the caller), so there's no risk of
 * a stored 'hi' preference leaking Hindi into a student session.
 */
function LanguageToggle() {
  const { language, toggleLanguage } = useLanguage();
  return (
    <button
      type="button"
      onClick={toggleLanguage}
      aria-label={language === 'en' ? 'Switch UI language to Hindi' : 'यूआई भाषा अंग्रेज़ी में बदलें'}
      className="flex h-8 items-center rounded-full border border-ink/15 bg-ink/5 p-0.5 text-[11px] font-bold"
    >
      <span
        className={`rounded-full px-2 py-1 leading-none transition ${
          language === 'en' ? 'bg-paper text-ink shadow-sm' : 'text-ink/40'
        }`}
      >
        EN
      </span>
      <span
        className={`rounded-full px-2 py-1 leading-none transition ${
          language === 'hi' ? 'bg-paper text-ink shadow-sm' : 'text-ink/40'
        }`}
      >
        हिं
      </span>
    </button>
  );
}

/**
 * Avatar button (shows first initial of the user's name) that opens a small
 * dropdown with the full name and a Log out action. Closes on outside click or
 * Escape. Width on screen: 36×36px — well within the mobile header budget.
 *
 * isShop gates Hindi explicitly (not just the language value) — this
 * component is shared with students, and the language preference persists
 * in localStorage, so without this guard a shopkeeper switching to Hindi on
 * a shared device could leak Hindi into a student's session too.
 */
function AvatarMenu({ name, onLogout, isShop }: { name: string; onLogout: () => void; isShop: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const { language } = useLanguage();
  const showHindi = isShop && language === 'hi';

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        id="avatar-menu-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink/20 bg-ink/10 font-display text-sm font-bold text-ink transition hover:bg-ink/15 active:scale-95"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 min-w-[160px] rounded-xl border border-edge bg-paper shadow-ticket"
        >
          {/* Full name — read-only label */}
          <div className="border-b border-edge px-4 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">Signed in as</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-ink">{name}</p>
          </div>
          {/* Logout action */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex w-full min-h-[44px] items-center px-4 py-2.5 text-sm font-semibold text-stamp-dark transition hover:bg-stamp-light/60 rounded-b-xl"
          >
            <span>{showHindi ? 'लॉग आउट' : 'Log out'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Visually-hidden aria-live region (G7) — the screen-reader counterpart to
 * the chime/vibration/stamp path. Fed by lib/liveAnnouncer.ts; a trailing
 * zero-width space alternates by `key` so even an identical consecutive
 * announcement still registers as a DOM mutation.
 */
const ZERO_WIDTH_SPACE = String.fromCharCode(8203);

function LiveRegion() {
  const { message, key } = useLiveAnnouncement();
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
      {key % 2 === 1 ? ZERO_WIDTH_SPACE : ''}
    </div>
  );
}

export function Layout() {
  return (
    <LanguageProvider>
      <LayoutInner />
    </LanguageProvider>
  );
}

function LayoutInner() {
  const { user, logout } = useAuth();
  const { language } = useLanguage();
  const isOnline = useOnlineStatus();
  const isShop = user?.role === 'shopkeeper';

  // Gated by isShop, not just language — a shopkeeper's stored 'hi'
  // preference must never leak into a student session on a shared
  // device/browser (same guard AvatarMenu already applies to Hindi copy).
  useEffect(() => {
    document.documentElement.lang = isShop && language === 'hi' ? 'hi' : 'en';
  }, [isShop, language]);

  const tabs = isShop ? SHOP_TABS : STUDENT_TABS;
  // Students use this on a phone: a narrow single-column shell fits perfectly.
  // Shopkeepers are mobile-first (375-430px target) but also need to work on a
  // counter tablet — max-w-6xl gives room on wider screens without capping mobile.
  const contentMaxWidth = isShop ? 'max-w-6xl' : 'max-w-md';
  // The bottom nav bar itself stays full-bleed at any width (the `<nav>`
  // element below has no max-width), but its grid of tap targets is its own,
  // narrower concern: stretching 4 shop tabs across max-w-6xl on a
  // 768-1024px counter tablet spreads them into an uncomfortable thumb
  // reach, so the grid is capped independently of contentMaxWidth (F20).
  const navMaxWidth = 'max-w-md';

  // Badge data rides the same query keys the pages use, so SSE invalidation
  // keeps the bar live without extra plumbing.
  const activeOrderQuery = useQuery({
    queryKey: ['orders', 'active'],
    queryFn: getActiveOrder,
    enabled: !isShop,
  });
  const shopOrdersQuery = useQuery({
    queryKey: ['shop', 'orders'],
    queryFn: getShopOrders,
    enabled: isShop,
  });
  const prepQuery = useQuery({
    queryKey: ['shop', 'prep'],
    queryFn: getPrep,
    enabled: isShop,
  });

  const incomingCount = shopOrdersQuery.data?.incoming.length ?? 0;
  const prepBacklogCount = prepQuery.data?.filter((item) => item.remaining_qty > 0).length ?? 0;
  const hasActiveOrder = !isShop && Boolean(activeOrderQuery.data);

  return (
    <div className="flex min-h-screen flex-col bg-steel">
      <LiveRegion />
      {!isShop && <StudentRealtime />}
      {isShop && <ShopRealtime />}

      <header className="sticky top-0 z-20 border-b border-edge bg-steel/95 pt-safe backdrop-blur">
        <div className={`mx-auto flex h-14 ${contentMaxWidth} items-center justify-between px-4`}>
          {/* Left: K mark only on mobile — wordmark hidden to preserve header space */}
          <div className="flex shrink-0 items-center">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border-2 border-ink bg-paper font-display text-sm font-bold text-ink">
              K
            </span>
            {/* Wordmark shown only when there's room (md breakpoint and above) */}
            <span className="ml-2 hidden font-display text-lg font-bold uppercase tracking-[0.15em] text-ink md:block">
              Khaao
            </span>
          </div>

          {/* Right cluster: language toggle + status pill + bell (shop only) + avatar — must not wrap at 375px */}
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Hindi/English toggle — shopkeeper only */}
            {isShop && <LanguageToggle />}
            {/* Shop status pill — highest-stakes control, always visible for shopkeepers */}
            {isShop && <ShopStatusControl />}
            {/* Notification bell — always visible for shopkeepers */}
            {isShop && (
              <span className="flex items-center px-0.5">
                <ShopBell />
              </span>
            )}
            {/* Avatar + name/logout collapsed into a single 36px button */}
            <AvatarMenu name={user?.name ?? ''} onLogout={logout} isShop={isShop} />
          </div>
        </div>
      </header>

      {!isOnline && (
        <div className="bg-turmeric-deep px-4 py-1.5 text-center text-xs font-semibold text-white">
          You're offline — reconnecting…
        </div>
      )}

      <main className={`mx-auto w-full ${contentMaxWidth} flex-1 px-4 pb-24 pt-4`}>
        <Suspense fallback={<FullPageSpinner />}>
          <Outlet />
        </Suspense>
      </main>

      <InstallPrompt />
      <PushNotificationSetup isShop={isShop} />

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-paper/95 pb-safe shadow-bar backdrop-blur">
        <div className={`mx-auto grid ${navMaxWidth} ${isShop ? 'grid-cols-4' : 'grid-cols-2'}`}>
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                  isActive ? 'text-brand-dark' : 'text-ink/45 hover:text-ink/70'
                }`
              }
            >
              <span className="relative">
                <Icon d={ICONS[tab.icon]} />
                {tab.icon === 'inbox' && incomingCount > 0 && <TabBadge>{incomingCount}</TabBadge>}
                {tab.icon === 'flame' && prepBacklogCount > 0 && <TabBadge>{prepBacklogCount}</TabBadge>}
                {tab.icon === 'ticket' && hasActiveOrder && (
                  <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-turmeric" />
                )}
              </span>
              <span className="mt-0.5">{tab.labelHi && language === 'hi' ? tab.labelHi : tab.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
