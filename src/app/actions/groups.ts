'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import type { GroupStatus, SavingDay, SavingFrequency } from '@/types/db';

/**
 * Group administration.
 *
 * Every write goes through an audited `SECURITY DEFINER` function; nothing here
 * touches `sacco_groups` directly, so an application bug cannot rename a group
 * without leaving a trace of who did it.
 */

const savingDay = z.coerce
  .number()
  .int()
  .min(1, 'Choose the day this group saves on.')
  .max(7, 'Choose the day this group saves on.');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

const optionalUuid = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || z.string().uuid().safeParse(v).success, 'Invalid selection.');

const groupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'Enter a name for the group.')
    .max(120),
  saving_day: savingDay,
  saving_frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  location: optionalText(200),
  weekly_target: z.coerce.number().min(0, 'Enter a target of zero or more.').default(0),
  monthly_target: z.coerce.number().min(0, 'Enter a target of zero or more.').default(0),
  leader_member_id: optionalUuid,
  secretary_member_id: optionalUuid,
  loan_officer_id: optionalUuid,
  notes: optionalText(1000),
});

function firstIssue(error: z.ZodError): ActionResult<never> {
  const issue = error.issues[0];
  return { ok: false, error: issue.message, field: String(issue.path[0]) };
}

export async function createGroup(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ group_id: string; group_code: string; name: string }>> {
  const user = await requireUser();
  if (!can(user.role, 'groups.manage')) {
    return { ok: false, error: 'You do not have permission to create groups.' };
  }

  const parsed = groupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_group', {
    p_name: d.name,
    p_saving_day: d.saving_day as SavingDay,
    p_saving_frequency: d.saving_frequency as SavingFrequency,
    p_location: d.location ?? null,
    p_weekly_target: d.weekly_target,
    p_monthly_target: d.monthly_target,
    p_leader_member_id: d.leader_member_id ?? null,
    p_secretary_member_id: d.secretary_member_id ?? null,
    p_loan_officer_id: d.loan_officer_id ?? null,
    p_notes: d.notes ?? null,
  });

  if (error) return fail(error, 'name');

  revalidatePath('/staff/groups');
  revalidatePath('/staff');

  const result = data as { group_id: string; group_code: string; name: string };
  return succeed(result, `${result.name} created as ${result.group_code}.`);
}

export async function updateGroup(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ group_id: string; group_code: string; name: string }>> {
  const user = await requireUser();
  if (!can(user.role, 'groups.manage')) {
    return { ok: false, error: 'You do not have permission to edit groups.' };
  }

  const groupId = String(formData.get('group_id') ?? '');
  if (!z.string().uuid().safeParse(groupId).success) {
    return { ok: false, error: 'That group could not be found.' };
  }

  const parsed = groupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('update_group', {
    p_group_id: groupId,
    p_name: d.name,
    p_saving_day: d.saving_day as SavingDay,
    p_saving_frequency: d.saving_frequency as SavingFrequency,
    p_location: d.location ?? null,
    p_weekly_target: d.weekly_target,
    p_monthly_target: d.monthly_target,
    p_leader_member_id: d.leader_member_id ?? null,
    p_secretary_member_id: d.secretary_member_id ?? null,
    p_loan_officer_id: d.loan_officer_id ?? null,
    p_notes: d.notes ?? null,
  });

  if (error) return fail(error, 'name');

  revalidatePath('/staff/groups');
  revalidatePath(`/staff/groups/${groupId}`);

  const result = data as { group_id: string; group_code: string; name: string };
  return succeed(result, 'Group updated.');
}

export async function setGroupStatus(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ status: GroupStatus }>> {
  const user = await requireUser();
  if (!can(user.role, 'groups.manage')) {
    return { ok: false, error: 'You do not have permission to change a group.' };
  }

  const parsed = z
    .object({
      group_id: z.string().uuid(),
      status: z.enum(['active', 'inactive', 'dissolved']),
      reason: z
        .string()
        .trim()
        .min(5, 'Give a reason — this is recorded in the audit log.')
        .max(500),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_group_status', {
    p_group_id: parsed.data.group_id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });

  if (error) return fail(error, 'reason');

  revalidatePath('/staff/groups');
  revalidatePath(`/staff/groups/${parsed.data.group_id}`);

  const result = data as { status: GroupStatus };
  return succeed(result, `Group marked ${result.status}.`);
}

/**
 * Move a member into a group, or out of one.
 *
 * Settled history stays with the group that collected it — only schedules that
 * are still pending and unpaid follow the member, which is what the database
 * function enforces.
 */
export async function assignMemberGroup(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ group_name: string | null; schedules_moved: number }>> {
  const user = await requireUser();
  if (!can(user.role, 'groups.manage')) {
    return { ok: false, error: 'You do not have permission to move members between groups.' };
  }

  const parsed = z
    .object({
      member_id: z.string().uuid(),
      group_id: z
        .string()
        .trim()
        .optional()
        .transform((v) => (v ? v : null)),
      reason: optionalText(500),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('assign_member_group', {
    p_member_id: parsed.data.member_id,
    p_group_id: parsed.data.group_id,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) return fail(error, 'group_id');

  revalidatePath('/staff/groups');
  revalidatePath('/staff/members');
  revalidatePath(`/staff/members/${parsed.data.member_id}`);

  const result = data as { group_name: string | null; schedules_moved: number };
  return succeed(
    result,
    result.group_name
      ? `Moved to ${result.group_name}.`
      : 'Removed from their group.',
  );
}

/* ==========================================================================
 * Savings cycles
 * ======================================================================== */

/**
 * Open the collection sheet for a group.
 *
 * Idempotent: `open_group_cycle()` upserts one schedule per active member, so
 * running it twice for the same week changes nothing.
 */
export async function openGroupCycle(
  groupId: string,
  on: string,
): Promise<ActionResult<{ cycle_id: string; label: string; members: number; created: boolean }>> {
  const user = await requireUser();
  if (!can(user.role, 'savings.record')) {
    return { ok: false, error: 'You do not have permission to open a savings cycle.' };
  }
  if (!z.string().uuid().safeParse(groupId).success) {
    return { ok: false, error: 'That group could not be found.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) {
    return { ok: false, error: 'Choose a valid date.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('open_group_cycle', {
    p_group_id: groupId,
    p_on: on,
  });

  if (error) return fail(error);

  revalidatePath(`/staff/groups/${groupId}`);
  revalidatePath('/staff/savings/today');
  revalidatePath('/staff/savings');

  const result = data as {
    cycle_id: string;
    label: string;
    members: number;
    created: boolean;
  };
  return succeed(
    result,
    result.created
      ? `${result.label} opened for ${result.members} ${result.members === 1 ? 'member' : 'members'}.`
      : `${result.label} was already open; ${result.members} ${result.members === 1 ? 'member is' : 'members are'} on the sheet.`,
  );
}

/** Open every group due to collect on a date. This is the scheduled job, by hand. */
export async function openCyclesForDay(
  on: string,
): Promise<ActionResult<{ groups: number; schedules: number }>> {
  const user = await requireUser();
  if (!can(user.role, 'savings.record')) {
    return { ok: false, error: 'You do not have permission to open savings cycles.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) {
    return { ok: false, error: 'Choose a valid date.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('open_cycles_for_day', { p_on: on });
  if (error) return fail(error);

  revalidatePath('/staff/savings/today');
  revalidatePath('/staff/groups');

  const result = data as { groups: number; schedules: number };
  return succeed(
    result,
    result.groups === 0
      ? 'No groups are scheduled to collect on that date.'
      : `Opened ${result.groups} ${result.groups === 1 ? 'group' : 'groups'} covering ${result.schedules} ${result.schedules === 1 ? 'member' : 'members'}.`,
  );
}

export async function closeSavingsCycle(
  cycleId: string,
  note?: string,
): Promise<ActionResult<{ marked_missed: number }>> {
  const user = await requireUser();
  if (!can(user.role, 'groups.manage')) {
    return { ok: false, error: 'You do not have permission to close a savings cycle.' };
  }
  if (!z.string().uuid().safeParse(cycleId).success) {
    return { ok: false, error: 'That cycle could not be found.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('close_savings_cycle', {
    p_cycle_id: cycleId,
    p_note: note?.trim() || null,
  });

  if (error) return fail(error);

  revalidatePath('/staff/savings/today');
  revalidatePath('/staff/groups');

  const result = data as { marked_missed: number };
  return succeed(
    result,
    result.marked_missed > 0
      ? `Cycle closed. ${result.marked_missed} unpaid ${result.marked_missed === 1 ? 'schedule was' : 'schedules were'} marked missed.`
      : 'Cycle closed.',
  );
}
