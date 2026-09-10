'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/primitives';
import { ScrollRow } from '@/components/ui/scroll';
import { clsx } from '@/lib/clsx';
import type { NavItem } from '@/lib/rbac';

/**
 * The finance sections as a strip of chips - for phones and tablets, where the
 * sidebar that lists them lives behind the menu button. From `lg` up the
 * sidebar is on screen and this would only repeat it.
 */
export function FinanceNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Finance sections" className="no-print mb-5 min-w-0 lg:hidden">
      <ScrollRow
        label="Finance sections"
        wrapperClassName="-mx-container-margin-mobile md:mx-0"
        className="no-scrollbar flex gap-2 px-container-margin-mobile pb-1 md:px-0"
      >
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== '/staff/finance' && pathname.startsWith(`${item.href}/`));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'inline-flex h-touch-target-min shrink-0 items-center gap-2 rounded-full px-4 text-label-md font-semibold transition-shadow',
                active
                  ? 'bg-ink text-white shadow-neu-dark-sm'
                  : 'bg-surface text-on-surface-variant shadow-neu-sm hover:text-primary',
              )}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </Link>
          );
        })}
      </ScrollRow>
    </nav>
  );
}
