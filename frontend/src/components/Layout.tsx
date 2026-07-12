import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { StudentRealtime } from './StudentRealtime';
import { ShopRealtime } from './ShopRealtime';

const STUDENT_LINKS = [
  { to: '/', label: 'Menu', end: true },
  { to: '/order', label: 'Order status', end: false },
];

const SHOP_LINKS = [
  { to: '/shop', label: 'Orders', end: true },
  { to: '/shop/prep', label: 'Prep', end: false },
  { to: '/shop/menu', label: 'Menu', end: false },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold transition ${
    isActive ? 'bg-brand-light text-brand-dark' : 'text-ink/70 hover:bg-black/5 hover:text-ink'
  }`;

export function Layout() {
  const { user, logout } = useAuth();
  const links = user?.role === 'shopkeeper' ? SHOP_LINKS : STUDENT_LINKS;

  return (
    <div className="flex min-h-screen flex-col bg-cream">
      {user?.role === 'student' && <StudentRealtime />}
      {user?.role === 'shopkeeper' && <ShopRealtime />}

      <header className="sticky top-0 z-20 border-b border-sage bg-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-black text-white">
              K
            </span>
            <span className="text-lg font-black tracking-tight text-brand-dark">Khaao</span>
          </div>

          <nav className="flex items-center gap-1">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={navLinkClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-ink/60 sm:inline">{user?.name}</span>
            <button
              type="button"
              onClick={logout}
              className="flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold text-ink/70 transition hover:bg-black/5 hover:text-ink"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
