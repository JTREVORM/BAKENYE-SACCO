import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getRoles } from '@/lib/access-queries';
import { can } from '@/lib/rbac';
import { PageTitle, Avatar, Badge, Icon } from '@/components/ui/primitives';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { CreateStaffButton } from './CreateStaffButton';
import { UserRowActions } from './UserRowActions';
import { formatAgo, formatDate, formatPhone } from '@/lib/format';
import { clsx } from '@/lib/clsx';
import type { AppUserRow } from '@/types/db';
import type { RoleRow } from '@/types/access';
import { ScrollRow } from '@/components/ui/scroll';

export const metadata: Metadata = { title: 'Users' };

/**
 * Staff accounts.
 *
 * Who can sign in to the back office, with which role. Member logins are not
 * listed here: a member's sign-in belongs to their member record and is
 * managed from it. What each role may do is on Roles & Permissions.
 */
export default async function UsersPage() {
  const me = await requirePermission('users.manage');
  const roles = await getRoles();
  const assignable = roles
    .filter((r) => r.kind === 'staff' && r.status === 'active')
    .filter((r) => r.key !== 'super_admin' || me.role === 'super_admin')
    .map((r) => ({ key: r.key, name: r.name, description: r.description }));

  return (
    <div>
      <PageTitle
        title="Users"
        subtitle="Staff accounts: who can sign in to the back office, and with which role."
        action={<CreateStaffButton roles={assignable} />}
      />

      <Suspense fallback={<TableSkeleton rows={6} cols={5} />}>
        <UserList currentUserId={me.id} roles={roles} assignable={assignable} />
      </Suspense>

      {can(me, 'roles.manage') ? (
        <Link
          href="/staff/roles"
          className="bg-surface shadow-card mt-6 flex items-center gap-4 rounded-2xl p-4 transition-shadow hover:shadow-card-hover"
        >
          <span className="bg-surface text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-neu-sm">
            <Icon name="shield_person" size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-button-text text-on-surface block">Roles &amp; Permissions</span>
            <span className="text-body-md text-on-surface-variant block">
              Decide what each role can do, or create a new role.
            </span>
          </span>
          <Icon name="chevron_right" size={20} className="text-on-surface-variant" />
        </Link>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

async function UserList({
  currentUserId,
  roles,
  assignable,
}: {
  currentUserId: string;
  roles: RoleRow[];
  assignable: { key: string; name: string; description: string | null }[];
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_users')
    .select('*')
    .order('is_active', { ascending: false })
    .order('full_name');

  if (error) {
    return <ErrorState title="Unable to load users" />;
  }

  const kindOf = new Map(roles.map((r) => [r.key, r.kind]));
  const nameOf = new Map(roles.map((r) => [r.key, r.name]));
  const all = (data ?? []) as AppUserRow[];
  const users = all.filter((u) => kindOf.get(u.role) === 'staff');
  const memberLogins = all.filter((u) => kindOf.get(u.role) === 'member' && u.is_active).length;
  // Sign-ups nobody provisioned arrive switched off with no member record.
  const unprovisioned = all.filter((u) => kindOf.get(u.role) === 'member' && !u.is_active).length;

  return (
    <>
      <p className="text-body-md text-on-surface-variant mb-4">
        {users.filter((u) => u.is_active).length} active staff{' '}
        {users.filter((u) => u.is_active).length === 1 ? 'account' : 'accounts'}.{' '}
        {memberLogins > 0
          ? `${memberLogins} member ${memberLogins === 1 ? 'login is' : 'logins are'} managed from ${memberLogins === 1 ? 'that member’s' : 'each member’s'} record.`
          : null}
      </p>

      {unprovisioned > 0 ? (
        <p className="text-label-md text-on-surface-variant mb-4 font-normal">
          {unprovisioned} self-registered {unprovisioned === 1 ? 'account is' : 'accounts are'} switched
          off and can reach nothing. Turn off public sign-up in the Supabase dashboard to stop more.
        </p>
      ) : null}

      {users.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="manage_accounts"
            title="No staff accounts"
            description="Create the first staff account to get started."
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-2 lg:hidden">
            {users.map((u) => (
              <li
                key={u.id}
                className={clsx(
                  'bg-surface border-surface-container shadow-card rounded-xl border p-3',
                  !u.is_active && 'opacity-60',
                )}
              >
                <div className="flex items-start gap-3">
                  <Avatar name={u.full_name} src={u.photo_url} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                      {u.full_name}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant truncate normal-case">
                      {signInWith(u)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge tone={u.role === 'super_admin' ? 'info' : 'neutral'}>
                        {nameOf.get(u.role) ?? u.role}
                      </Badge>
                      <Badge tone={u.is_active ? 'success' : 'error'}>
                        {u.is_active ? 'Active' : 'Deactivated'}
                      </Badge>
                      {!u.password_set_at ? <Badge tone="warning">Setup pending</Badge> : null}
                    </div>
                    <p className="text-label-md font-label-md text-on-surface-variant/70 mt-2 normal-case">
                      {u.last_login_at ? `Last signed in ${formatAgo(u.last_login_at)}` : 'Never signed in'}
                    </p>
                  </div>
                </div>

                {u.id !== currentUserId ? (
                  <div className="border-outline-variant mt-3 border-t pt-3">
                    <UserRowActions
                      userId={u.id}
                      name={u.full_name}
                      role={u.role}
                      roleName={nameOf.get(u.role) ?? u.role}
                      roles={assignable}
                      isActive={u.is_active}
                      phone={u.phone}
                    />
                  </div>
                ) : (
                  <p className="text-label-md font-label-md text-on-surface-variant mt-3 normal-case">
                    This is your own account.
                  </p>
                )}
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="bg-surface shadow-card hidden overflow-hidden rounded-xl lg:block">
            <ScrollRow arrows="overlay" label="Table, scrolls sideways">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                    <th className="p-4 font-semibold">User</th>
                    <th className="p-4 font-semibold">Role</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold">Last Login</th>
                    <th className="p-4 text-center font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className={clsx(
                        'hover:bg-surface-container-low transition-colors',
                        !u.is_active && 'opacity-60',
                      )}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <Avatar name={u.full_name} src={u.photo_url} size={36} />
                          <div className="min-w-0">
                            <div className="text-on-surface truncate font-semibold">{u.full_name}</div>
                            <div className="text-on-surface-variant truncate text-xs">{signInWith(u)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge tone={u.role === 'super_admin' ? 'info' : 'neutral'}>
                          {nameOf.get(u.role) ?? u.role}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone={u.is_active ? 'success' : 'error'}>
                            {u.is_active ? 'Active' : 'Deactivated'}
                          </Badge>
                          {!u.password_set_at ? <Badge tone="warning">Setup pending</Badge> : null}
                        </div>
                      </td>
                      <td className="text-on-surface-variant whitespace-nowrap p-4">
                        {u.last_login_at ? formatDate(u.last_login_at) : 'Never'}
                      </td>
                      <td className="p-4">
                        {u.id !== currentUserId ? (
                          <UserRowActions
                            userId={u.id}
                            name={u.full_name}
                            role={u.role}
                            roleName={nameOf.get(u.role) ?? u.role}
                            roles={assignable}
                            isActive={u.is_active}
                            phone={u.phone}
                          />
                        ) : (
                          <span className="text-on-surface-variant text-label-md font-label-md block text-center normal-case">
                            You
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRow>
          </div>
        </>
      )}
    </>
  );
}

/** What a colleague types to sign in: their phone, their email, or both. */
function signInWith(u: AppUserRow): string {
  const ids = [u.phone ? formatPhone(u.phone) : null, u.email].filter(Boolean);
  return ids.length ? `Signs in with ${ids.join(' or ')}` : 'No sign-in identifier - add a phone number';
}
