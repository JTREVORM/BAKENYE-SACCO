import { createClient } from '@/lib/supabase/server';
import { can, type Access } from '@/lib/rbac';
import { Badge, Icon, type BadgeTone } from '@/components/ui/primitives';
import { IssuePasswordButton } from './TemporaryPassword';
import { createMemberLogin, resetUserPassword } from '@/app/actions/members';
import { formatAgo, formatDateTime, formatPhone } from '@/lib/format';
import type { AccountLoginStatus } from '@/types/access';
import type { MemberStatus } from '@/types/db';

/**
 * A member's login, as staff see it: whether they can sign in, what they sign
 * in with, and whether they have chosen a password - never the password.
 *
 * Suspending or activating is the member status control beside the identity
 * card; a suspended member cannot sign in and an existing session reads
 * nothing. "Reset password" gives the member a new temporary password, which
 * they must change at their next sign-in.
 */
export async function MemberAccountPanel({
  member,
  viewer,
}: {
  member: { id: string; member_no: string; phone: string; full_name: string; status: MemberStatus; user_id: string | null };
  viewer: Access;
}) {
  let login: AccountLoginStatus | null = null;
  if (member.user_id) {
    const supabase = await createClient();
    const { data } = await supabase.rpc('account_login_status', { p_user_id: member.user_id });
    login = (data as AccountLoginStatus | null) ?? null;
  }

  const barred = ['suspended', 'inactive', 'archived', 'exited'].includes(member.status);
  const [label, tone]: [string, BadgeTone] = !member.user_id
    ? ['No login yet', 'neutral']
    : member.status === 'suspended'
      ? ['Suspended', 'error']
      : barred || (login && !login.is_active)
        ? ['Inactive', 'neutral']
        : login?.must_change_password
          ? ['Temporary password', 'warning']
          : ['Active', 'success'];

  const mayReset = can(viewer, 'members.manage');
  const mayCreate = can(viewer, 'members.manage') || can(viewer, 'members.create');

  return (
    <section className="bg-surface shadow-card overflow-hidden rounded-xl" aria-labelledby="account-heading">
      <div className="border-outline-variant flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-2">
          <Icon name="login" size={20} className="text-primary" />
          <h2 id="account-heading" className="text-button-text text-on-surface font-bold">
            Account &amp; sign-in
          </h2>
          <Badge tone={tone} dot>
            {label}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {!barred && (member.user_id ? mayReset : mayCreate) ? (
            <IssuePasswordButton
              action={member.user_id ? resetUserPassword : createMemberLogin}
              fields={member.user_id ? { user_id: member.user_id } : { member_id: member.id }}
              label={member.user_id ? 'Reset password' : 'Create login'}
              icon={member.user_id ? 'key' : 'person_add'}
              title={member.user_id ? 'Reset password' : 'Create a login'}
              description={member.user_id
                ? `Give ${member.full_name} a new temporary password. Check who they are first - their current password stops working at once.`
                : `Create ${member.full_name}'s login with a temporary password, which they change at first sign-in.`}
              confirmLabel={member.user_id ? 'Reset password' : 'Create login'}
              who={member.full_name}
              identifier={member.member_no}
              variant={member.user_id ? 'outline' : 'primary'}
            />
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Item label="Signs in with">
          <span className="font-mono">{member.member_no}</span> or{' '}
          <span className="tabular">{formatPhone(member.phone)}</span>
        </Item>
        <Item label="Password">
          {!member.user_id
            ? '—'
            : login?.must_change_password
              ? 'Temporary - must be changed at next sign-in'
              : login?.password_set_at
                ? `Chosen by the member ${formatAgo(login.password_set_at)}`
                : 'Chosen by the member'}
        </Item>
        <Item label="Last sign-in">
          {login?.last_login_at ? formatDateTime(login.last_login_at) : member.user_id ? 'Never' : '—'}
        </Item>
        <Item label="Account">
          {!member.user_id ? 'Not created' : login?.is_active ? 'Enabled' : 'Switched off'}
        </Item>
      </dl>

      {login && (login.recent_failures > 0 || login.paused_until) ? (
        <p className="border-outline-variant text-body-md text-on-surface-variant border-t px-4 py-3">
          {login.recent_failures} failed sign-in {login.recent_failures === 1 ? 'attempt' : 'attempts'} in the last 24 hours
          {login.paused_until ? `. Sign-in is paused until ${formatDateTime(login.paused_until)}.` : '.'}
        </p>
      ) : null}
      {barred ? (
        <p className="border-outline-variant text-body-md text-on-surface-variant border-t px-4 py-3">
          A {member.status} member cannot sign in, and any session they still have reads nothing. Change
          their status to let them back in.
        </p>
      ) : null}
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md text-on-surface-variant font-normal">{label}</dt>
      <dd className="text-body-md text-on-surface mt-0.5 break-words font-semibold">{children}</dd>
    </div>
  );
}
