'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import { getSettingRows } from '@/lib/settings';
import type { SettingValue, SystemSettingRow } from '@/types/db';

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

/* ==========================================================================
 * The configuration registry
 *
 * One action saves any number of settings from any category. The form posts
 * `setting:<key>` fields; this reads the registry to learn what type each key
 * is, coerces the posted strings accordingly, and sends the batch to
 * `update_settings()`, which validates and audits it.
 *
 * Coercion happens here rather than in the form because the registry already
 * knows every setting's type. A second copy of that knowledge written into the
 * client would be one more thing to keep in step, and the first thing to drift.
 * ======================================================================== */

const SETTING_FIELD_PREFIX = 'setting:';

/**
 * Turn a posted form value into the JSON type the setting is declared as.
 *
 * Returns `undefined` for a field that was not posted at all, which is how an
 * unchanged section stays unchanged rather than being written back over itself.
 */
function coerceSetting(
  row: SystemSettingRow,
  formData: FormData,
): SettingValue | undefined {
  const field = `${SETTING_FIELD_PREFIX}${row.key}`;

  // A checkbox posts nothing when it is off, so presence is the value — but
  // only for a field the form actually rendered, which the marker says.
  if (row.value_type === 'boolean') {
    if (formData.get(`${field}:present`) === null) return undefined;
    return formData.get(field) !== null;
  }

  if (row.value_type === 'multiselect') {
    if (formData.get(`${field}:present`) === null) return undefined;
    return formData.getAll(field).map(String);
  }

  const raw = formData.get(field);
  if (raw === null) return undefined;
  const text = String(raw).trim();

  switch (row.value_type) {
    case 'text':
    case 'select':
      return text;
    default: {
      // Money is typed with separators by people who think in thousands.
      const cleaned = text.replace(/[,\s]/g, '');
      if (cleaned === '') return undefined;
      const n = Number(cleaned);
      if (!Number.isFinite(n)) {
        throw new Error(`${row.label} must be a number.`);
      }
      return n;
    }
  }
}

/** True when the posted value differs from what is stored. */
function hasChanged(current: SettingValue, next: SettingValue): boolean {
  if (Array.isArray(current) || Array.isArray(next)) {
    const a = (Array.isArray(current) ? current : []).map(String).slice().sort();
    const b = (Array.isArray(next) ? next : []).map(String).slice().sort();
    return a.length !== b.length || a.some((v, i) => v !== b[i]);
  }
  return current !== next;
}

export async function updateSettings(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ changed: string[] }>> {
  const user = await requireUser();
  if (!can(user.role, 'settings.manage')) {
    return { ok: false, error: 'You do not have permission to change these settings.' };
  }

  const rows = await getSettingRows();
  const changes: Record<string, SettingValue> = {};

  for (const row of rows) {
    let next: SettingValue | undefined;
    try {
      next = coerceSetting(row, formData);
    } catch (e) {
      return { ok: false, error: (e as Error).message, field: row.key };
    }
    if (next === undefined) continue;
    if (!hasChanged(row.value, next)) continue;
    changes[row.key] = next;
  }

  if (Object.keys(changes).length === 0) {
    return succeed({ changed: [] }, 'Nothing had changed, so nothing was saved.');
  }

  const reason = String(formData.get('reason') ?? '').trim();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('update_settings', {
    p_changes: changes,
    p_reason: reason === '' ? null : reason,
  });
  // The failing key rides back so the screen can put the message on the field.
  if (error) return fail(error, Object.keys(changes)[0]);

  const changed = (data as { changed: string[] } | null)?.changed ?? [];

  // Settings reach printed documents, the member app and the staff screens
  // alike, so the whole tree is stale rather than this one page.
  revalidatePath('/', 'layout');

  return succeed(
    { changed },
    changed.length === 1
      ? 'Setting saved.'
      : `${changed.length} settings saved.`,
  );
}

/** Put one setting back to the value it shipped with. */
export async function resetSetting(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const user = await requireUser();
  if (!can(user.role, 'settings.manage')) {
    return { ok: false, error: 'You do not have permission to change these settings.' };
  }

  const key = String(formData.get('key') ?? '').trim();
  if (!key) return { ok: false, error: 'No setting was named.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('reset_setting', {
    p_key: key,
    p_reason: String(formData.get('reason') ?? '').trim() || null,
  });
  if (error) return fail(error);

  revalidatePath('/', 'layout');
  return succeed(null, 'The original value has been restored.');
}
