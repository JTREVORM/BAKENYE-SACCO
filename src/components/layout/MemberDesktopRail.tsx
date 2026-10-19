'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { clsx } from '@/lib/clsx';
import { Icon } from '@/components/ui/primitives';
import { ScrollArea } from '@/components/ui/scroll';
import { MEMBER_NAV, MEMBER_MORE_NAV } from '@/lib/rbac';
import { useBrand } from '@/components/brand/BrandProvider';
import { RailBackdrop } from './RailBackdrop';
import { splitName } from '@/lib/sacco-brand';

/**
 * Desktop navigation for the member app.
 *
 * DESIGN.md: "the mobile Bottom Nav transitions into a persistent Left
 * Sidebar." The member screens were exported mobile-only, so this rail applies
 * that stated rule to them — same icons, same labels, same active-pill
 * treatment as the staff sidebar, just at the member's smaller nav surface.
 * Invisible below `md`, where the drawer behind the menu button is in charge.
 */
export function MemberDesktopRail({ unreadCount = 0 }: { unreadCount?: number }) {
  const brand = useBrand();
  const [nameTop, nameBottom] = splitName(brand.legalName);
  const pathname = usePathname();
  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  // "More" was the bottom bar's overflow tab; every rail lists its contents
  // directly, so there is nothing left for it to point at.
  const primary = MEMBER_NAV.filter((i) => i.href !== '/more');

  return (
    <aside
      data-sidebar
      className="bg-ink-gradient relative isolate hidden h-full w-sidebar shrink-0 flex-col md:flex"
    >
      <RailBackdrop />
      <Link
        href="/"
        className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-4"
      >
        <span className="ring-secondary-fixed-dim/70 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white p-0.5 shadow-[0_2px_10px_rgba(4,16,40,0.45)] ring-2">
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
          <span className="block text-[12.5px] font-bold uppercase leading-[1.25] text-white">
            {nameTop}
            <br />
            {nameBottom}
          </span>
          <span className="text-secondary-fixed-dim mt-0.5 block text-[10.5px] font-medium italic leading-snug">
            {brand.motto}
          </span>
        </span>
      </Link>

      <nav className="flex min-h-0 flex-1 flex-col" aria-label="Sections">
        <ScrollArea
          controls="edge"
          tone="dark"
          wrapperClassName="flex-1"
          className="space-y-0.5 px-3 py-5"
        >
          {primary.map((item) => (
            <RailLink key={item.href} {...item} active={isActive(item.href)} />
          ))}

          <p className="px-3 pb-1.5 pt-5 text-label-sm uppercase tracking-wider text-white/40">
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
        </ScrollArea>
      </nav>

      <div className="shrink-0 border-t border-white/10 p-3">
        {/* A plain form posting to the server action, so this component never
            needs the Supabase browser SDK. */}
        <form method="post" action="/auth/signout">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-button-text text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Icon name="logout" size={20} filled={false} />
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
        'group relative flex min-h-[46px] items-center gap-3 overflow-hidden rounded-xl px-3.5 text-button-text transition-colors duration-150',
        active
          ? 'bg-white/[0.14] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
          : 'text-white/65 hover:bg-white/[0.07] hover:text-white',
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'bg-gold-gradient absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full transition-opacity',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
      <Icon
        name={icon}
        size={20}
        filled={active}
        className={clsx(
          'shrink-0 transition-colors',
          active ? 'text-secondary-fixed-dim' : 'text-white/55 group-hover:text-white',
        )}
      />
      <span className="flex-1 truncate">{label}</span>
      {badge > 0 ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1.5 text-[10px] font-bold text-on-error">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}
