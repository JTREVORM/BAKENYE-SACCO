'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { clsx } from '@/lib/clsx';
import { Icon } from '@/components/ui/primitives';
import { MEMBER_NAV, MEMBER_MORE_NAV } from '@/lib/rbac';
import { signOut } from '@/app/(auth)/actions';

/**
 * Mobile navigation for the member app: the menu button in the top bar and the
 * drawer behind it.
 *
 * This replaces the five-tab bottom bar. A bar pinned to the bottom of the
 * viewport costs 80px of a 667px phone screen on every single screen, and it
 * could only ever carry four destinations plus a "More" tab that led to a page
 * that was itself a list of links. The drawer carries every destination, costs
 * nothing until it is opened, and puts the whole of the member app one tap from
 * the same place on every screen.
 *
 * Above `md` this renders nothing: the desktop rail is in charge there.
 *
 * The overlay is portalled to `<body>` rather than left where it is written.
 * The top bar it lives in carries `backdrop-blur`, and a backdrop filter makes
 * an element the containing block for its fixed-position descendants — so an
 * inline `fixed inset-0` drawer would be clipped to the 56px bar instead of
 * covering the screen.
 */
export function MemberDrawer({ unreadCount = 0 }: { unreadCount?: number }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  // There is no document to portal into until the client has taken over, and
  // the button alone is what the server renders.
  useEffect(() => setMounted(true), []);

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  // Close on navigation, so tapping a destination does not leave the drawer
  // sitting open over the screen it just went to.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // "More" is the old bottom-bar overflow tab; the drawer lists its contents
  // directly, so there is nothing left for it to point at.
  const primary = MEMBER_NAV.filter((i) => i.href !== '/more');

  const overlay = (
    <div
      className={clsx(
        'fixed inset-0 z-[60] md:hidden',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        aria-label="Close menu"
        onClick={() => setOpen(false)}
        className={clsx(
          'bg-ink/60 absolute inset-0 backdrop-blur-[2px] transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={clsx(
          'bg-ink-gradient shadow-pop absolute inset-y-0 left-0 flex w-[300px] max-w-[86vw] flex-col transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-4">
          <Link href="/" className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/95 p-1">
              <Image
                src="/brand/bnd-logo.png"
                alt=""
                width={36}
                height={36}
                className="h-full w-full object-contain"
              />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-bold uppercase leading-[1.25] text-white">
                Bakenye Unity and
                <br />
                Development SACCO
              </span>
              <span className="text-secondary-container/90 mt-0.5 block truncate text-[10.5px] font-medium italic">
                Together We Grow
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <nav
          className="no-scrollbar flex-1 space-y-0.5 overflow-y-auto px-3 py-5"
          aria-label="Sections"
        >
          {primary.map((item) => (
            <DrawerLink key={item.href} {...item} active={isActive(item.href)} />
          ))}

          <p className="text-label-sm px-3 pb-1.5 pt-5 uppercase tracking-wider text-white/40">
            More
          </p>

          {MEMBER_MORE_NAV.map((item) => (
            <DrawerLink
              key={item.href}
              {...item}
              active={isActive(item.href)}
              badge={item.href === '/notifications' ? unreadCount : 0}
            />
          ))}
        </nav>

        <div className="shrink-0 border-t border-white/10 p-3">
          {/* A plain form posting to the server action, so the drawer never
                needs the Supabase browser SDK. */}
          <form action={signOut}>
            <button
              type="submit"
              className="text-button-text flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Icon name="logout" size={20} filled={false} />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="text-on-surface-variant hover:text-on-surface -ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-shadow hover:bg-surface hover:shadow-neu-sm active:shadow-neu-pressed md:hidden"
      >
        <Icon name="menu" size={22} />
      </button>

      {mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}

function DrawerLink({
  href,
  label,
  icon,
  active,
  badge = 0,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'text-button-text group relative flex min-h-touch-target-min items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-150',
        active ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white',
      )}
    >
      {/* The gold rail marker: legible even where the translucent active pill
          washes out in bright sunlight. */}
      <span
        aria-hidden="true"
        className={clsx(
          'bg-secondary-container absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full transition-opacity',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
      <Icon
        name={icon}
        size={20}
        filled={active}
        className={clsx(
          'shrink-0',
          active ? 'text-secondary-container' : 'text-white/55 group-hover:text-white',
        )}
      />
      <span className="flex-1 truncate">{label}</span>
      {badge > 0 ? (
        <span className="bg-error text-on-error flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}
