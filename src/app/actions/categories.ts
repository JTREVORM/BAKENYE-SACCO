'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import type { CategoryStatus, SavingsFrequency } from '@/types/db';

/**
 * Share and savings category administration — section 16 of the brief.
 *
 * Required shares, share price, qualification window, savings amount and
 * frequency are all editable here, because the SACCO said they may change.
 * Nothing in the application hard-codes them: a screen that shows "UGX 100,000
 * monthly" got that from a row this file writes.
 *
 * Editing a category changes what is expected from here on. It never rewrites a
 * schedule already raised, and never touches a payment already banked — that
 * enforcement lives in the database functions, which is where it has to be.
 */

const REVALIDATE = [
  '/staff/categories',
  '/staff/members',
  '/staff/savings',
  '/staff/savings/collect',
  '/staff/savings/schedules',
  '/staff',
] as const;

function revalidateCategories() {
  for (const path of REVALIDATE) revalidatePath(path);
}

function firstIssue(error: z.ZodError): ActionResult<never> {
  const issue = error.issues[0];
  return { ok: false, error: issue.message, field: String(issue.path[0]) };
}

const name = z
  .string()
  .trim()
  .min(2, 'Enter a name for the category.')
  .max(60, 'Keep the name under 60 characters.');

const description = z
  .string()
  .trim()
  .max(300, 'Keep the description under 300 characters.')
  .optional()
  .transform((v) => (v ? v : undefined));

const sortOrder = z.coerce.number().int().min(0).max(9999).optional();

/* ==========================================================================
 * Share categories
 * ======================================================================== */

const shareCategorySchema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  name,
  required_shares: z.coerce
    .number()
    .int('Enter a whole number of shares.')
    .min(1, 'A category must require at least one share.')
    .max(100_000, 'That number of shares looks incorrect.'),
  share_price: z.coerce
    .number()
    .positive('Enter the price of one share.')
    .max(100_000_000, 'That share price looks incorrect.'),
  // Blank means the category has no deadline, which is what Silver is. It is a
  // real answer, not a missing one, so it is allowed through as undefined
  // rather than rejected.
  qualification_months: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine(
      (v) => v === undefined || (Number.isInteger(v) && v >= 1 && v <= 120),
      'Enter a whole number of months between 1 and 120, or leave it blank for no deadline.',
    ),
  description,
  sort_order: sortOrder,
});

export async function saveShareCategory(
  _prev: ActionResult<{ id: string; name: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  const user = await requireUser();
  if (!can(user.role, 'categories.manage')) {
    return { ok: false, error: 'You do not have permission to change share categories.' };
  }

  const parsed = shareCategorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const d = parsed.data;
  const supabase = await createClient();
  const editing = !!d.id;

  const { data, error } = editing
    ? await supabase.rpc('update_share_category', {
        p_id: d.id as string,
        p_name: d.name,
        p_required_shares: d.required_shares,
        p_share_price: d.share_price,
        p_qualification_months: d.qualification_months ?? null,
        p_description: d.description ?? null,
        p_sort_order: d.sort_order ?? 100,
      })
    : await supabase.rpc('create_share_category', {
        p_name: d.name,
        p_required_shares: d.required_shares,
        p_share_price: d.share_price,
        p_qualification_months: d.qualification_months ?? null,
        p_description: d.description ?? null,
        p_sort_order: d.sort_order ?? 100,
      });

  if (error) return fail(error, 'name');

  revalidateCategories();
  const result = data as { id: string; name: string };
  return succeed(
    result,
    editing ? `${result.name} updated.` : `${result.name} added as a share category.`,
  );
}

export async function setShareCategoryStatus(
  _prev: ActionResult<{ status: CategoryStatus }> | null,
  formData: FormData,
): Promise<ActionResult<{ status: CategoryStatus }>> {
  const user = await requireUser();
  if (!can(user.role, 'categories.manage')) {
    return { ok: false, error: 'You do not have permission to change share categories.' };
  }

  const parsed = z
    .object({
      id: z.string().uuid(),
      status: z.enum(['active', 'inactive']),
      reason: z
        .string()
        .trim()
        .min(5, 'Give a reason — this is recorded in the audit log.')
        .max(500),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_share_category_status', {
    p_id: parsed.data.id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });

  if (error) return fail(error, 'reason');

  revalidateCategories();
  const result = data as { status: CategoryStatus };
  return succeed(
    result,
    result.status === 'active' ? 'Category is in use again.' : 'Category retired.',
  );
}

/* ==========================================================================
 * Savings categories
 * ======================================================================== */

const savingsCategorySchema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  name,
  amount: z.coerce
    .number()
    .positive('Enter the amount members in this category save.')
    .max(500_000_000, 'That amount looks incorrect.'),
  frequency: z.enum(['weekly', 'monthly']),
  description,
  sort_order: sortOrder,
});

export async function saveSavingsCategory(
  _prev: ActionResult<{ id: string; name: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  const user = await requireUser();
  if (!can(user.role, 'categories.manage')) {
    return { ok: false, error: 'You do not have permission to change savings categories.' };
  }

  const parsed = savingsCategorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const d = parsed.data;
  const supabase = await createClient();
  const editing = !!d.id;

  const { data, error } = editing
    ? await supabase.rpc('update_savings_category', {
        p_id: d.id as string,
        p_name: d.name,
        p_amount: d.amount,
        p_frequency: d.frequency as SavingsFrequency,
        p_description: d.description ?? null,
        p_sort_order: d.sort_order ?? 100,
      })
    : await supabase.rpc('create_savings_category', {
        p_name: d.name,
        p_amount: d.amount,
        p_frequency: d.frequency as SavingsFrequency,
        p_description: d.description ?? null,
        p_sort_order: d.sort_order ?? 100,
      });

  if (error) return fail(error, 'name');

  revalidateCategories();
  const result = data as { id: string; name: string };
  return succeed(
    result,
    editing
      ? `${result.name} updated. New schedules will use the new amount; those already raised keep the amount they were judged against.`
      : `${result.name} added as a savings category.`,
  );
}

export async function setSavingsCategoryStatus(
  _prev: ActionResult<{ status: CategoryStatus }> | null,
  formData: FormData,
): Promise<ActionResult<{ status: CategoryStatus }>> {
  const user = await requireUser();
  if (!can(user.role, 'categories.manage')) {
    return { ok: false, error: 'You do not have permission to change savings categories.' };
  }

  const parsed = z
    .object({
      id: z.string().uuid(),
      status: z.enum(['active', 'inactive']),
      reason: z
        .string()
        .trim()
        .min(5, 'Give a reason — this is recorded in the audit log.')
        .max(500),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_savings_category_status', {
    p_id: parsed.data.id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });

  // The database refuses to retire a category members are still saving under,
  // and says how many. That message is more useful than anything invented here.
  if (error) return fail(error, 'reason');

  revalidateCategories();
  const result = data as { status: CategoryStatus };
  return succeed(
    result,
    result.status === 'active' ? 'Category is in use again.' : 'Category retired.',
  );
}

/* ==========================================================================
 * A member's categories
 * ======================================================================== */

/**
 * Set or change a member's share and savings categories.
 *
 * The two are independent — the SACCO's own worked example is a Gold
 * shareholder saving at the Diamond rate — unless a manager has turned on
 * `categories.share_matches_savings`, in which case the database refuses the
 * mismatch and says so.
 */
export async function setMemberCategories(
  _prev: ActionResult<{ schedules_repriced: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ schedules_repriced: number }>> {
  const user = await requireUser();
  if (!can(user.role, 'categories.manage')) {
    return { ok: false, error: 'You do not have permission to set a member’s categories.' };
  }

  const uuidOrNull = z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine(
      (v) => v === null || z.string().uuid().safeParse(v).success,
      'Choose a category from the list.',
    );

  const parsed = z
    .object({
      member_id: z.string().uuid('That member could not be found.'),
      share_category_id: uuidOrNull,
      savings_category_id: uuidOrNull,
      reason: z
        .string()
        .trim()
        .max(500)
        .optional()
        .transform((v) => (v ? v : undefined)),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_member_categories', {
    p_member_id: parsed.data.member_id,
    p_share_category_id: parsed.data.share_category_id,
    p_savings_category_id: parsed.data.savings_category_id,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) return fail(error, 'savings_category_id');

  revalidateCategories();
  revalidatePath(`/staff/members/${parsed.data.member_id}`);
  revalidatePath('/savings');
  revalidatePath('/');

  const result = data as {
    schedules_repriced: number;
    savings_category_name: string | null;
    share_category_name: string | null;
  };

  // Say what actually changed. "Categories updated" leaves the person wondering
  // whether the schedules they can see were touched.
  const parts: string[] = [];
  if (result.share_category_name) parts.push(`${result.share_category_name} shares`);
  if (result.savings_category_name) parts.push(`${result.savings_category_name} savings`);

  const summary = parts.length > 0 ? parts.join(' · ') : 'No category set';
  const repriced =
    result.schedules_repriced > 0
      ? ` ${result.schedules_repriced} unpaid ${
          result.schedules_repriced === 1 ? 'schedule was' : 'schedules were'
        } re-priced; settled ones keep the amount they were judged against.`
      : '';

  return succeed(result, `${summary}.${repriced}`);
}
