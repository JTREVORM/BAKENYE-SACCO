'use client';

import { useActionState, useMemo, useState } from 'react';
import { saveRolePermissions } from '@/app/actions/roles';
import { Alert } from '@/components/ui/states';
import { Badge, Icon } from '@/components/ui/primitives';
import { Field, SubmitButton, Textarea } from '@/components/ui/form';
import { clsx } from '@/lib/clsx';
import type { ActionResult } from '@/lib/errors';
import type { PermissionRow, RoleKind } from '@/types/access';

/**
 * One role's permissions, grouped by module, as switches.
 *
 * Core permissions are shown as "Always" - every role of that kind holds them.
 * The permissions that decide who else gets permissions are marked "Super
 * Admin only", and the database refuses anyone else who tries. Nobody may edit
 * their own role here; that is how an Admin would otherwise grant themselves
 * everything.
 */
export function RolePermissionEditor({
  role,
  permissions,
  granted,
  locked,
  ownRole,
  isSuperAdmin,
}: {
  role: { key: string; name: string; kind: RoleKind };
  permissions: PermissionRow[];
  granted: string[];
  /** The Super Admin role: always everything. */
  locked: boolean;
  ownRole: boolean;
  isSuperAdmin: boolean;
}) {
  const initial = useMemo(() => new Set(granted), [granted]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(granted));
  const [state, action] = useActionState<ActionResult<{ granted: string[]; withdrawn: string[] }> | null, FormData>(
    saveRolePermissions,
    null,
  );
  const err = state && !state.ok ? state : null;

  const modules = useMemo(() => {
    const m = new Map<string, PermissionRow[]>();
    for (const p of permissions) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [permissions]);

  const editable = !locked && !ownRole;
  const added = [...selected].filter((k) => !initial.has(k));
  const removed = [...initial].filter((k) => !selected.has(k) && !permissions.find((p) => p.key === k)?.is_core);
  const dirty = added.length + removed.length > 0;

  function toggle(key: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <form action={action} className="flex flex-col" noValidate>
      <input type="hidden" name="role_key" value={role.key} />
      {[...selected]
        .filter((k) => !permissions.find((p) => p.key === k)?.is_core)
        .map((k) => (
          <input key={k} type="hidden" name="permissions" value={k} />
        ))}

      {locked ? (
        <div className="px-5 pt-5">
          <Alert tone="info" title="The Super Admin role always holds every permission">
            It cannot be narrowed, so there is always someone who can fix access if a role is
            misconfigured. Give fewer people this role instead.
          </Alert>
        </div>
      ) : ownRole ? (
        <div className="px-5 pt-5">
          <Alert tone="warning" title="This is your own role">
            Nobody can change the permissions of the role they hold. Ask a Super Admin.
          </Alert>
        </div>
      ) : role.kind === 'member' ? (
        <div className="px-5 pt-5">
          <Alert tone="info" title="Members can only ever hold member-portal permissions">
            Everything a member sees is their own record, read-only. The database refuses any staff
            permission for this role.
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 p-5 lg:grid-cols-2">
        {modules.map(([module, perms]) => (
          <fieldset key={module} className="bg-surface-container rounded-2xl p-3 shadow-neu-inset-sm">
            <legend className="text-label-md text-on-surface-variant px-2 font-semibold uppercase tracking-wide">
              {module}
            </legend>
            <ul className="flex flex-col gap-1.5">
              {perms.map((p) => {
                const on = p.is_core || locked || selected.has(p.key);
                const disabled = !editable || p.is_core || (p.is_sensitive && !isSuperAdmin);
                const changed = !p.is_core && initial.has(p.key) !== selected.has(p.key);
                return (
                  <li key={p.key}>
                    <label
                      className={clsx(
                        'flex items-start gap-3 rounded-xl px-2.5 py-2 transition-colors',
                        disabled ? 'cursor-default' : 'cursor-pointer hover:bg-surface',
                        changed && 'bg-primary-fixed/60',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={disabled}
                        onChange={(e) => toggle(p.key, e.target.checked)}
                        className="text-primary focus:ring-primary border-outline mt-0.5 h-5 w-5 shrink-0 rounded disabled:opacity-60"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-body-md text-on-surface font-semibold">{p.label}</span>
                          {p.is_core ? <Badge tone="neutral">Always</Badge> : null}
                          {p.is_sensitive ? <Badge tone="warning">Super Admin only</Badge> : null}
                        </span>
                        {p.description ? (
                          <span className="text-label-md text-on-surface-variant mt-0.5 block font-normal">
                            {p.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>

      {editable ? (
        <div className="border-outline-variant/70 flex flex-col gap-4 border-t p-5">
          {state?.ok ? <Alert tone="success">{state.message}</Alert> : null}
          {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

          {dirty ? (
            <p className="text-body-md text-on-surface flex items-center gap-2">
              <Icon name="edit" size={18} className="text-primary" />
              {added.length} to grant, {removed.length} to withdraw from {role.name}.
            </p>
          ) : null}

          <Field
            label="Reason"
            htmlFor="role-perm-reason"
            required
            hint="Kept in the audit log with exactly what was granted and withdrawn."
            error={err?.field === 'reason' ? err.error : null}
          >
            <Textarea
              id="role-perm-reason"
              name="reason"
              maxLength={500}
              placeholder="e.g. Cashiers now register walk-in members, as agreed by the board."
            />
          </Field>

          <div className="flex flex-wrap gap-3">
            <SubmitButton size="lg" disabled={!dirty} pendingLabel="Saving…">
              Save permissions
            </SubmitButton>
            {dirty ? (
              <button
                type="button"
                onClick={() => setSelected(new Set(granted))}
                className="text-primary h-touch-target-min rounded-full px-4 font-semibold hover:bg-surface hover:shadow-neu-sm"
              >
                Undo changes
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </form>
  );
}
