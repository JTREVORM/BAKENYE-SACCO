import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageTitle, Avatar, Badge } from '@/components/ui/primitives';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { CreateStaffButton } from './CreateStaffButton';
import { UserRowActions } from './UserRowActions';
import { ROLE_LABELS, ROLE_PERMISSIONS, STAFF_ROLES, type Role } from '@/lib/rbac';
import { formatAgo, formatDate } from '@/lib/format';
import { clsx } from '@/lib/clsx';
import type { AppUserRow } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

export const metadata: Metadata = { title: 'Users & Roles' };

/**
 * Users and roles.
 *
 * A port of `user_roles_permissions_desktop/code.html`, with the permission
 * matrix filled in from `ROLE_PERMISSIONS` rather than drawn — so the table on
 * screen is the access control that is actually enforced, and cannot drift away
 * from it.
 */
export default async function UsersPage() {
  const me = await requirePermission('users.manage');

  return (
    <div>
      <PageTitle
        title="Roles & Permissions"
        subtitle="Who can sign in, and what each role is allowed to do."
        action={<CreateStaffButton />}
      />

      <Suspense fallback={<TableSkeleton rows={6} cols={5} />}>
        <UserList currentUserId={me.id} />
      </Suspense>

      <PermissionMatrix />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

async function UserList({ currentUserId }: { currentUserId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_users')
    .select('*')
    .order('is_active', { ascending: false })
    .order('full_name');

  if (error) {
    return <ErrorState title="Unable to load users" />;
  }

  const users = (data ?? []) as AppUserRow[];

  if (users.length === 0) {
    return (
      <div className="bg-surface rounded-xl shadow-neu-sm">
        <EmptyState
          icon="manage_accounts"
          title="No users"
          description="Create the first staff account to get started."
        />
      </div>
    );
  }

  return (
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
                  {u.email ?? '—'}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={u.role === 'super_admin' ? 'info' : 'neutral'}>
                    {ROLE_LABELS[u.role as Role]}
                  </Badge>
                  <Badge tone={u.is_active ? 'success' : 'error'}>
                    {u.is_active ? 'Active' : 'Deactivated'}
                  </Badge>
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
                  role={u.role as Role}
                  isActive={u.is_active}
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
                <th className="p-4 font-semibold">Assigned Role</th>
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
                        <div className="text-on-surface-variant truncate text-xs">
                          {u.email ?? '—'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <Badge tone={u.role === 'super_admin' ? 'info' : 'neutral'}>
                      {ROLE_LABELS[u.role as Role]}
                    </Badge>
                  </td>
                  <td className="p-4">
                    <Badge tone={u.is_active ? 'success' : 'error'}>
                      {u.is_active ? 'Active' : 'Deactivated'}
                    </Badge>
                  </td>
                  <td className="text-on-surface-variant p-4 whitespace-nowrap">
                    {u.last_login_at ? formatDate(u.last_login_at) : 'Never'}
                  </td>
                  <td className="p-4">
                    {u.id !== currentUserId ? (
                      <UserRowActions
                        userId={u.id}
                        name={u.full_name}
                        role={u.role as Role}
                        isActive={u.is_active}
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
  );
}

/* ------------------------------------------------------------------------ */

const MATRIX_ROWS: { label: string; permission: keyof typeof PERMISSION_LOOKUP }[] = [
  { label: 'View members', permission: 'members.view' },
  { label: 'Register & edit members', permission: 'members.manage' },
  { label: 'Change member status', permission: 'members.status' },
  { label: 'View categories', permission: 'categories.view' },
  { label: 'Manage categories', permission: 'categories.manage' },
  { label: 'Waive a savings schedule', permission: 'savings.waive' },
  { label: 'Sell shares', permission: 'shares.sell' },
  { label: 'Record savings', permission: 'savings.record' },
  { label: 'Assess loan applications', permission: 'loans.assess' },
  { label: 'Approve loans', permission: 'loans.approve' },
  { label: 'Disburse loans', permission: 'loans.disburse' },
  { label: 'Record repayments', permission: 'loans.repay' },
  { label: 'Deposits & withdrawals', permission: 'cash.movement' },
  { label: 'Record income & expenses', permission: 'finance.record' },
  { label: 'Approve expenses', permission: 'finance.approve' },
  { label: 'Reverse transactions', permission: 'transactions.reverse' },
  { label: 'View reports', permission: 'reports.view' },
  { label: 'Manage users & roles', permission: 'users.manage' },
  { label: 'View audit log', permission: 'audit.view' },
];

// Referenced only for its key type, so the matrix cannot name a permission that
// does not exist.
const PERMISSION_LOOKUP = ROLE_PERMISSIONS.super_admin.reduce(
  (acc, p) => ({ ...acc, [p]: true }),
  {} as Record<(typeof ROLE_PERMISSIONS)['super_admin'][number], true>,
);

const MATRIX_ROLES: Role[] = [...STAFF_ROLES];

function PermissionMatrix() {
  return (
    <section className="bg-surface shadow-card mt-8 overflow-hidden rounded-xl">
      <div className="border-outline-variant bg-surface border-b p-4">
        <h2 className="text-button-text font-button-text text-on-surface font-bold">
          What each role can do
        </h2>
        <p className="text-body-md font-body-md text-on-surface-variant mt-0.5">
          This table is generated from the access rules the application enforces, so it is always
          accurate.
        </p>
      </div>

      <ScrollRow arrows="overlay" className="scroll-x" label="Table, scrolls sideways">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
              <th className="p-3 font-semibold">Capability</th>
              {MATRIX_ROLES.map((r) => (
                <th key={r} className="p-3 text-center font-semibold">
                  {ROLE_LABELS[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
            {MATRIX_ROWS.map((row) => (
              <tr key={row.permission}>
                <td className="p-3">{row.label}</td>
                {MATRIX_ROLES.map((role) => {
                  const allowed = (ROLE_PERMISSIONS[role] as readonly string[]).includes(
                    row.permission,
                  );
                  return (
                    <td key={role} className="p-3 text-center">
                      <span
                        className={clsx(
                          'material-symbols-outlined text-[20px]',
                          allowed ? 'text-tertiary' : 'text-outline-variant',
                        )}
                        aria-label={allowed ? 'Allowed' : 'Not allowed'}
                        role="img"
                      >
                        {allowed ? 'check_circle' : 'block'}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRow>

      <p className="text-label-md font-label-md text-on-surface-variant border-outline-variant border-t p-4 normal-case">
        Members see only their own savings, shares, loans, transactions and statements. That
        boundary is enforced by row-level security in the database, not just by this application.
      </p>
    </section>
  );
}
