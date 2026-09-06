import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberFinancials, getUnreadCount } from '@/lib/queries';
import { MemberShell } from '@/components/layout/MemberShell';
import { Icon, Avatar, Money } from '@/components/ui/primitives';
import { SignOutButton } from '@/components/SignOutButton';
import { MEMBER_MORE_NAV } from '@/lib/rbac';

export const metadata: Metadata = { title: 'More' };

/**
 * The "More" tab.
 *
 * The Stitch bottom bar has five slots and the member app has more than five
 * destinations, so this is the overflow — everything that does not earn a
 * permanent tab, plus the profile summary and sign-out.
 *
 * On desktop the left rail lists these directly, which is why the rail hides
 * this entry rather than linking to it.
 */
export default async function MorePage() {
  const user = await requireMember();
  const [m, unread] = await Promise.all([
    getMemberFinancials(user.memberId),
    getUnreadCount(),
  ]);

  return (
    <MemberShell unreadCount={unread}>
      <div className="flex flex-col gap-6 py-4">
        {/* Profile summary */}
        <Link
          href="/profile"
          className="bg-surface border-outline-variant elev-1 hover:bg-surface-container-low flex items-center gap-4 rounded-xl border p-4 transition-colors"
        >
          <Avatar name={user.fullName} src={m?.photo_url} size={56} />
          <div className="min-w-0 flex-1">
            <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
              {user.fullName}
            </p>
            <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
              {user.memberNo}
            </p>
            <p className="text-label-md font-label-md text-on-surface-variant/80 truncate normal-case">
              Total equity <Money value={m?.total_equity} />
            </p>
          </div>
          <Icon name="chevron_right" className="text-on-surface-variant shrink-0" />
        </Link>

        {/* Everything else */}
        <nav className="bg-surface border-outline-variant elev-1 divide-outline-variant/40 divide-y overflow-hidden rounded-xl border">
          {MEMBER_MORE_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hover:bg-surface-container-low min-h-touch-target-primary flex items-center gap-3 px-4 py-3 transition-colors"
            >
              <span className="bg-surface-container text-on-surface-variant flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                <Icon name={item.icon} size={20} />
              </span>
              <span className="text-body-md font-body-md text-on-surface flex-1">{item.label}</span>
              {item.href === '/notifications' && unread > 0 ? (
                <span className="bg-error text-on-error flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold">
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : null}
              <Icon name="chevron_right" size={20} className="text-on-surface-variant shrink-0" />
            </Link>
          ))}
        </nav>

        <SignOutButton />

        <p className="text-label-md font-label-md text-on-surface-variant text-center normal-case">
          Bakenye National Development SACCO
          <br />
          Obumu Niigo Amaani
        </p>
      </div>
    </MemberShell>
  );
}
