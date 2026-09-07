'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { clsx } from '@/lib/clsx';
import { Icon, Avatar } from '@/components/ui/primitives';
import { ROLE_LABELS, type NavItem, type Role } from '@/lib/rbac';
import { signOut } from '@/app/(auth)/actions';

/**
 * The staff application chrome.
 *
 * Desktop is a fixed navy rail plus a white command bar. Below `md` the rail
 * becomes a drawer and the five most-used sections move to a bottom bar, so the
 * common journeys are one thumb-tap away and nothing needs a hamburger.
 */
export function StaffShell({
  user,
  nav,
  unreadCount = 0,
  children,
}: {
  user: { fullName: string; role: Role; photoUrl: string | null };
  nav: readonly NavItem[];
  unreadCount?: number;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background text-on-background">
      <Sidebar items={nav} open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <header
          data-app-header
          className="z-30 shrink-0 border-b border-outline-variant bg-surface"
        >
          <div className="mx-auto flex h-16 w-full max-w-content items-center gap-2 px-container-margin-mobile md:h-[72px] md:gap-4 md:px-container-margin-desktop">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-high md:hidden"
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

            <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
              <Link
                href="/staff/savings/record"
                className="hidden items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 text-button-text text-on-primary shadow-card transition-colors hover:bg-primary-container lg:inline-flex"
              >
                <Icon name="add" size={18} />
                Record saving
              </Link>

              <Link
                href="/staff/notifications"
                aria-label={
                  unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
                }
                className="relative flex h-11 w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                <Icon name="notifications" size={22} filled={false} />
                {unreadCount > 0 ? (
                  <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-on-error ring-2 ring-surface">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                ) : null}
              </Link>

              <AccountMenu user={user} />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-container-margin-mobile pb-24 md:p-container-margin-desktop md:pb-container-margin-desktop">
          <div className="mx-auto w-full max-w-content">{children}</div>
        </main>

        <StaffBottomBar items={nav} onMore={() => setMenuOpen(true)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function AccountMenu({
  user,
}: {
  user: { fullName: string; role: Role; photoUrl: string | null };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on Escape and on any click outside — a dropdown that can only be
  // closed by clicking the trigger again feels broken on touch.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
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
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={clsx(
          'flex items-center gap-2.5 rounded-xl p-1.5 transition-colors md:pr-2.5',
          open ? 'bg-surface-container-high' : 'hover:bg-surface-container-high',
        )}
      >
        <Avatar name={user.fullName} src={user.photoUrl} size={36} />
        <span className="hidden text-left lg:block">
          <span className="block text-button-text leading-tight text-on-surface">
            {user.fullName}
          </span>
          <span className="block text-label-md font-normal text-on-surface-variant">
            {ROLE_LABELS[user.role]}
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
          className="absolute right-0 z-50 mt-2 w-64 animate-slide-up overflow-hidden rounded-2xl border border-outline-variant bg-surface shadow-pop"
        >
          <div className="flex items-center gap-3 border-b border-outline-variant bg-surface-container-low px-4 py-3.5">
            <Avatar name={user.fullName} src={user.photoUrl} size={40} />
            <div className="min-w-0">
              <p className="truncate text-button-text text-on-surface">{user.fullName}</p>
              <p className="text-label-md font-normal text-on-surface-variant">
                {ROLE_LABELS[user.role]}
              </p>
            </div>
          </div>
          <div className="p-1.5">
            <MenuLink href="/staff/profile" icon="person" label="My profile" />
            <MenuLink href="/staff/profile#password" icon="lock" label="Change password" />
            <MenuLink href="/staff/settings" icon="settings" label="Settings" />
          </div>
          <div className="border-t border-outline-variant p-1.5">
            {/* A form posting to the server action, so the shell never pulls
                the Supabase browser SDK into its bundle. */}
            <form action={signOut}>
              <button
                type="submit"
                role="menuitem"
                className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-body-md font-medium text-error transition-colors hover:bg-error-container"
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
      className="flex h-11 items-center gap-3 rounded-xl px-3 text-body-md font-medium text-on-surface transition-colors hover:bg-surface-container-high"
    >
      <Icon name={icon} size={19} className="text-on-surface-variant" filled={false} />
      {label}
    </Link>
  );
}

/**
 * Staff bottom bar.
 *
 * The brief is explicit that the sidebar must not eat the whole screen on a
 * phone. Four destinations plus "More" (which opens the drawer) covers the day
 * of a cashier or group officer without a single menu tap.
 */
function StaffBottomBar({
  items,
  onMore,
}: {
  items: readonly NavItem[];
  onMore: () => void;
}) {
  const pathname = usePathname();
  const tabs = items.filter((i) => i.bottomBar).slice(0, 4);

  function isActive(href: string) {
    if (href === '/staff') return pathname === '/staff';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      data-bottom-bar
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-outline-variant bg-surface/95 pb-safe backdrop-blur md:hidden"
    >
      <div className="flex items-stretch">
        {tabs.map((t) => {
          const active = isActive(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors',
                active ? 'text-primary' : 'text-on-surface-variant',
              )}
            >
              <span
                className={clsx(
                  'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                  active && 'bg-primary/10',
                )}
              >
                <Icon name={t.icon} size={21} filled={active} />
              </span>
              <span className="text-[10.5px] font-semibold leading-none">{t.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-on-surface-variant"
        >
          <span className="flex h-7 w-12 items-center justify-center rounded-full">
            <Icon name="menu" size={21} filled={false} />
          </span>
          <span className="text-[10.5px] font-semibold leading-none">More</span>
        </button>
      </div>
    </nav>
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
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant"
        filled={false}
      />
      <input
        id="staff-global-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search members by name, ID, or phone…"
        className="h-11 w-full rounded-2xl border border-outline-variant bg-surface-container py-2 pl-11 pr-4 text-body-md text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/80 hover:bg-surface-container-high focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/20"
      />
    </form>
  );
}
