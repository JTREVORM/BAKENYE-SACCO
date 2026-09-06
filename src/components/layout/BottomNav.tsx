'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from '@/lib/clsx';
import { Icon } from '@/components/ui/primitives';
import type { NavItem } from '@/lib/rbac';

/**
 * The persistent mobile bottom bar, carried over from the Stitch member
 * screens: the active tab is a filled pill in `secondary-container`, the rest
 * are `on-surface-variant` labels under stroke icons.
 *
 * Kept as a Client Component purely so the active tab can be derived from the
 * pathname — everything it renders is static markup.
 */
export function BottomNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      data-bottom-bar
      aria-label="Primary"
      className={clsx(
        'bg-surface pb-safe fixed bottom-0 left-0 z-50 flex w-full items-center justify-around',
        'rounded-t-xl px-2 py-2 shadow-[0_-2px_8px_rgba(0,0,0,0.05)]',
        // On desktop the sidebar takes over, exactly as DESIGN.md describes.
        'md:hidden',
      )}
    >
      {items.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'flex min-w-0 flex-col items-center justify-center transition-transform duration-150',
              // 44px minimum target, even for the narrowest label.
              'min-h-touch-target-min flex-1 px-2 py-1',
              active
                ? 'bg-secondary-container text-on-secondary-container scale-90 rounded-full'
                : 'text-on-surface-variant hover:bg-surface-container-high rounded-xl',
            )}
          >
            <Icon name={item.icon} filled={active} />
            <span className="text-label-md font-label-md mt-1 max-w-full truncate">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
