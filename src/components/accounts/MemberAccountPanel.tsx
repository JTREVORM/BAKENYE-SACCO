import { createClient } from '@/lib/supabase/server';
import { can, type Access } from '@/lib/rbac';
import { Badge, Icon, type BadgeTone } from '@/components/ui/primitives';
import { IssueCodeButton } from './SetupCode';
import { createMemberLogin, issueResetCode } from '@/app/actions/members';
import { formatAgo, formatDateTime, formatPhone } from '@/lib/format';
import type { AccountLoginStatus } from '@/types/access';
import type { MemberStatus } from '@/types/db';

/**
 * A member's login, as staff see it: whether they can sign in, what they sign
 * in with, and whether they have chosen a password - never the password.
 *
 * Suspending or activating is the member status control beside the identity
 * card; a suspended member cannot sign in and an existing session reads
 * nothing. "Reset password" issues a one-time code for the member to choose a
 * new password with.
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
        : login?.password_set_at
          ? ['Active', 'success']
          : ['Awaiting password setup', 'warning'];

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
          {member.user_id && mayReset && !barred ? (
            <IssueCodeButton
              action={issueResetCode}
              fields={{ user_id: member.user_id, purpose: login?.password_set_at ? 'reset' : 'setup' }}
              label={login?.password_set_at ? 'Initiate password reset' : 'New setup code'}
              title={login?.password_set_at ? 'Initiate password reset' : 'New setup code'}
              description={`Issue ${member.full_name} a one-time code to choose ${login?.password_set_at ? 'a new' : 'their'} password with. Check who they are first.`}
              confirmLabel="Issue code"
              who={member.full_name}
              identifier={member.member_no}
            />
          ) : null}
          {!member.user_id && mayCreate && !barred ? (
            <IssueCodeButton
              action={createMemberLogin}
              fields={{ member_id: member.id }}
              label="Create login"
              icon="person_add"
              title="Create a login"
              description={`Create ${member.full_name}'s login and a one-time setup code for them to choose their password with.`}
              confirmLabel="Create login"
              who={member.full_name}
              identifier={member.member_no}
              variant="primary"
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
            : login?.password_set_at
              ? `Chosen by the member ${formatAgo(login.password_set_at)}`
              : 'Not chosen yet'}
        </Item>
        <Item label="Last sign-in">
          {login?.last_login_at ? formatDateTime(login.last_login_at) : member.user_id ? 'Never' : '—'}
        </Item>
        <Item label="Setup / reset code">
          {login?.pending_code
            ? `Issued, valid until ${formatDateTime(login.pending_code.expires_at)}`
            : 'None outstanding'}
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
