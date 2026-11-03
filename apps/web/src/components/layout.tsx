import { Suspense, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Bell, BarChart3, Boxes, Building2, ClipboardList, CreditCard, FileClock, Headset, LayoutDashboard, LogOut, Menu, Package, PackagePlus,
  Settings, ShoppingCart, Store, Truck, UserCircle, Users, Wrench, X, Laptop, ListChecks,
} from 'lucide-react';
import type { PermissionCode } from '@dante/shared';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useSettings } from '../lib/settings';
import type { Cart, NotificationItem } from '../lib/types';
import { Spinner } from './ui';

export function Logo({ dark = false }: { dark?: boolean }) {
  const { data } = useSettings();
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="Home">
      <img src="/favicon.svg" alt="" className="size-9" />
      <span className={clsx('font-display text-lg leading-tight font-semibold', dark ? 'text-white' : 'text-ink-900')}>
        {(data?.businessName ?? 'Dante Smart Remote Repairs').split(' ').slice(0, 2).join(' ')}
        <span className={clsx('block text-[11px] font-medium tracking-[0.18em] uppercase', dark ? 'text-brand-400' : 'text-brand-700')}>Remote Repairs</span>
      </span>
    </Link>
  );
}

function useUnreadCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: NotificationItem[]; unreadCount: number }>('/notifications'),
    enabled: !!user,
    refetchInterval: 60_000,
  });
}

function NotificationBell({ to }: { to: string }) {
  const { data } = useUnreadCount();
  const n = data?.unreadCount ?? 0;
  return (
    <Link to={to} className="relative rounded-xl p-2 text-current hover:bg-black/5" aria-label={`Notifications${n ? `, ${n} unread` : ''}`}>
      <Bell className="size-5" />
      {n > 0 && <span className="absolute -top-0.5 -right-0.5 flex min-w-5 justify-center rounded-full bg-spark-500 px-1 text-[11px] font-bold text-ink-950">{n > 99 ? '99+' : n}</span>}
    </Link>
  );
}

function CartLink() {
  const { isCustomer } = useAuth();
  const { data } = useQuery({ queryKey: ['cart'], queryFn: () => api<Cart>('/cart'), enabled: isCustomer });
  return (
    <Link to="/cart" className="relative rounded-xl p-2 hover:bg-black/5" aria-label={`Cart${data?.itemCount ? `, ${data.itemCount} items` : ''}`}>
      <ShoppingCart className="size-5" />
      {!!data?.itemCount && <span className="absolute -top-0.5 -right-0.5 flex min-w-5 justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">{data.itemCount}</span>}
    </Link>
  );
}

/* ---------------- public & customer shell ---------------- */

export function PublicLayout() {
  const { user, isStaff, logout } = useAuth();
  const { data: settings } = useSettings();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const nav = [
    { to: '/support', label: 'ICT support' },
    { to: '/shop', label: 'Shop' },
    { to: '/#how-it-works', label: 'How it works' },
    { to: '/#contact', label: 'Contact' },
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-lg focus:bg-white focus:p-2">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-ink-100/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => clsx('rounded-lg px-3 py-2 text-sm font-medium', isActive && !n.to.includes('#') ? 'text-brand-700' : 'text-ink-800 hover:text-ink-950')}>{n.label}</NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1 text-ink-800">
            {(!user || !isStaff) && <CartLink />}
            {user && <NotificationBell to={isStaff ? '/staff/notifications' : '/account/notifications'} />}
            {user ? (
              <div className="hidden items-center gap-1 sm:flex">
                <Link to={isStaff ? '/staff' : '/account'} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold hover:bg-ink-100/60">
                  <UserCircle className="size-5" /> {isStaff ? 'Staff portal' : 'My account'}
                </Link>
                <button onClick={async () => { await logout(); navigate('/'); }} className="rounded-xl p-2 hover:bg-ink-100/60" aria-label="Sign out"><LogOut className="size-5" /></button>
              </div>
            ) : (
              <div className="hidden gap-2 sm:flex">
                <Link to="/login" className="rounded-xl px-3 py-2 text-sm font-semibold hover:bg-ink-100/60">Sign in</Link>
                <Link to="/register" className="rounded-xl bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800">Create account</Link>
              </div>
            )}
            <button className="rounded-xl p-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu">{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-ink-100 bg-white px-4 py-3 md:hidden" aria-label="Mobile">
            {nav.map((n) => <Link key={n.to} to={n.to} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 font-medium">{n.label}</Link>)}
            {user ? (
              <>
                <Link to={isStaff ? '/staff' : '/account'} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 font-medium">{isStaff ? 'Staff portal' : 'My account'}</Link>
                <button onClick={async () => { setOpen(false); await logout(); navigate('/'); }} className="block w-full rounded-lg px-3 py-2.5 text-left font-medium">Sign out</button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 font-medium">Sign in</Link>
                <Link to="/register" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 font-medium">Create account</Link>
              </>
            )}
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">
        <Suspense fallback={<Spinner />}><Outlet /></Suspense>
      </main>
      <footer id="contact" className="mt-16 bg-ink-900 text-ink-100">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-3 sm:px-6">
          <div><Logo dark /><p className="mt-3 text-sm text-ink-100/70">ICT support, remote assistance, hardware repairs and IT products for individuals and organisations.</p></div>
          <div className="text-sm">
            <h2 className="mb-2 font-display font-semibold text-white">Contact</h2>
            <p>{settings?.contactPhone}</p>
            <p><a className="hover:text-white" href={`mailto:${settings?.contactEmail}`}>{settings?.contactEmail}</a></p>
            <p className="mt-1 text-ink-100/70">{settings?.contactAddress}</p>
            <p className="mt-1 text-ink-100/70">{settings?.supportHours}</p>
          </div>
          <div className="text-sm">
            <h2 className="mb-2 font-display font-semibold text-white">Customers</h2>
            <ul className="space-y-1">
              <li><Link to="/support/new" className="hover:text-white">Request ICT support</Link></li>
              <li><Link to="/shop" className="hover:text-white">Shop IT products</Link></li>
              <li><Link to="/legal/terms" className="hover:text-white">Terms of service</Link></li>
              <li><Link to="/legal/privacy" className="hover:text-white">Privacy notice</Link></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function AccountLayout() {
  const { user } = useAuth();
  const items = [
    { to: '/account', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/account/requests', label: 'My requests', icon: Headset },
    { to: '/support/new', label: 'New request', icon: PackagePlus },
    { to: '/account/orders', label: 'Orders', icon: Package },
    { to: '/account/devices', label: 'Devices', icon: Laptop },
    ...(user?.organization ? [{ to: '/account/organization', label: 'Organisation', icon: Building2 }] : []),
    { to: '/account/payments', label: 'Payments', icon: CreditCard },
    { to: '/account/notifications', label: 'Notifications', icon: Bell },
    { to: '/account/profile', label: 'Profile & security', icon: UserCircle },
  ];
  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[230px_1fr] lg:py-10">
      <nav aria-label="Account" className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end}
            className={({ isActive }) => clsx('flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap', isActive ? 'bg-white text-ink-900 shadow-card' : 'text-slate-600 hover:bg-white/70')}>
            <i.icon className="size-4" aria-hidden /> {i.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0"><Outlet /></div>
    </div>
  );
}

/* ---------------- staff shell ---------------- */

interface StaffNavItem {
  to: string;
  label: string;
  icon: typeof Bell;
  perms: PermissionCode[];
  end?: boolean;
}
const STAFF_NAV: { section: string; items: StaffNavItem[] }[] = [
  { section: 'Operations', items: [
    { to: '/staff', label: 'Dashboard', icon: LayoutDashboard, perms: [], end: true },
    { to: '/staff/requests', label: 'Service requests', icon: Headset, perms: ['requests.view_all', 'requests.work'] },
    { to: '/staff/technicians', label: 'Technicians', icon: Wrench, perms: ['requests.assign', 'technicians.performance'] },
  ] },
  { section: 'Store', items: [
    { to: '/staff/orders', label: 'Orders', icon: Truck, perms: ['orders.view_all'] },
    { to: '/staff/products', label: 'Products', icon: Store, perms: ['products.manage'] },
    { to: '/staff/inventory', label: 'Inventory', icon: Boxes, perms: ['inventory.view'] },
    { to: '/staff/purchasing', label: 'Purchasing', icon: ClipboardList, perms: ['purchasing.manage', 'suppliers.manage'] },
  ] },
  { section: 'Finance', items: [{ to: '/staff/payments', label: 'Payments', icon: CreditCard, perms: ['payments.view'] }] },
  { section: 'People', items: [
    { to: '/staff/customers', label: 'Customers', icon: Users, perms: ['customers.view'] },
    { to: '/staff/organizations', label: 'Organisations', icon: Building2, perms: ['organizations.manage', 'customers.view'] },
    { to: '/staff/team', label: 'Staff accounts', icon: ListChecks, perms: ['users.manage'] },
  ] },
  { section: 'Insight & admin', items: [
    { to: '/staff/reports', label: 'Reports', icon: BarChart3, perms: ['reports.operational', 'reports.financial', 'reports.inventory'] },
    { to: '/staff/audit', label: 'Audit log', icon: FileClock, perms: ['audit.view'] },
    { to: '/staff/settings', label: 'Settings', icon: Settings, perms: ['settings.manage', 'categories.manage'] },
  ] },
];

export function StaffLayout() {
  const { user, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const sidebar = (
    <nav aria-label="Staff" className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-5">
      <div className="px-2"><Logo dark /></div>
      {STAFF_NAV.map((s) => {
        const visible = s.items.filter((i) => i.perms.length === 0 || can(...i.perms));
        if (!visible.length) return null;
        return (
          <div key={s.section}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.14em] text-ink-100/50 uppercase">{s.section}</p>
            {visible.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} onClick={() => setOpen(false)}
                className={({ isActive }) => clsx('flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium', isActive ? 'bg-white/10 text-white' : 'text-ink-100/75 hover:bg-white/5 hover:text-white')}>
                <i.icon className="size-4" aria-hidden /> {i.label}
              </NavLink>
            ))}
          </div>
        );
      })}
      <div className="mt-auto border-t border-white/10 px-3 pt-4 text-sm text-ink-100/80">
        <p className="font-semibold text-white">{user?.firstName} {user?.lastName}</p>
        <p className="text-xs">{user?.roles.map((r) => r.replace('_', ' ').toLowerCase()).join(', ')}</p>
        <button onClick={async () => { await logout(); navigate('/login'); }} className="mt-3 flex items-center gap-2 text-ink-100/80 hover:text-white"><LogOut className="size-4" /> Sign out</button>
      </div>
    </nav>
  );
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="hidden bg-ink-900 lg:sticky lg:top-0 lg:block lg:h-dvh">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-ink-900">{sidebar}</aside>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-ink-100 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button className="rounded-xl p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <p className="hidden text-sm font-medium text-slate-500 lg:block">Staff portal</p>
          <div className="flex items-center gap-1 text-ink-800">
            <NotificationBell to="/staff/notifications" />
            <Link to="/" className="rounded-xl px-3 py-2 text-sm font-medium hover:bg-ink-100/60">View site</Link>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          <Suspense fallback={<Spinner />}><Outlet /></Suspense>
        </main>
      </div>
    </div>
  );
}

/** Route guard. `staff` routes need a staff account; `customer` routes need the CUSTOMER role. */
export function RequireAuth({ kind, children }: { kind?: 'staff' | 'customer'; children: ReactNode }) {
  const { user, ready, isStaff, isCustomer } = useAuth();
  const location = useLocation();
  if (!ready) return <Spinner label="Checking your session…" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  const profile = isStaff ? '/staff/profile' : '/account/profile';
  if (user.mustChangePassword && location.pathname !== profile) return <Navigate to={`${profile}?mustChange=1`} replace />;
  if (kind === 'staff' && !isStaff) return <Navigate to="/account" replace />;
  if (kind === 'customer' && !isCustomer) return <Navigate to="/staff" replace />;
  return <>{children}</>;
}
