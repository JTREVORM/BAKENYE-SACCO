'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import type { SavingFrequency } from '@/types/db';

/**
 * SACCO configuration.
 *
 * Every write goes through an audited `SECURITY DEFINER` function; nothing here
 * touches `sacco_settings` or `share_settings` directly. The organisation's
 * registered name appears on documents that leave the building, and the share
 * unit price decides what every future purchase costs — neither should be
 * changeable without a row in the audit log saying who changed it.
 *
 * The permission is checked here so the screen can say so politely, and again
 * in the database, which is the check that actually holds.
 */

function firstIssue(error: z.ZodError): ActionResult<never> {
  const issue = error.issues[0];
  return { ok: false, error: issue.message, field: String(issue.path[0]) };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/* -------------------------------------------------------------------------- */

const organisationSchema = z.object({
  legal_name: z
    .string()
    .trim()
    .min(3, 'Enter the registered name of the SACCO.')
    .max(160),
  short_name: z.string().trim().min(2, 'Enter a short name.').max(40),
  motto: optionalText(160),
  registration_no: optionalText(60),
  contact_email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .refine(
      (v) => v === undefined || z.string().email().safeParse(v).success,
      'Enter a valid contact email address.',
    ),
  contact_phone: optionalText(40),
  address: optionalText(300),
});

export async function updateOrganisation(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const user = await requireUser();
  if (!can(user.role, 'settings.manage')) {
    return { ok: false, error: 'You do not have permission to change these settings.' };
  }

  const parsed = organisationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc('update_organisation_settings', {
    p_legal_name: d.legal_name,
    p_short_name: d.short_name,
    p_motto: d.motto ?? '',
    p_registration_no: d.registration_no ?? null,
    p_contact_email: d.contact_email ?? null,
    p_contact_phone: d.contact_phone ?? null,
    p_address: d.address ?? null,
  });
  if (error) return fail(error, 'legal_name');

  // The name is on the letterhead of every printed document, so the whole app
  // is stale, not just this screen.
  revalidatePath('/', 'layout');
  return succeed(null, 'Organisation details saved.');
}

/* -------------------------------------------------------------------------- */

const savingsDefaultsSchema = z.object({
  default_saving_frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  default_weekly_target: z.coerce.number().min(0, 'Enter a target of zero or more.'),
  default_monthly_target: z.coerce.number().min(0, 'Enter a target of zero or more.'),
});

export async function updateSavingsDefaults(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const user = await requireUser();
  if (!can(user.role, 'settings.manage')) {
    return { ok: false, error: 'You do not have permission to change these settings.' };
  }

  const parsed = savingsDefaultsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc('update_savings_defaults', {
    p_default_saving_frequency: d.default_saving_frequency as SavingFrequency,
    p_default_weekly_target: d.default_weekly_target,
    p_default_monthly_target: d.default_monthly_target,
  });
  if (error) return fail(error, 'default_weekly_target');

  revalidatePath('/staff/settings');
  revalidatePath('/staff/groups/new');
  return succeed(null, 'Savings defaults saved.');
}

/* -------------------------------------------------------------------------- */

export async function updateNotificationSettings(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const user = await requireUser();
  if (!can(user.role, 'settings.manage')) {
    return { ok: false, error: 'You do not have permission to change these settings.' };
  }

  // An unchecked checkbox posts nothing at all, so presence is the value.
  const enabled = formData.get('notify_in_app') !== null;

  const supabase = await createClient();
  const { error } = await supabase.rpc('update_notification_settings', {
    p_notify_in_app: enabled,
  });
  if (error) return fail(error);

  revalidatePath('/staff/settings');
  return succeed(
    null,
    enabled
      ? 'Members will be notified in the app.'
      : 'In-app notifications are off. Loans still record and audit as normal.',
  );
}

/* -------------------------------------------------------------------------- */

const shareSchema = z.object({
  unit_price: z.coerce.number().positive('The share price must be greater than zero.'),
  min_shares_on_join: z.coerce
    .number()
    .int('Enter a whole number of shares.')
    .min(0, 'Enter zero or more shares.'),
});

export async function updateShareSettings(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const user = await requireUser();
  if (!can(user.role, 'settings.manage')) {
    return { ok: false, error: 'You do not have permission to change these settings.' };
  }

  const parsed = shareSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc('update_share_settings', {
    p_unit_price: d.unit_price,
    p_min_shares_on_join: d.min_shares_on_join,
  });
  if (error) return fail(error, 'unit_price');

  revalidatePath('/staff/settings');
  revalidatePath('/staff/shares');
  return succeed(null, 'Share settings saved. Shares already bought keep the price they were sold at.');
}
