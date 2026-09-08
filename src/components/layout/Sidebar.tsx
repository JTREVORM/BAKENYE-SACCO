'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { clsx } from '@/lib/clsx';
import { Icon } from '@/components/ui/primitives';
import { ScrollArea } from '@/components/ui/scroll';
import type { NavItem } from '@/lib/rbac';

/**
 * The persistent navigation rail.
 *
 * Deep navy rather than a light panel: it pushes the chrome back so the white
 * content cards read as the subject of the screen, and it gives the product a
 * recognisable silhouette at a glance. The active item is a solid white-on-navy
 * pill with a gold edge marker — the marker is what survives when the pill is
 * hard to see on a dim outdoor phone screen.
 *
 * Below `md` the same list becomes a slide-in drawer, and it is the whole of
 * the mobile navigation. It never covers the whole screen: it is 300px wide
 * with the page dimmed behind, so the user keeps their place.
 */
export function Sidebar({
  items,
  open,
  onClose,
}: {
  items: readonly NavItem[];
  open: boolean;
  onClose: () => void;
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

  const nav = (
    // Twelve sections with sub-items open under the active one will outrun a
    // 600px-tall laptop viewport, so the rail scrolls — with the dark-surface
    // scrollbar and a chevron at whichever end still has something on it.
    <nav className="flex min-h-0 flex-1 flex-col" aria-label="Sections">
      <ScrollArea
        controls="edge"
        tone="dark"
        wrapperClassName="flex-1"
        className="space-y-0.5 px-3 py-5"
      >
        {items.map((item) => {
          const active = isActive(item.href);
          const children = item.children ?? [];

          return (
            <div key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-button-text transition-colors duration-150',
                  active
                    ? 'bg-white/15 text-white'
                    : 'text-white/60 hover:bg-white/5 hover:text-white',
                )}
              >
                {/* The gold rail marker: legible even where the translucent
                  active pill washes out in bright sunlight. */}
                <span
                  aria-hidden="true"
                  className={clsx(
                    'absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-secondary-container transition-opacity',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <Icon
                  name={item.icon}
                  size={21}
                  filled={active}
                  className={clsx(
                    'shrink-0',
                    active ? 'text-secondary-container' : 'text-white/55 group-hover:text-white',
                  )}
                />
                <span className="truncate">{item.label}</span>
              </Link>

              {/* Sub-sections appear only while their parent is the open section,
                so the rail stays a scannable list. */}
              {active && children.length > 0 ? (
                <ul className="ml-6 mt-1 space-y-0.5 border-l border-white/15 pl-3">
                  {children.map((child) => {
                    const childActive = pathname === child.href;
                    return (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          aria-current={childActive ? 'page' : undefined}
                          className={clsx(
                            'flex min-h-[38px] items-center gap-2 rounded-lg px-3 text-label-md transition-colors',
                            childActive
                              ? 'text-secondary-container'
                              : 'text-white/55 hover:bg-white/5 hover:text-white',
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

  return (
    <>
      {/* Desktop: always present. */}
      <aside
        data-sidebar
        className="z-40 hidden h-full w-sidebar shrink-0 flex-col bg-ink-gradient md:flex"
      >
        <BrandLockup />
        {nav}
        <SidebarFooter />
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
            'absolute inset-y-0 left-0 flex w-[300px] max-w-[86vw] flex-col bg-ink-gradient shadow-pop transition-transform duration-200 ease-out',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <BrandLockup onClose={onClose} />
          {nav}
          <SidebarFooter />
        </div>
      </div>
    </>
  );
}

/** Crest + the full organisation name, wrapped to two lines. */
function BrandLockup({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-4">
      <Link href="/staff" className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/95 p-1">
          <Image
            src="/brand/bnd-logo.png"
            alt=""
            width={36}
            height={36}
            priority
            className="h-full w-full object-contain"
          />
        </span>
        <span className="min-w-0">
          <span className="block text-[12.5px] font-bold uppercase leading-[1.25] tracking-[0.01em] text-white">
            Bakenye Unity and
            <br />
            Development SACCO
          </span>
          <span className="mt-0.5 block truncate text-[10.5px] font-medium italic text-secondary-container/90">
            Together We Grow
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
 * The motto, as a quiet sign-off at the foot of the rail.
 *
 * `mt-auto` rather than absolute positioning so it never overlaps the nav list
 * when the list is long enough to scroll.
 */
function SidebarFooter() {
  return (
    <div className="mt-auto shrink-0 border-t border-white/10 px-5 py-4">
      <p className="text-[11px] font-medium leading-snug text-white/45">
        Stronger Members
        <br />
        Brighter Futures
      </p>
    </div>
  );
}
