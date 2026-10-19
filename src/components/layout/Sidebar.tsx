'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { clsx } from '@/lib/clsx';
import { Icon } from '@/components/ui/primitives';
import { ScrollArea } from '@/components/ui/scroll';
import type { NavItem } from '@/lib/rbac';
import { useBrand } from '@/components/brand/BrandProvider';
import { RailBackdrop } from './RailBackdrop';
import { splitName } from '@/lib/sacco-brand';

/**
 * The persistent navigation rail.
 *
 * Deep navy, with the SACCO's own landscape photograph washed into the foot of
 * it: the chrome recedes so the white content cards read as the subject of the
 * screen, and the product keeps a recognisable silhouette at a glance. The
 * active item is a lifted white-on-navy pill with a gold edge marker and a gold
 * icon — the marker is what survives when the pill washes out on a dim outdoor
 * phone screen.
 *
 * Below `md` the same list becomes a slide-in drawer, and it is the whole of
 * the mobile navigation. It never covers the whole screen: it is 300px wide
 * with the page dimmed behind, so the user keeps their place.
 */
export function Sidebar({
  items,
  open,
  onClose,
  collapsed = false,
}: {
  items: readonly NavItem[];
  open: boolean;
  onClose: () => void;
  /** Desktop only: the rail narrows to an icon column. The drawer ignores it. */
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/staff') return pathname === '/staff';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  // Close the drawer on navigation and on Escape.
  useEffect(() => {
    onClose(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function navList(tight: boolean) {
    return (
    // Twelve sections with sub-items open under the active one will outrun a
    // 600px-tall laptop viewport, so the rail scrolls — with the dark-surface
    // scrollbar and a chevron at whichever end still has something on it.
    <nav className="flex min-h-0 flex-1 flex-col" aria-label="Sections">
      <ScrollArea
        controls="edge"
        tone="dark"
        wrapperClassName="flex-1"
        className={clsx('space-y-0.5 py-5', tight ? 'px-2.5' : 'px-3')}
      >
        {items.map((item) => {
          const active = isActive(item.href);
          const children = item.children ?? [];

          return (
            <div key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={tight ? item.label : undefined}
                className={clsx(
                  'group relative flex min-h-[46px] items-center gap-3 overflow-hidden rounded-xl text-button-text transition-colors duration-150',
                  tight ? 'justify-center px-0' : 'px-3.5',
                  active
                    ? 'bg-white/[0.14] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                    : 'text-white/65 hover:bg-white/[0.07] hover:text-white',
                )}
              >
                {/* The gold rail marker: legible even where the translucent
                  active pill washes out in bright sunlight. */}
                <span
                  aria-hidden="true"
                  className={clsx(
                    'bg-gold-gradient absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full transition-opacity',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <Icon
                  name={item.icon}
                  size={21}
                  filled={active}
                  className={clsx(
                    'shrink-0 transition-colors',
                    active ? 'text-secondary-fixed-dim' : 'text-white/55 group-hover:text-white',
                  )}
                />
                {tight ? (
                  <span className="sr-only">{item.label}</span>
                ) : (
                  <span className="truncate">{item.label}</span>
                )}
              </Link>

              {/* Sub-sections appear only while their parent is the open section,
                so the rail stays a scannable list. */}
              {active && children.length > 0 && !tight ? (
                <ul className="ml-6 mt-1 space-y-0.5 border-l border-white/15 pl-3">
                  {children.map((child) => {
                    // A child is current on its own page and on the pages under
                    // it - a new transfer is still "Transfers" - except the one
                    // that shares its parent's address, which would otherwise
                    // light up on every page in the section.
                    const childActive =
                      pathname === child.href ||
                      (child.href !== item.href && pathname.startsWith(`${child.href}/`));
                    return (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          aria-current={childActive ? 'page' : undefined}
                          className={clsx(
                            'flex min-h-[38px] items-center gap-2 rounded-lg px-3 text-label-md transition-colors',
                            childActive
                              ? 'text-secondary-fixed-dim'
                              : 'text-white/55 hover:bg-white/[0.07] hover:text-white',
                          )}
                        >
                          <Icon name={child.icon} size={17} filled={childActive} />
                          <span className="truncate">{child.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </ScrollArea>
    </nav>
    );
  }

  return (
    <>
      {/* Desktop: always present. */}
      <aside
        data-sidebar
        className={clsx(
          'bg-ink-gradient relative isolate z-40 hidden h-full shrink-0 flex-col transition-[width] duration-200 md:flex',
          collapsed ? 'w-[76px]' : 'w-sidebar',
        )}
      >
        <RailBackdrop />
        <BrandLockup collapsed={collapsed} />
        {navList(collapsed)}
        <SidebarFooter collapsed={collapsed} />
      </aside>

      {/* Mobile: slide-in drawer. */}
      <div
        className={clsx(
          'fixed inset-0 z-50 md:hidden',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!open}
      >
        <button
          type="button"
          tabIndex={open ? 0 : -1}
          aria-label="Close menu"
          onClick={onClose}
          className={clsx(
            'absolute inset-0 bg-ink/60 backdrop-blur-[2px] transition-opacity duration-200',
            open ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className={clsx(
            'bg-ink-gradient absolute inset-y-0 left-0 isolate flex w-[300px] max-w-[86vw] flex-col shadow-pop transition-transform duration-200 ease-out',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <RailBackdrop />
          <BrandLockup onClose={onClose} />
          {navList(false)}
          <SidebarFooter />
        </div>
      </div>
    </>
  );
}

/** Crest + the full organisation name, wrapped to two lines. */
function BrandLockup({ onClose, collapsed = false }: { onClose?: () => void; collapsed?: boolean }) {
  const brand = useBrand();
  const [nameTop, nameBottom] = splitName(brand.legalName);

  if (collapsed) {
    return (
      <div className="flex shrink-0 justify-center border-b border-white/10 px-2 py-4">
        <Link href="/staff" title={brand.legalName} aria-label={brand.legalName}>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white p-0.5 shadow-[0_2px_10px_rgba(4,16,40,0.45)] ring-2 ring-secondary-fixed-dim/70">
            <Image
              src="/brand/bnd-logo.png"
              alt=""
              width={44}
              height={44}
              priority
              className="h-full w-full rounded-full object-contain"
            />
          </span>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-4">
      <Link href="/staff" className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white p-0.5 shadow-[0_2px_10px_rgba(4,16,40,0.45)] ring-2 ring-secondary-fixed-dim/70">
          <Image
            src="/brand/bnd-logo.png"
            alt=""
            width={44}
            height={44}
            priority
            className="h-full w-full rounded-full object-contain"
          />
        </span>
        <span className="min-w-0">
          <span className="block text-[12.5px] font-bold uppercase leading-[1.25] tracking-[0.01em] text-white">
            {nameTop}
            <br />
            {nameBottom}
          </span>
          <span className="text-secondary-fixed-dim mt-0.5 block text-[10.5px] font-medium italic leading-snug">
            {brand.motto}
          </span>
        </span>
      </Link>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Icon name="close" size={20} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The motto, as a signed-off plaque at the foot of the rail.
 *
 * `mt-auto` rather than absolute positioning so it never overlaps the nav list
 * when the list is long enough to scroll.
 */
function SidebarFooter({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="mt-auto flex shrink-0 justify-center px-2 pb-4 pt-3">
        <span
          title="Stronger Members, Brighter Futures"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-secondary-fixed-dim/30 bg-white/[0.07]"
        >
          <Icon name="eco" size={20} className="text-secondary-fixed-dim/80" filled={false} />
        </span>
      </div>
    );
  }

  return (
    <div className="mt-auto shrink-0 px-3 pb-4 pt-3">
      <div className="flex items-center gap-3 rounded-2xl border border-secondary-fixed-dim/30 bg-white/[0.07] px-3 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/95 p-0.5 ring-1 ring-secondary-fixed-dim/60">
          <Image
            src="/brand/bnd-logo.png"
            alt=""
            width={36}
            height={36}
            className="h-full w-full rounded-full object-contain"
          />
        </span>
        <p className="min-w-0 flex-1 text-[11.5px] font-semibold leading-snug text-secondary-fixed">
          Stronger Members
          <br />
          Brighter Futures
        </p>
        <Icon
          name="eco"
          size={20}
          className="shrink-0 text-secondary-fixed-dim/80"
          filled={false}
        />
      </div>
    </div>
  );
}
