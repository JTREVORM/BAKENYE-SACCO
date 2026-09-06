import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberFinancials, getUnreadCount } from '@/lib/queries';
import { MemberShell } from '@/components/layout/MemberShell';
import { Icon, Avatar, Money } from '@/components/ui/primitives';
import { MemberStatusBadge } from '@/components/ui/status';
import { ProfileEditor } from './ProfileEditor';
import { ChangePasswordForm } from './ChangePasswordForm';
import { SignOutButton } from '@/components/SignOutButton';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'My Profile' };

/**
 * Member profile.
 *
 * `my_profile_mobile/code.html` made real: the radial-gradient header card with
 * the bordered avatar and the "Active Member" verified pill, the Personal
 * Information list with a per-row edit affordance, the Next of Kin card with
 * its initial-badge, and the Account Settings list.
 *
 * Stitch drew an edit pencil on each individual row. Six one-field forms is a
 * lot of round trips on a slow connection, so the pencils open one editor with
 * all the contact fields — same affordance, one save.
 */
export default async function ProfilePage() {
  const user = await requireMember();
  const [m, unread] = await Promise.all([
    getMemberFinancials(user.memberId),
    getUnreadCount(),
  ]);

  if (!m) {
    return (
      <MemberShell unreadCount={unread}>
        <p className="text-body-md font-body-md text-on-surface-variant py-8 text-center">
          Your membership record could not be loaded. Please contact the SACCO office.
        </p>
      </MemberShell>
    );
  }

  return (
    <MemberShell unreadCount={unread}>
      <div className="flex flex-col gap-6 py-6">
        {/* Profile header */}
        <section className="bg-surface-container-lowest border-surface-container-high elev-1 relative flex flex-col items-center justify-center overflow-hidden rounded-xl py-6">
          <div className="from-primary via-surface to-surface pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] opacity-5" />

          <div className="relative z-10 mb-4">
            <Avatar
              name={m.full_name}
              src={m.photo_url}
              size={96}
              className="border-surface border-4 shadow-md"
            />
          </div>

          <div className="relative z-10 px-4 text-center">
            <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
              {m.full_name}
            </h1>
            <p className="text-body-md font-body-md text-on-surface-variant tabular mt-1">
              Member ID: {m.member_no}
            </p>
            <div className="mt-2 inline-flex items-center gap-1">
              {m.status === 'active' ? (
                <span className="bg-tertiary-container/10 text-tertiary flex items-center gap-1 rounded-full px-3 py-1">
                  <Icon name="verified" size={14} />
                  <span className="text-label-md font-label-md">Active Member</span>
                </span>
              ) : (
                <MemberStatusBadge status={m.status} />
              )}
            </div>
            <p className="text-label-md font-label-md text-on-surface-variant mt-2 normal-case">
              Member since {formatDate(m.joined_on)}
            </p>
          </div>
        </section>

        {/* Financial position at a glance */}
        <section className="grid grid-cols-3 gap-2">
          <Stat label="Savings" value={m.savings_balance} />
          <Stat label="Shares" value={m.share_value} />
          <Stat label="Loan" value={m.loan_balance} tone={Number(m.loan_balance) > 0 ? 'error' : 'neutral'} />
        </section>

        {/* Personal Information + Next of Kin, both editable in one form */}
        <ProfileEditor member={m} />

        {/* Account settings */}
        <section className="bg-surface-container-lowest border-surface-container-high elev-1 overflow-hidden rounded-xl border">
          <div className="border-surface-container-high bg-surface-container-low/50 border-b px-4 py-3">
            <h2 className="text-button-text font-button-text text-on-surface">Account Settings</h2>
          </div>
          <div className="divide-surface-container-high divide-y">
            <SettingsLink href="#password" icon="lock" label="Change password" />
            <SettingsLink href="/notifications" icon="notifications_active" label="Notifications" />
            <SettingsLink href="/statements" icon="description" label="Download statement" />
            <SettingsLink href="/guarantees" icon="handshake" label="Loans I guarantee" />
          </div>
        </section>

        <section id="password" className="scroll-mt-20">
          <ChangePasswordForm />
        </section>

        <SignOutButton />
      </div>
    </MemberShell>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: unknown;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div className="bg-surface-container border-surface-container-high rounded-xl border p-3 text-center">
      <p className="text-label-md font-label-md text-on-surface-variant">{label}</p>
      <Money
        value={value}
        className={`text-body-md font-body-md mt-1 block font-bold ${
          tone === 'error' ? 'text-error' : 'text-on-surface'
        }`}
      />
    </div>
  );
}

function SettingsLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link
      href={href}
      className="hover:bg-surface-container-low flex min-h-touch-target-min items-center gap-3 px-4 py-3 transition-colors"
    >
      <Icon name={icon} size={20} className="text-on-surface-variant shrink-0" />
      <span className="text-body-md font-body-md text-on-surface flex-1">{label}</span>
      <Icon name="chevron_right" size={20} className="text-on-surface-variant shrink-0" />
    </Link>
  );
}
