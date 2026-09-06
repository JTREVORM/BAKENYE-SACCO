'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { clsx } from '@/lib/clsx';
import { Icon } from '@/components/ui/primitives';
import { MEMBER_NAV, MEMBER_MORE_NAV } from '@/lib/rbac';
import { signOut } from '@/app/(auth)/actions';

/**
 * Desktop navigation for the member app.
 *
 * DESIGN.md: "the mobile Bottom Nav transitions into a persistent Left
 * Sidebar." The member screens were exported mobile-only, so this rail applies
 * that stated rule to them — same icons, same labels, same active-pill
 * treatment as the staff sidebar, just at the member's smaller nav surface.
 * Invisible below `md`, where the bottom bar is in charge.
 */
export function MemberDesktopRail({ unreadCount = 0 }: { unreadCount?: number }) {
  const pathname = usePathname();
  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  // "More" is a mobile affordance; on desktop its contents are listed directly.
  const primary = MEMBER_NAV.filter((i) => i.href !== '/more');

  return (
    <aside
      data-sidebar
      className="bg-surface-container-low border-outline-variant hidden h-full w-64 shrink-0 flex-col border-r md:flex"
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
        <span className="text-button-text font-button-text text-primary font-bold">BND-SACCO</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-6" aria-label="Sections">
        {primary.map((item) => (
          <RailLink key={item.href} {...item} active={isActive(item.href)} />
        ))}

        <p className="text-label-md font-label-md text-on-surface-variant px-4 pb-1 pt-5 uppercase">
          More
        </p>

        {MEMBER_MORE_NAV.map((item) => (
          <RailLink
            key={item.href}
            {...item}
            active={isActive(item.href)}
            badge={item.href === '/notifications' ? unreadCount : 0}
          />
        ))}
      </nav>

      <div className="border-outline-variant/50 border-t p-4">
        {/* A plain form posting to the server action, so this component never
            needs the Supabase browser SDK. */}
        <form action={signOut}>
          <button
            type="submit"
            className="text-button-text font-button-text text-error hover:bg-error-container flex w-full items-center gap-3 rounded-lg px-4 py-3 transition-colors"
          >
            <Icon name="logout" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

function RailLink({
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
        'text-button-text font-button-text group flex items-center gap-3 rounded-lg px-4 py-3 transition-colors',
        active
          ? 'bg-secondary-container text-on-secondary-container font-semibold'
          : 'text-on-surface-variant hover:bg-surface-container-high',
      )}
    >
      <Icon
        name={icon}
        filled={active}
        className={clsx(!active && 'group-hover:text-primary transition-colors')}
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
