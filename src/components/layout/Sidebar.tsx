'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { clsx } from '@/lib/clsx';
import { Icon } from '@/components/ui/primitives';
import type { NavItem } from '@/lib/rbac';

/**
 * The persistent desktop sidebar from `staff_dashboard_desktop/code.html`:
 * 256px wide, logo in a 80px header, active item as a `secondary-container`
 * pill, hover tinting the icon `primary`.
 *
 * Below `md` the same list is presented as a slide-in drawer, which is how
 * DESIGN.md says the two layouts relate ("the mobile Bottom Nav transitions
 * into a persistent Left Sidebar").
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
  useEffect(() => { onClose(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const nav = (
    <nav className="space-y-1 overflow-y-auto px-4 py-6" aria-label="Sections">
      {items.map((item) => {
        const active = isActive(item.href);
        const children = item.children ?? [];

        return (
          <div key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'text-button-text font-button-text group flex items-center gap-3 rounded-lg px-4 py-3 transition-colors',
                active
                  ? 'bg-secondary-container text-on-secondary-container hover:bg-secondary-fixed-dim font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-high',
              )}
            >
              <Icon
                name={item.icon}
                filled={active}
                className={clsx(!active && 'group-hover:text-primary transition-colors')}
              />
              {item.label}
            </Link>

            {/* Sub-sections appear only while their parent is the open section,
                so the sidebar stays the ten-item list Stitch drew. */}
            {active && children.length > 0 ? (
              <ul className="border-outline-variant/50 ml-7 mt-1 space-y-0.5 border-l pl-3">
                {children.map((child) => {
                  const childActive = pathname === child.href;
                  return (
                    <li key={child.href}>
                      <Link
                        href={child.href}
                        aria-current={childActive ? 'page' : undefined}
                        className={clsx(
                          'text-label-md font-label-md min-h-touch-target-min flex items-center gap-2 rounded-lg px-3 normal-case transition-colors',
                          childActive
                            ? 'text-primary font-semibold'
                            : 'text-on-surface-variant hover:bg-surface-container-high',
                        )}
                      >
                        <Icon name={child.icon} size={18} filled={childActive} />
                        {child.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop: always present. */}
      <aside
        data-sidebar
        className="bg-surface-container-low border-outline-variant z-40 hidden h-full w-64 flex-col border-r md:flex"
      >
        <div className="border-outline-variant/50 flex h-20 items-center gap-3 border-b px-6">
          <Image
            src="/brand/bnd-logo.png"
            alt="BND-SACCO"
            width={40}
            height={40}
            priority
            className="h-10 w-10 object-contain"
          />
          <span className="text-button-text font-button-text text-primary font-bold">
            BND-SACCO
          </span>
        </div>
        {nav}
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
            'absolute inset-0 bg-black/40 transition-opacity',
            open ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className={clsx(
            'bg-surface-container-low absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col shadow-xl transition-transform duration-200',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="border-outline-variant/50 flex h-20 items-center justify-between border-b px-4">
            <div className="flex items-center gap-3">
              <Image
                src="/brand/bnd-logo.png"
                alt="BND-SACCO"
                width={36}
                height={36}
                className="h-9 w-9 object-contain"
              />
              <span className="text-button-text font-button-text text-primary font-bold">
                BND-SACCO
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="text-on-surface-variant hover:bg-surface-container-high flex h-11 w-11 items-center justify-center rounded-full"
            >
              <Icon name="close" />
            </button>
          </div>
          {nav}
        </div>
      </div>
    </>
  );
}
