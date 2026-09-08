'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { clsx } from '@/lib/clsx';
import { Icon } from '@/components/ui/primitives';
import { ScrollArea } from '@/components/ui/scroll';
import { MEMBER_NAV, MEMBER_MORE_NAV } from '@/lib/rbac';
import { signOut } from '@/app/(auth)/actions';

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
      className="hidden h-full w-sidebar shrink-0 flex-col bg-ink-gradient md:flex"
    >
      <Link
        href="/"
        className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-4"
      >
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
          <span className="block text-[12.5px] font-bold uppercase leading-[1.25] text-white">
            Bakenye Unity and
            <br />
            Development SACCO
          </span>
          <span className="mt-0.5 block truncate text-[10.5px] font-medium italic text-secondary-container/90">
            Together We Grow
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
        <form action={signOut}>
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
        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-button-text transition-colors duration-150',
        active ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white',
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-secondary-container transition-opacity',
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
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1.5 text-[10px] font-bold text-on-error">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}
