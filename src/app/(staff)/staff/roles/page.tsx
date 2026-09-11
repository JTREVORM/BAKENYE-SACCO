import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getEffectivePermissions, getPermissions, getRoles } from '@/lib/access-queries';
import { Badge, Icon, PageTitle } from '@/components/ui/primitives';
import { ScrollRow } from '@/components/ui/scroll';
import { clsx } from '@/lib/clsx';
import { RolePermissionEditor } from './RolePermissionEditor';
import { NewRoleButton, RoleSettingsButton } from './RoleDialogs';
import type { PermissionRow, RoleRow } from '@/types/access';

export const metadata: Metadata = { title: 'Roles & Permissions' };

/**
 * Roles & Permissions.
 *
 * Every role, what it may do, and who holds it - read from the database and
 * edited here. A switch turned off on this screen is off in Postgres as well:
 * `has_permission()` reads the same rows, so the REST API obeys it exactly as
 * the application does.
 */
export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const me = await requirePermission('roles.manage');
  const { role: selectedKey } = await searchParams;

  const supabase = await createClient();
  const [roles, permissions, effective, { data: users }] = await Promise.all([
    getRoles(),
    getPermissions(),
    getEffectivePermissions(),
    supabase.from('app_users').select('role, is_active'),
  ]);

  const holders = new Map<string, number>();
  for (const u of (users ?? []) as { role: string; is_active: boolean }[]) {
    if (u.is_active) holders.set(u.role, (holders.get(u.role) ?? 0) + 1);
  }

  const selected = roles.find((r) => r.key === selectedKey) ?? roles.find((r) => r.key === 'admin') ?? roles[0];
  const isSuperAdmin = me.role === 'super_admin';
  const staffPermissions = permissions.filter((p) => p.scope === 'staff');
  const staffRoles = roles.filter((r) => r.kind === 'staff' && r.status === 'active');

  return (
    <div className="space-y-6">
      <PageTitle
        icon="shield_person"
        title="Roles & Permissions"
        subtitle="What each role can do. A change here is enforced by the database immediately."
        breadcrumb={[{ label: 'Staff', href: '/staff' }, { label: 'Users', href: '/staff/users' }, { label: 'Roles & Permissions' }]}
        action={<NewRoleButton permissions={staffPermissions} isSuperAdmin={isSuperAdmin} />}
      />

      <nav aria-label="Roles">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => (
            <RoleCard
              key={r.key}
              role={r}
              selected={r.key === selected?.key}
              holders={holders.get(r.key) ?? 0}
              permissionCount={
                r.key === 'super_admin'
                  ? staffPermissions.length
                  : [...(effective.get(r.key) ?? [])].filter((k) => !permissions.find((p) => p.key === k)?.is_core).length
              }
            />
          ))}
        </ul>
      </nav>

      {selected ? (
        <section className="bg-surface shadow-neu overflow-hidden rounded-2xl" aria-labelledby="role-editor-title">
          <header className="border-outline-variant/70 flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="role-editor-title" className="text-title-md text-on-surface">
                  {selected.name}
                </h2>
                <Badge tone={selected.kind === 'member' ? 'accent' : 'info'}>
                  {selected.kind === 'member' ? 'Member portal' : 'Staff'}
                </Badge>
                {selected.is_system ? <Badge tone="neutral">Built in</Badge> : <Badge tone="accent">Custom</Badge>}
                {selected.status !== 'active' ? <Badge tone="neutral">Retired</Badge> : null}
              </div>
              {selected.description ? (
                <p className="text-body-md text-on-surface-variant mt-1 max-w-3xl">{selected.description}</p>
              ) : null}
            </div>
            {selected.key !== 'super_admin' ? (
              <RoleSettingsButton
                role={{
                  key: selected.key,
                  name: selected.name,
                  description: selected.description,
                  status: selected.status,
                  fixedName: selected.key === 'member',
                  retirable: selected.key !== 'member',
                }}
              />
            ) : null}
          </header>

          <RolePermissionEditor
            key={selected.key}
            role={{ key: selected.key, name: selected.name, kind: selected.kind }}
            permissions={permissions.filter((p) => p.scope === selected.kind)}
            granted={[...(effective.get(selected.key) ?? [])]}
            locked={selected.key === 'super_admin'}
            ownRole={me.role === selected.key}
            isSuperAdmin={isSuperAdmin}
          />
        </section>
      ) : null}

      <ComparisonMatrix roles={staffRoles} permissions={staffPermissions} effective={effective} />
    </div>
  );
}

function RoleCard({
  role,
  selected,
  holders,
  permissionCount,
}: {
  role: RoleRow;
  selected: boolean;
  holders: number;
  permissionCount: number;
}) {
  return (
    <li>
      <Link
        href={`/staff/roles?role=${role.key}`}
        aria-current={selected ? 'true' : undefined}
        className={clsx(
          'flex h-full flex-col gap-2 rounded-2xl p-4 transition-[box-shadow,background-color]',
          selected
            ? 'bg-primary-fixed shadow-neu-inset ring-2 ring-primary/40'
            : 'bg-surface shadow-neu hover:shadow-card-hover',
          role.status !== 'active' && 'opacity-60',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="bg-surface text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-neu-sm">
              <Icon name={role.kind === 'member' ? 'person' : role.key === 'super_admin' ? 'verified_user' : 'badge'} size={18} />
            </span>
            <span className="text-body-lg text-on-surface truncate font-semibold">{role.name}</span>
          </span>
          {role.status !== 'active' ? <Badge tone="neutral">Retired</Badge> : null}
        </div>
        <p className="text-label-md text-on-surface-variant font-normal">
          {holders} {role.kind === 'member' ? (holders === 1 ? 'member login' : 'member logins') : holders === 1 ? 'account' : 'accounts'}
          {' · '}
          {role.key === 'super_admin' ? 'every permission' : `${permissionCount} ${permissionCount === 1 ? 'permission' : 'permissions'} beyond the basics`}
        </p>
      </Link>
    </li>
  );
}

/**
 * The same rows as the editor, side by side, for comparing roles at a glance.
 * Read-only; generated from what the database enforces.
 */
function ComparisonMatrix({
  roles,
  permissions,
  effective,
}: {
  roles: RoleRow[];
  permissions: PermissionRow[];
  effective: Map<string, Set<string>>;
}) {
  const rows = permissions.filter((p) => !p.is_core);

  return (
    <section className="bg-surface shadow-card overflow-hidden rounded-2xl">
      <div className="border-outline-variant border-b p-4">
        <h2 className="text-button-text font-button-text text-on-surface font-bold">Compare staff roles</h2>
        <p className="text-body-md font-body-md text-on-surface-variant mt-0.5">
          Generated from the permissions the database enforces. Every member of staff can also view
          the member register, categories, savings, transactions and reports.
        </p>
      </div>
      <ScrollRow arrows="overlay" className="scroll-x" label="Table, scrolls sideways">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
              <th className="p-3 font-semibold">Permission</th>
              {roles.map((r) => (
                <th key={r.key} className="whitespace-nowrap p-3 text-center font-semibold">
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
            {rows.map((p) => (
              <tr key={p.key}>
                <td className="p-3">
                  <span className="block">{p.label}</span>
                  <span className="text-label-md text-on-surface-variant block font-normal">{p.module}</span>
                </td>
                {roles.map((r) => {
                  const allowed = effective.get(r.key)?.has(p.key) ?? false;
                  return (
                    <td key={r.key} className="p-3 text-center">
                      <span
                        className={clsx('material-symbols-outlined text-[20px]', allowed ? 'text-tertiary' : 'text-outline-variant')}
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
        Members see only their own savings, shares, loans, transactions and statements, read-only.
        That boundary is enforced by row-level security in the database, not just by this application.
      </p>
    </section>
  );
}
