'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import dashboardStyles from '@/components/staff/SuperAdminDashboard.module.css';
import overviewStyles from '@/components/staff/OverviewDashboard.module.css';
import staffStyles from '@/components/staff/StaffDashboard.module.css';
import { Sidebar } from './Sidebar';
import { ScrollArea } from '@/components/ui/scroll';
import { clsx } from '@/lib/clsx';
import { Icon, Avatar } from '@/components/ui/primitives';
import type { NavItem } from '@/lib/rbac';

/**
 * The staff application chrome.
 *
 * Desktop is a fixed navy rail plus a soft command bar. Below `md` the rail
 * becomes a drawer behind the menu button, and that is the whole of the mobile
 * navigation — the five-tab bottom bar is gone. It cost 80px off the bottom of
 * every screen to reach four of the twelve sections, while the drawer beside it
 * reached all of them.
 */
export function StaffShell({
  user,
  nav,
  unreadCount = 0,
  showRecordSaving = true,
  children,
}: {
  user: { fullName: string; roleName: string; photoUrl: string | null; role?: string };
  nav: readonly NavItem[];
  unreadCount?: number;
  showRecordSaving?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const superAdminDashboard = user.role === 'super_admin' && pathname === '/staff/admin';
  const staffDashboard = (pathname === '/staff/admin' && !superAdminDashboard)
    || ['/staff/desk', '/staff/loans-desk', '/staff/finance', '/staff/savings/collect'].includes(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  // Desktop only. The rail collapses to an icon column so a wide register —
  // the ledger, the audit log — can have the 190px back. State lives on the
  // layout, so it survives moving between pages.
  const [railCollapsed, setRailCollapsed] = useState(false);

  return (
    <div className={clsx(
      'flex h-[100dvh] overflow-hidden bg-background text-on-background',
      superAdminDashboard && dashboardStyles.dashboard,
      pathname === '/staff' && overviewStyles.overview,
      staffDashboard && staffStyles.workspace,
    )}>
      <Sidebar
        items={nav}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        collapsed={railCollapsed}
      />

      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <header
          data-app-header
          className="z-30 shrink-0 border-b border-outline-variant bg-surface"
        >
          <div className="mx-auto flex h-16 w-full max-w-content items-center gap-2 px-container-margin-mobile md:h-[76px] md:gap-4 md:px-container-margin-desktop">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface md:hidden"
            >
              <Icon name="menu" size={22} />
            </button>

            {/* The same control on desktop collapses the rail rather than
                opening a drawer there is no room for. */}
            <button
              type="button"
              onClick={() => setRailCollapsed((v) => !v)}
              aria-label={railCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              aria-pressed={railCollapsed}
              className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface md:flex"
            >
              <Icon name="menu" size={22} />
            </button>

            <Link href="/staff" className="flex shrink-0 items-center gap-2 md:hidden">
              <Image
                src="/brand/bnd-logo.png"
                alt="Bakenye Unity and Development SACCO"
                width={32}
                height={32}
                priority
                className="h-8 w-8 object-contain"
              />
            </Link>

            {/* Global search. Hidden on the narrowest phones, where each list
                screen carries its own search field and the header space is
                better spent on the account controls. */}
            <div className="hidden min-w-0 flex-1 sm:flex md:max-w-xl">
              <GlobalSearch />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2.5">
              {showRecordSaving ? <Link
                href="/staff/savings/record"
                className="hidden items-center gap-2 rounded-full bg-ink px-5 py-3 text-button-text text-white shadow-neu-dark transition-colors hover:bg-ink-soft lg:inline-flex"
              >
                <Icon name="add" size={18} />
                Record saving
              </Link> : null}

              <Link
                href="/staff/notifications"
                aria-label={
                  unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
                }
                className="relative flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <Icon name="notifications" size={22} filled={false} />
                {unreadCount > 0 ? (
                  <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-on-error ring-2 ring-surface">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                ) : null}
              </Link>

              <AccountMenu user={user} showSettings={nav.some(item => item.href === '/staff/settings')} />
            </div>
          </div>
        </header>

        {/* `<main>` stays the landmark; the scrolling happens one level in so
            the pager can sit in the corner of the viewport. */}
        <main className="flex min-h-0 flex-1 flex-col">
          <ScrollArea
            stableGutter
            wrapperClassName="flex-1"
            className="p-container-margin-mobile md:p-container-margin-desktop"
          >
            <div className="mx-auto w-full max-w-content">{children}</div>
          </ScrollArea>
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function AccountMenu({
  user,
  showSettings,
}: {
  user: { fullName: string; roleName: string; photoUrl: string | null };
  showSettings: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Close on Escape and on any click outside — a dropdown that can only be
  // closed by clicking the trigger again feels broken on touch.
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
      if (!ref.current?.contains(document.activeElement)) return;
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (!items.length) return;
      e.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        ref={trigger}
        type="button"
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={clsx(
          'flex items-center gap-2.5 rounded-full p-1 transition-colors md:pr-3',
          open ? 'bg-surface-container-high' : 'hover:bg-surface-container-high',
        )}
      >
        <Avatar name={user.fullName} src={user.photoUrl} size={40} />
        <span className="hidden max-w-[260px] text-left lg:block xl:max-w-[320px]">
          <span className="block truncate text-button-text font-bold uppercase leading-tight tracking-[0.01em] text-on-surface">
            {user.fullName}
          </span>
          <span className="block truncate text-label-md font-normal text-on-surface-variant">
            {user.roleName}
          </span>
        </span>
        <Icon
          name="expand_more"
          size={18}
          className={clsx(
            'hidden text-on-surface-variant transition-transform lg:block',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="scroll-panel absolute right-0 z-50 mt-2 max-h-[calc(100dvh-6rem)] w-64 animate-slide-up overflow-y-auto rounded-3xl bg-surface shadow-pop"
        >
          <div className="flex items-center gap-3 border-b border-outline-variant/70 bg-surface-container-low px-4 py-3.5">
            <Avatar name={user.fullName} src={user.photoUrl} size={40} />
            <div className="min-w-0">
              <p className="truncate text-button-text text-on-surface">{user.fullName}</p>
              <p className="text-label-md font-normal text-on-surface-variant">
                {user.roleName}
              </p>
            </div>
          </div>
          <div className="p-1.5">
            <MenuLink href="/staff/profile" icon="person" label="My profile" />
            <MenuLink href="/staff/profile#password" icon="lock" label="Change password" />
            {showSettings ? <MenuLink href="/staff/settings" icon="settings" label="Settings" /> : null}
          </div>
          <div className="border-t border-outline-variant/70 p-1.5">
            {/* A form posting to the server action, so the shell never pulls
                the Supabase browser SDK into its bundle. */}
            <form method="post" action="/auth/signout">
              <button
                type="submit"
                role="menuitem"
                className="flex h-11 w-full items-center gap-3 rounded-full px-3 text-left text-body-md font-medium text-error transition-colors hover:bg-error-container"
              >
                <Icon name="logout" size={19} />
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="flex h-11 items-center gap-3 rounded-full px-3 text-body-md font-medium text-on-surface transition-colors hover:bg-surface-container-high"
    >
      <Icon name={icon} size={19} className="text-on-surface-variant" filled={false} />
      {label}
    </Link>
  );
}

/** Header search that jumps straight to the members list, pre-filtered. */
function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');

  return (
    <form
      className="relative w-full"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        router.push(term ? `/staff/members?q=${encodeURIComponent(term)}` : '/staff/members');
      }}
      role="search"
    >
      <label htmlFor="staff-global-search" className="sr-only">
        Search members
      </label>
      <Icon
        name="search"
        size={19}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant"
        filled={false}
      />
      <input
        id="staff-global-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search members by name, ID, or phone…"
        className="h-12 w-full rounded-full border-0 bg-surface-container py-2 pl-12 pr-4 text-body-md text-on-surface shadow-neu-inset-sm outline-none transition-shadow placeholder:text-on-surface-variant/80 focus:ring-2 focus:ring-primary/40"
      />
    </form>
  );
}
