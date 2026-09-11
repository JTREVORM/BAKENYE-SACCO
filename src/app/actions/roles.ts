'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';

/**
 * Roles & Permissions. Every change is made by a database function that
 * checks `roles.manage`, refuses what must never happen - editing the Super
 * Admin role, giving a member a staff power, a non-Super-Admin handing out
 * the permissions that decide who else gets permissions - and audits exactly
 * what was granted and withdrawn.
 */

function firstIssue(error: z.ZodError): ActionResult<never> {
  const issue = error.issues[0];
  return { ok: false, error: issue.message, field: String(issue.path[0]) };
}

const roleKey = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);

const DASHBOARD_IDS = ['administration', 'overview', 'cashier', 'loans', 'finance', 'collections'] as const;

/** Save the dashboard a role lands on, when the form carried one. */
async function saveDashboard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roleKeyValue: string,
  formData: FormData,
) {
  const d = z.enum(DASHBOARD_IDS).safeParse(formData.get('dashboard'));
  if (!d.success) return null;
  const { error } = await supabase.rpc('set_role_dashboard', { p_role_key: roleKeyValue, p_dashboard: d.data });
  return error;
}
const reason = z.string().trim().min(5, 'Give a reason - it is kept in the audit log.').max(500);

function permissionList(formData: FormData): string[] {
  return formData
    .getAll('permissions')
    .map(String)
    .filter((p) => /^[a-z]+\.[a-z_]+$/.test(p));
}

function revalidateRoles() {
  revalidatePath('/staff/roles');
  revalidatePath('/staff/users');
  // Permissions travel with every session; a changed role changes navigation.
  revalidatePath('/staff', 'layout');
}

export async function saveRolePermissions(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ granted: string[]; withdrawn: string[] }>> {
  const user = await requireUser();
  if (!can(user, 'roles.manage')) {
    return { ok: false, error: 'You do not have permission to change roles.' };
  }

  const parsed = z
    .object({ role_key: roleKey, reason })
    .safeParse({ role_key: formData.get('role_key'), reason: formData.get('reason') });
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_role_permissions', {
    p_role_key: parsed.data.role_key,
    p_permissions: permissionList(formData),
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, 'reason');

  revalidateRoles();
  const result = data as { granted: string[]; withdrawn: string[] };
  return succeed(
    result,
    `Saved: ${result.granted.length} granted, ${result.withdrawn.length} withdrawn. It applies from each person's next page load.`,
  );
}

export async function createRole(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ role: string; name: string }>> {
  const user = await requireUser();
  if (!can(user, 'roles.manage')) {
    return { ok: false, error: 'You do not have permission to create roles.' };
  }

  const parsed = z
    .object({
      name: z.string().trim().min(2, 'Give the role a name.').max(60),
      description: z
        .string()
        .trim()
        .max(300)
        .optional()
        .transform((v) => (v ? v : null)),
      reason: z
        .string()
        .trim()
        .max(500)
        .optional()
        .transform((v) => (v ? v : null)),
    })
    .safeParse({
      name: formData.get('name'),
      description: formData.get('description') ?? undefined,
      reason: formData.get('reason') ?? undefined,
    });
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_role', {
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_permissions: permissionList(formData),
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, 'name');

  const result = data as { role: string; name: string };
  const dashError = await saveDashboard(supabase, result.role, formData);
  revalidateRoles();
  if (dashError) return fail(dashError, 'dashboard');
  return succeed(result, `${result.name} created.`);
}

export async function updateRole(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ role: string }>> {
  const user = await requireUser();
  if (!can(user, 'roles.manage')) {
    return { ok: false, error: 'You do not have permission to change roles.' };
  }

  const parsed = z
    .object({
      role_key: roleKey,
      name: z.string().trim().min(2, 'Give the role a name.').max(60),
      description: z
        .string()
        .trim()
        .max(300)
        .optional()
        .transform((v) => (v ? v : null)),
    })
    .safeParse({
      role_key: formData.get('role_key'),
      name: formData.get('name'),
      description: formData.get('description') ?? undefined,
    });
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('update_role', {
    p_role_key: parsed.data.role_key,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
  });
  if (error) return fail(error, 'name');

  const dashError = await saveDashboard(supabase, parsed.data.role_key, formData);
  revalidateRoles();
  if (dashError) return fail(dashError, 'dashboard');
  return succeed(data as { role: string }, 'Role updated.');
}

export async function setRoleStatus(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ status: string }>> {
  const user = await requireUser();
  if (!can(user, 'roles.manage')) {
    return { ok: false, error: 'You do not have permission to change roles.' };
  }

  const parsed = z
    .object({ role_key: roleKey, status: z.enum(['active', 'inactive']), reason })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_role_status', {
    p_role_key: parsed.data.role_key,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, 'reason');

  revalidateRoles();
  const result = data as { status: string };
  return succeed(result, result.status === 'active' ? 'Role restored.' : 'Role retired.');
}
