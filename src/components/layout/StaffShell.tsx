'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Icon, Avatar } from '@/components/ui/primitives';
import { ROLE_LABELS, type NavItem, type Role } from '@/lib/rbac';
import { signOut } from '@/app/(auth)/actions';

/**
 * The staff application chrome, ported from `staff_dashboard_desktop`:
 * 256px sidebar, an 80px header with the global member search, notifications
 * and the profile block on the right.
 *
 * On mobile the sidebar becomes a drawer behind the hamburger — the same
 * button Stitch already drew for `md<` but never wired up.
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
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <div className="bg-background text-on-background flex h-[100dvh] overflow-hidden">
      <Sidebar items={nav} open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="bg-background flex h-full flex-1 flex-col overflow-hidden">
        {/* The bar spans the viewport; its contents share the content
            container, so the account block lines up with the right edge of the
            page rather than floating off at the edge of a 1920px monitor. */}
        <header className="bg-surface border-outline-variant/50 z-30 shrink-0 border-b shadow-sm">
          <div className="px-container-margin-mobile md:px-container-margin-desktop max-w-content mx-auto flex h-16 w-full items-center justify-between md:h-20">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="text-on-surface-variant hover:bg-surface-container-high -ml-2 mr-2 flex h-11 w-11 items-center justify-center rounded-full md:hidden"
          >
            <Icon name="menu" />
          </button>

          <Link href="/staff" className="mr-3 flex shrink-0 items-center md:hidden">
            <Image
              src="/brand/bnd-logo.png"
              alt="BND-SACCO"
              width={32}
              height={32}
              priority
              className="h-8 w-8 object-contain"
            />
          </Link>

          {/* Global member search. Hidden on the narrowest phones, where the
              members screen has its own search field and the header space is
              better spent on the account controls. */}
          <div className="relative mx-auto hidden max-w-2xl flex-1 justify-center sm:flex md:mx-0 lg:ml-8">
            <GlobalSearch />
          </div>

          <div className="ml-auto flex items-center gap-2 md:gap-6">
            <Link
              href="/staff/notifications"
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              className="text-on-surface-variant hover:bg-surface-container-high relative flex h-11 w-11 items-center justify-center rounded-full transition-colors"
            >
              <Icon name="notifications" />
              {unreadCount > 0 ? (
                <span className="bg-error ring-surface absolute right-2 top-2 h-2.5 w-2.5 rounded-full ring-2" />
              ) : null}
            </Link>

            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountOpen((v) => !v)}
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                className="border-outline-variant/50 hover:bg-surface-container-low flex items-center gap-3 rounded-lg p-1.5 transition-colors md:border-l md:pl-4"
              >
                <Avatar name={user.fullName} src={user.photoUrl} size={40} />
                <span className="hidden text-left lg:block">
                  <span className="text-button-text font-button-text text-on-surface block font-semibold leading-tight">
                    {user.fullName}
                  </span>
                  <span className="text-label-md font-label-md text-on-surface-variant block">
                    {ROLE_LABELS[user.role]}
                  </span>
                </span>
                <Icon name="expand_more" size={20} className="text-on-surface-variant hidden lg:block" />
              </button>

              {accountOpen ? (
                <>
                  <button
                    type="button"
                    aria-hidden="true"
                    tabIndex={-1}
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setAccountOpen(false)}
                  />
                  <div
                    role="menu"
                    className="bg-surface border-outline-variant animate-slide-up absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border shadow-lg"
                  >
                    <div className="border-outline-variant/50 border-b px-4 py-3 lg:hidden">
                      <p className="text-button-text font-button-text text-on-surface truncate">
                        {user.fullName}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant">
                        {ROLE_LABELS[user.role]}
                      </p>
                    </div>
                    <Link
                      href="/staff/profile"
                      role="menuitem"
                      className="text-body-md font-body-md text-on-surface hover:bg-surface-container-high flex h-12 items-center gap-3 px-4"
                    >
                      <Icon name="person" size={20} className="text-on-surface-variant" />
                      My profile
                    </Link>
                    <Link
                      href="/staff/profile#password"
                      role="menuitem"
                      className="text-body-md font-body-md text-on-surface hover:bg-surface-container-high flex h-12 items-center gap-3 px-4"
                    >
                      <Icon name="lock" size={20} className="text-on-surface-variant" />
                      Change password
                    </Link>
                    {/* A form posting to the server action, so the shell never
                        pulls the Supabase browser SDK into its bundle. */}
                    <form action={signOut}>
                      <button
                        type="submit"
                        role="menuitem"
                        className="text-body-md font-body-md text-error hover:bg-error-container flex h-12 w-full items-center gap-3 px-4 text-left"
                      >
                        <Icon name="logout" size={20} />
                        Sign out
                      </button>
                    </form>
                  </div>
                </>
              ) : null}
            </div>
          </div>
          </div>
        </header>

        <main className="p-container-margin-mobile md:p-container-margin-desktop flex-1 overflow-y-auto">
          <div className="max-w-content mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
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
        size={20}
        className="text-on-surface-variant pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
      />
      <input
        id="staff-global-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search members by name, ID, or phone..."
        className="bg-surface-container-low border-outline-variant/50 text-body-md font-body-md h-touch-target-min hover:bg-surface-container focus:border-primary focus:ring-primary w-full rounded-full border py-3 pl-12 pr-4 outline-none transition-shadow focus:ring-1"
      />
    </form>
  );
}
