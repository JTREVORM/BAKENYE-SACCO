'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createRole, setRoleStatus, updateRole } from '@/app/actions/roles';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/states';
import { Badge } from '@/components/ui/primitives';
import { Button, Field, Input, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { DASHBOARDS } from '@/lib/rbac';
import type { ActionResult } from '@/lib/errors';
import type { PermissionRow } from '@/types/access';

/** Create a staff role, starting from the permissions ticked here. */
export function NewRoleButton({
  permissions,
  isSuperAdmin,
}: {
  permissions: PermissionRow[];
  isSuperAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [state, action] = useActionState<ActionResult<{ role: string; name: string }> | null, FormData>(
    createRole,
    null,
  );
  const err = state && !state.ok ? state : null;

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      router.push(`/staff/roles?role=${state.data.role}`);
    }
  }, [state, router]);

  const modules = [...new Set(permissions.filter((p) => !p.is_core).map((p) => p.module))];

  return (
    <>
      <Button icon="add" onClick={() => setOpen(true)}>
        New role
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a role"
        description="A staff role. Every member of staff can already view members, categories, savings, transactions and reports; tick what else this role may do."
        size="lg"
      >
        <form action={action} className="flex flex-col gap-5" noValidate>
          {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}
          <Field label="Role name" htmlFor="role-name" required error={err?.field === 'name' ? err.error : null}>
            <Input id="role-name" name="name" maxLength={60} placeholder="e.g. Branch Supervisor" required />
          </Field>
          <Field label="Description" htmlFor="role-desc" hint="One line on what people with this role do.">
            <Textarea id="role-desc" name="description" maxLength={300} />
          </Field>
          <Field
            label="Opens on sign-in"
            htmlFor="role-dashboard"
            hint="The dashboard people with this role land on after signing in."
          >
            <Select id="role-dashboard" name="dashboard" defaultValue={'overview'}>
              {DASHBOARDS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} - {d.description}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex flex-col gap-3">
            {modules.map((m) => (
              <fieldset key={m} className="bg-surface-container rounded-2xl p-3 shadow-neu-inset-sm">
                <legend className="text-label-md text-on-surface-variant px-2 font-semibold uppercase tracking-wide">
                  {m}
                </legend>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {permissions
                    .filter((p) => p.module === m && !p.is_core)
                    .map((p) => (
                      <label key={p.key} className="flex cursor-pointer items-start gap-2.5 rounded-xl px-2 py-1.5 hover:bg-surface">
                        <input
                          type="checkbox"
                          name="permissions"
                          value={p.key}
                          disabled={p.is_sensitive && !isSuperAdmin}
                          className="text-primary focus:ring-primary border-outline mt-0.5 h-5 w-5 shrink-0 rounded"
                        />
                        <span className="text-body-md text-on-surface">
                          {p.label}
                          {p.is_sensitive ? (
                            <Badge tone="warning" className="ml-1.5">
                              Super Admin only
                            </Badge>
                          ) : null}
                        </span>
                      </label>
                    ))}
                </div>
              </fieldset>
            ))}
          </div>

          <Field label="Reason" htmlFor="role-reason" hint="Optional. Kept in the audit log.">
            <Input id="role-reason" name="reason" maxLength={500} />
          </Field>

          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton size="lg" className="flex-1" pendingLabel="Creating…">
              Create role
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Rename, re-describe, retire or restore a role. */
export function RoleSettingsButton({
  role,
}: {
  role: {
    key: string;
    name: string;
    description: string | null;
    status: 'active' | 'inactive';
    /** Null for the member role, which always opens the member dashboard. */
    dashboard: string | null;
    fixedName: boolean;
    retirable: boolean;
  };
}) {
  const [open, setOpen] = useState<null | 'edit' | 'status'>(null);
  const [editState, editAction] = useActionState<ActionResult<{ role: string }> | null, FormData>(updateRole, null);
  const [statusState, statusAction] = useActionState<ActionResult<{ status: string }> | null, FormData>(
    setRoleStatus,
    null,
  );
  const editErr = editState && !editState.ok ? editState : null;
  const statusErr = statusState && !statusState.ok ? statusState : null;
  const retiring = role.status === 'active';

  useEffect(() => {
    if (editState?.ok || statusState?.ok) setOpen(null);
  }, [editState, statusState]);

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" icon="edit" onClick={() => setOpen('edit')}>
        Edit
      </Button>
      {role.retirable ? (
        <Button variant="ghost" size="sm" icon={retiring ? 'block' : 'restart_alt'} onClick={() => setOpen('status')}>
          {retiring ? 'Retire' : 'Restore'}
        </Button>
      ) : null}

      <Modal open={open === 'edit'} onClose={() => setOpen(null)} title={`Edit ${role.name}`}>
        <form action={editAction} className="flex flex-col gap-5" noValidate>
          <input type="hidden" name="role_key" value={role.key} />
          {editErr && !editErr.field ? <Alert tone="error">{editErr.error}</Alert> : null}
          <Field label="Role name" htmlFor="edit-role-name" required error={editErr?.field === 'name' ? editErr.error : null}>
            <Input
              id="edit-role-name"
              name="name"
              defaultValue={role.name}
              readOnly={role.fixedName}
              maxLength={60}
            />
          </Field>
          <Field label="Description" htmlFor="edit-role-desc">
            <Textarea id="edit-role-desc" name="description" defaultValue={role.description ?? ''} maxLength={300} />
          </Field>
          {role.dashboard ? (
            <Field
              label="Opens on sign-in"
              htmlFor="edit-role-dashboard"
              hint="The dashboard people with this role land on after signing in."
            >
              <Select id="edit-role-dashboard" name="dashboard" defaultValue={role.dashboard}>
                {DASHBOARDS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} - {d.description}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <SubmitButton size="lg" className="flex-1" pendingLabel="Saving…">
              Save
            </SubmitButton>
          </div>
        </form>
      </Modal>

      <Modal
        open={open === 'status'}
        onClose={() => setOpen(null)}
        title={retiring ? `Retire ${role.name}` : `Restore ${role.name}`}
        description={
          retiring
            ? 'A retired role cannot be given to anyone. It must have no active accounts first.'
            : 'The role can be given to staff accounts again.'
        }
      >
        <form action={statusAction} className="flex flex-col gap-5" noValidate>
          <input type="hidden" name="role_key" value={role.key} />
          <input type="hidden" name="status" value={retiring ? 'inactive' : 'active'} />
          {statusErr && !statusErr.field ? <Alert tone="error">{statusErr.error}</Alert> : null}
          <Field
            label="Reason"
            htmlFor="role-status-reason"
            required
            hint="Kept in the audit log."
            error={statusErr?.field === 'reason' ? statusErr.error : null}
          >
            <Textarea id="role-status-reason" name="reason" maxLength={500} />
          </Field>
          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <SubmitButton size="lg" className="flex-1" variant={retiring ? 'danger' : 'primary'} pendingLabel="Saving…">
              {retiring ? 'Retire role' : 'Restore role'}
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
