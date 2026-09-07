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
        'fixed bottom-0 left-0 z-50 flex w-full items-stretch border-t border-outline-variant',
        'bg-surface/95 pb-safe backdrop-blur',
        // On desktop the sidebar takes over.
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
              // 44px minimum target, even for the narrowest label.
              'flex min-h-touch-target-min min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors',
              active ? 'text-primary' : 'text-on-surface-variant',
            )}
          >
            {/* The tint sits on a pill behind the glyph rather than on the whole
                tab, so the label baseline stays level across all five tabs. */}
            <span
              className={clsx(
                'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                active && 'bg-primary/10',
              )}
            >
              <Icon name={item.icon} size={21} filled={active} />
            </span>
            <span className="max-w-full truncate text-[10.5px] font-semibold leading-none">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
