import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberFinancials, getUnreadCount } from '@/lib/queries';
import { MemberShell } from '@/components/layout/MemberShell';
import { Icon, Avatar, Money } from '@/components/ui/primitives';
import { MemberStatusBadge } from '@/components/ui/status';
import { SignOutButton } from '@/components/SignOutButton';
import { formatDate, formatPhone } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import { SAVINGS_FREQUENCY_ADVERB } from '@/lib/categories';

export const metadata: Metadata = { title: 'My Profile' };

/**
 * Member profile - read-only.
 *
 * A member's name, phone number, member number, membership date, categories
 * and status are the SACCO's official record of them. Members see it here;
 * only authorised staff can change it, and the database refuses a change from
 * anyone else however it is sent. So there is no edit button and no form on
 * this page, only the record and how to get it corrected.
 */
export default async function ProfilePage() {
  const user = await requireMember();
  const [m, unread] = await Promise.all([getMemberFinancials(user.memberId), getUnreadCount()]);

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
        {/* Header */}
        <section className="bg-surface-container-lowest border-surface-container-high shadow-card relative flex flex-col items-center justify-center overflow-hidden rounded-xl py-6">
          <div className="from-primary via-surface to-surface pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] opacity-5" />
          <div className="relative z-10 mb-4">
            <Avatar name={m.full_name} src={m.photo_url} size={96} className="border-surface border-4 shadow-md" />
          </div>
          <div className="relative z-10 px-4 text-center">
            <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">{m.full_name}</h1>
            <p className="text-body-md font-body-md text-on-surface-variant tabular mt-1 font-mono">{m.member_no}</p>
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

        <div className="bg-primary-fixed text-on-primary-fixed-variant flex items-start gap-3 rounded-2xl p-4">
          <Icon name="lock" size={20} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-button-text">Your SACCO profile is managed by authorized SACCO staff.</p>
            <p className="text-body-md mt-0.5">
              If anything here is wrong - or your phone number has changed - visit the SACCO office with
              your National ID and staff will update your record.
            </p>
          </div>
        </div>

        {/* Money at a glance */}
        <section className="grid grid-cols-3 gap-2">
          <Stat label="Savings" value={m.savings_balance} />
          <Stat label="Shares" value={m.share_value} />
          <Stat label="Loan" value={m.loan_balance} tone={Number(m.loan_balance) > 0 ? 'error' : 'neutral'} />
        </section>

        <Card title="Membership">
          <Item icon="badge" label="Member number" value={m.member_no} mono />
          <Item icon="event" label="Membership date" value={formatDate(m.joined_on)} />
          <Item icon="verified_user" label="Status" value={<MemberStatusBadge status={m.status} />} />
          <Item
            icon="pie_chart"
            label="Share category"
            value={m.share_category_name ?? 'Not assigned'}
          />
          <Item
            icon="savings"
            label="Savings category"
            value={
              m.savings_category_name
                ? `${m.savings_category_name}${
                    m.savings_expected_amount && m.savings_frequency
                      ? ` · ${formatUGX(m.savings_expected_amount)} ${SAVINGS_FREQUENCY_ADVERB[m.savings_frequency]}`
                      : ''
                  }`
                : 'Not assigned'
            }
          />
        </Card>

        <Card title="Personal information">
          <Item icon="person" label="Full name" value={m.full_name} />
          <Item icon="phone" label="Phone number" value={formatPhone(m.phone)} mono />
          <Item icon="mail" label="Email" value={m.email ?? 'Not recorded'} />
          <Item icon="assignment" label="National ID" value={m.national_id ?? 'Not recorded'} mono />
          <Item icon="cake" label="Date of birth" value={m.date_of_birth ? formatDate(m.date_of_birth) : 'Not recorded'} />
          <Item icon="work" label="Occupation" value={m.occupation ?? 'Not recorded'} />
          <Item icon="location_on" label="Address" value={m.address ?? 'Not recorded'} />
        </Card>

        <Card title="Next of kin">
          {m.next_of_kin_name ? (
            <>
              <Item icon="handshake" label="Name" value={m.next_of_kin_name} />
              <Item icon="group" label="Relationship" value={m.next_of_kin_relation ?? 'Not recorded'} />
              <Item icon="phone" label="Phone" value={m.next_of_kin_phone ? formatPhone(m.next_of_kin_phone) : 'Not recorded'} mono />
            </>
          ) : (
            <p className="text-body-md text-on-surface-variant px-4 py-3">No next of kin is recorded.</p>
          )}
        </Card>

        <section className="bg-surface-container-lowest border-surface-container-high shadow-card overflow-hidden rounded-xl border">
          <div className="border-surface-container-high bg-surface-container-low/50 border-b px-4 py-3">
            <h2 className="text-button-text font-button-text text-on-surface">More</h2>
          </div>
          <div className="divide-surface-container-high divide-y">
            <SettingsLink href="/statements" icon="description" label="Download statement" />
            <SettingsLink href="/notifications" icon="notifications_active" label="Notifications" />
            <SettingsLink href="/guarantees" icon="handshake" label="Loans I guarantee" />
          </div>
        </section>

        <p className="text-label-md text-on-surface-variant text-center font-normal normal-case">
          You sign in with your member number and your registered phone number. There is no password to
          remember.
        </p>

        <SignOutButton />
      </div>
    </MemberShell>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: unknown; tone?: 'neutral' | 'error' }) {
  return (
    <div className="bg-surface-container border-surface-container-high rounded-xl border p-3 text-center">
      <p className="text-label-md font-label-md text-on-surface-variant">{label}</p>
      <Money
        value={value}
        className={`text-body-md font-body-md mt-1 block font-bold ${tone === 'error' ? 'text-error' : 'text-on-surface'}`}
      />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface-container-lowest border-surface-container-high shadow-card overflow-hidden rounded-xl border">
      <div className="border-surface-container-high bg-surface-container-low/50 border-b px-4 py-3">
        <h2 className="text-button-text font-button-text text-on-surface">{title}</h2>
      </div>
      <dl className="divide-surface-container-high divide-y">{children}</dl>
    </section>
  );
}

function Item({
  icon,
  label,
  value,
  mono,
}: {
  icon: string;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Icon name={icon} size={20} className="text-on-surface-variant mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <dt className="text-label-md font-label-md text-on-surface-variant">{label}</dt>
        <dd className={`text-body-md text-on-surface mt-0.5 break-words font-semibold ${mono ? 'tabular' : ''}`}>{value}</dd>
      </div>
    </div>
  );
}

function SettingsLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link
      href={href}
      className="hover:bg-surface-container-low min-h-touch-target-min flex items-center gap-3 px-4 py-3 transition-colors"
    >
      <Icon name={icon} size={20} className="text-on-surface-variant shrink-0" />
      <span className="text-body-md font-body-md text-on-surface flex-1">{label}</span>
      <Icon name="chevron_right" size={20} className="text-on-surface-variant shrink-0" />
    </Link>
  );
}
