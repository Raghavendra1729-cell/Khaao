import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { getActiveOrder } from '../api/orders';
import { getPrep, getShopOrders } from '../api/shop';
import { StudentRealtime } from './StudentRealtime';
import { ShopRealtime } from './ShopRealtime';

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
  ticket: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM14 6v12',
  inbox: 'M4 13l2-7h12l2 7M4 13v5h16v-5M4 13h5a3 3 0 0 0 6 0h5',
  flame: 'M12 3c1 3-3 4.5-3 8a3 3 0 0 0 6 0c0-1.5-.8-2.5-.8-2.5C16.5 9.5 18 11 18 13.5A6 6 0 0 1 6 13.5C6 8.5 10.5 7 12 3z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  tag: 'M4 4h7l9 9-7 7-9-9zM8.5 8.5h0',
};

interface Tab {
  to: string;
  label: string;
  end: boolean;
  icon: keyof typeof ICONS;
}

const STUDENT_TABS: Tab[] = [
  { to: '/', label: 'Menu', end: true, icon: 'menu' },
  { to: '/order', label: 'Order', end: false, icon: 'ticket' },
];

const SHOP_TABS: Tab[] = [
  { to: '/shop', label: 'Orders', end: true, icon: 'inbox' },
  { to: '/shop/prep', label: 'Prep', end: false, icon: 'flame' },
  { to: '/shop/history', label: 'History', end: false, icon: 'clock' },
  { to: '/shop/menu', label: 'Menu', end: false, icon: 'tag' },
];

function TabBadge({ children }: { children: ReactNode }) {
  return (
    <span className="absolute -right-2.5 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-turmeric px-1 text-[10px] font-bold text-white">
      {children}
    </span>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const isShop = user?.role === 'shopkeeper';
  const tabs = isShop ? SHOP_TABS : STUDENT_TABS;
  // Students use this on a phone: a narrow single-column shell fits perfectly.
  // Shopkeepers run a multi-column kanban board (Orders) and grids (Prep,
  // History, Menu) meant for a counter tablet/laptop — max-w-md (28rem) was
  // capping them to phone width even on a wide screen, squeezing the "New"
  // column's Accept button until it visually overlapped "Cooking".
  const contentMaxWidth = isShop ? 'max-w-6xl' : 'max-w-md';

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
      {!isShop && <StudentRealtime />}
      {isShop && <ShopRealtime />}

      <header className="sticky top-0 z-20 border-b border-edge bg-steel/95 pt-safe backdrop-blur">
        <div className={`mx-auto flex h-14 ${contentMaxWidth} items-center justify-between px-4`}>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border-2 border-ink bg-paper font-display text-sm font-bold text-ink">
              K
            </span>
            <span className="font-display text-lg font-bold uppercase tracking-[0.15em] text-ink">
              Khaao
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="max-w-[9rem] truncate text-sm text-ink/60">{user?.name}</span>
            <button
              type="button"
              onClick={logout}
              className="flex min-h-[44px] items-center rounded-lg px-2.5 text-sm font-semibold text-ink/70 transition hover:bg-ink/5 hover:text-ink"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className={`mx-auto w-full ${contentMaxWidth} flex-1 px-4 pb-24 pt-4`}>
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-paper/95 pb-safe shadow-bar backdrop-blur">
        <div className={`mx-auto grid ${contentMaxWidth} ${isShop ? 'grid-cols-4' : 'grid-cols-2'}`}>
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
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
