'use server';

import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import { normalisePhone, normaliseUgandanMobile } from '@/lib/format';
import { memberCredential, provisionMemberLogin } from '@/lib/member-auth';
import type { RegistrationResult } from '@/types/access';

/**
 * Member and staff-account administration.
 *
 * Every write here goes through a database function that checks the caller's
 * permission itself and records what it did. The checks in this file exist to
 * give a clear sentence early; the database is what actually refuses.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const optionalUuid = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().uuid().safeParse(v).success, 'Choose an option from the list.');

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Enter a valid date.');

const ugPhone = z
  .string()
  .trim()
  .min(1, 'Enter the member’s phone number. It is how they sign in.')
  .transform((v, ctx) => {
    const n = normaliseUgandanMobile(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid Ugandan mobile number, e.g. 0772 123 456.' });
      return z.NEVER;
    }
    return n;
  });

const optionalUgPhone = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = normaliseUgandanMobile(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid Ugandan mobile number.' });
      return z.NEVER;
    }
    return n;
  });

/** The official record, as the registration and edit forms post it. */
const profileFields = {
  full_name: z
    .string()
    .trim()
    .min(3, 'Enter the member’s full name.')
    .max(120)
    .refine((v) => v.split(/\s+/).length >= 2, 'Enter both a first and a last name.'),
  phone: ugPhone,
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, 'Enter a valid email address, or leave it blank.'),
  national_id: text(30),
  date_of_birth: optionalDate,
  gender: z
    .enum(['male', 'female', 'other', ''])
    .optional()
    .transform((v) => (v ? v : null)),
  address: text(300),
  occupation: text(120),
  next_of_kin_name: text(120),
  next_of_kin_phone: optionalUgPhone,
  next_of_kin_relation: text(60),
  joined_on: optionalDate,
};

function firstIssue(error: z.ZodError): ActionResult<never> {
  const issue = error.issues[0];
  return { ok: false, error: issue.message, field: String(issue.path[0]) };
}

/* ==========================================================================
 * Registration
 * ======================================================================== */

const registrationSchema = z.object({
  ...profileFields,
  share_category_id: optionalUuid,
  savings_category_id: optionalUuid,
  optional_fee_ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .refine((ids) => ids.every((id) => z.string().uuid().safeParse(id).success), 'Choose fees from the list.'),
  expected_total: z.coerce.number().min(0),
  pay_now: z.enum(['yes', 'no']),
  account_id: optionalUuid,
  method: z
    .enum(['cash', 'mobile_money', 'bank_transfer', 'cheque', ''])
    .optional()
    .transform((v) => (v ? v : null)),
  reference: text(80),
  paid_on: optionalDate,
  amount_received: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : null)),
  registration_key: z.string().min(8).max(100),
  allow_shared_phone: z.enum(['on', 'off']).optional(),
  override_reason: text(500),
});

export type RegistrationOutcome = RegistrationResult & { login_note: string | null };

/**
 * Register a member: one call to `register_member()`, which creates the member,
 * charges the fees, posts the payment into Cash at Merchant / Bank / Hand,
 * issues the receipt and writes the audit trail in one database transaction.
 *
 * The member's sign-in is created after that transaction commits, because it
 * lives in Supabase Auth rather than in the database. If it cannot be created
 * the registration still stands - nothing financial depends on it - and the
 * member's first sign-in creates it instead.
 */
export async function registerMember(
  _prev: ActionResult<RegistrationOutcome> | null,
  formData: FormData,
): Promise<ActionResult<RegistrationOutcome>> {
  const user = await requireUser();
  if (!can(user, 'members.create')) {
    return { ok: false, error: 'You do not have permission to register members.' };
  }

  const parsed = registrationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  const payNow = d.pay_now === 'yes' && d.expected_total > 0;
  if (payNow && !d.account_id) {
    return { ok: false, error: 'Choose where the money was received.', field: 'account_id' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('register_member', {
    p_member: {
      full_name: d.full_name,
      phone: d.phone,
      email: d.email,
      national_id: d.national_id,
      date_of_birth: d.date_of_birth,
      gender: d.gender,
      address: d.address,
      occupation: d.occupation,
      next_of_kin_name: d.next_of_kin_name,
      next_of_kin_phone: d.next_of_kin_phone,
      next_of_kin_relation: d.next_of_kin_relation,
      joined_on: d.joined_on,
      share_category_id: d.share_category_id,
      savings_category_id: d.savings_category_id,
    },
    p_optional_fee_ids: d.optional_fee_ids,
    p_payment: payNow
      ? {
          pay_now: true,
          account_id: d.account_id,
          method: d.method,
          reference: d.reference,
          paid_on: d.paid_on,
          amount_received: d.amount_received,
          idempotency_key: `register-pay:${d.registration_key}`,
        }
      : { pay_now: false },
    p_expected_total: d.expected_total,
    p_registration_key: d.registration_key,
    p_allow_shared_phone: d.allow_shared_phone === 'on',
    p_override_reason: d.override_reason,
  });
  if (error) return fail(error);

  const result = data as RegistrationResult;
  const loginFailed =
    'The member is registered, but their sign-in could not be set up just now. It will be set up the first time they sign in.';
  let loginNote: string | null = null;

  if (!result.has_login) {
    try {
      const created = await provisionMemberLogin({
        id: result.member_id,
        member_no: result.member_no,
        phone: result.phone,
      });
      if ('error' in created) {
        loginNote = loginFailed;
      } else {
        result.has_login = true;
        await supabase.rpc('log_member_login_created', { p_member_id: result.member_id });
      }
    } catch {
      loginNote = loginFailed;
    }
  }

  revalidatePath('/staff/members');
  revalidatePath('/staff/categories');
  revalidatePath('/staff/finance');
  revalidatePath('/staff');

  return succeed(
    { ...result, login_note: loginNote },
    result.duplicate
      ? `${result.full_name} was already registered as ${result.member_no}. Nothing was recorded twice.`
      : `${result.full_name} registered as ${result.member_no}.`,
  );
}

/* ==========================================================================
 * Editing the official record
 * ======================================================================== */

const editSchema = z.object({
  member_id: z.string().uuid(),
  ...profileFields,
  share_category_id: optionalUuid,
  savings_category_id: optionalUuid,
  reason: z.string().trim().min(5, 'Give a reason for this change - it is kept on the member’s record.').max(500),
  allow_shared_phone: z.enum(['on', 'off']).optional(),
});

/**
 * Change a member's official details. Staff with `members.manage` only; the
 * database refuses anyone else, and records every changed field with its old
 * value, new value, who and why.
 */
export async function updateMemberProfile(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ member_id: string; changed: string[] }>> {
  const user = await requireUser();
  if (!can(user, 'members.manage')) {
    return { ok: false, error: 'You do not have permission to edit member records.' };
  }

  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  const supabase = await createClient();
  const { data: current } = await supabase
    .from('members')
    .select('share_category_id, savings_category_id')
    .eq('id', d.member_id)
    .maybeSingle();
  if (!current) return { ok: false, error: 'That member could not be found.' };

  const changes: Record<string, string | null> = {
    full_name: d.full_name,
    phone: d.phone,
    email: d.email,
    national_id: d.national_id,
    date_of_birth: d.date_of_birth,
    gender: d.gender,
    address: d.address,
    occupation: d.occupation,
    next_of_kin_name: d.next_of_kin_name,
    next_of_kin_phone: d.next_of_kin_phone,
    next_of_kin_relation: d.next_of_kin_relation,
  };
  if (d.joined_on) changes.joined_on = d.joined_on;

  const categoriesChanged =
    can(user, 'categories.manage') &&
    ((current.share_category_id ?? null) !== d.share_category_id ||
      (current.savings_category_id ?? null) !== d.savings_category_id);

  let changed: string[] = [];
  const { data, error } = await supabase.rpc('update_member_profile', {
    p_member_id: d.member_id,
    p_changes: changes,
    p_reason: d.reason,
    p_allow_shared_phone: d.allow_shared_phone === 'on',
  });

  if (error) {
    // "Nothing changed" is only a failure if the categories did not change
    // either.
    if (!(categoriesChanged && /Nothing changed/.test(error.message ?? ''))) return fail(error);
  } else {
    const result = data as { changed: string[]; user_id: string | null; phone: string };
    changed = result.changed;

    // Keep the member's sign-in in step with their new number straight away.
    // If this fails, their next sign-in re-derives it after the database has
    // checked the new number.
    if (changed.includes('phone') && result.user_id) {
      try {
        await createAdminClient().auth.admin.updateUserById(result.user_id, {
          password: memberCredential(result.user_id, result.phone),
        });
      } catch {
        // See above.
      }
    }
  }

  if (categoriesChanged) {
    const { error: categoryError } = await supabase.rpc('set_member_categories', {
      p_member_id: d.member_id,
      p_share_category_id: d.share_category_id,
      p_savings_category_id: d.savings_category_id,
      p_reason: d.reason,
    });
    if (categoryError) return fail(categoryError, 'savings_category_id');
    changed.push('categories');
    revalidatePath('/staff/categories');
  }

  revalidatePath('/staff/members');
  revalidatePath(`/staff/members/${d.member_id}`);
  revalidatePath('/profile');

  return succeed(
    { member_id: d.member_id, changed },
    `Saved. ${changed.length} ${changed.length === 1 ? 'change' : 'changes'} recorded on the member’s history.`,
  );
}

export async function setMemberStatus(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ status: string }>> {
  const user = await requireUser();
  if (!can(user, 'members.status')) {
    return { ok: false, error: 'You do not have permission to change a member’s status.' };
  }

  const parsed = z
    .object({
      member_id: z.string().uuid(),
      status: z.enum(['active', 'suspended', 'inactive', 'archived']),
      reason: z
        .string()
        .trim()
        .min(5, 'Give a reason — this is recorded in the audit log.')
        .max(500),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_member_status', {
    p_member_id: parsed.data.member_id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });

  if (error) return fail(error, 'reason');

  revalidatePath('/staff/members');
  revalidatePath(`/staff/members/${parsed.data.member_id}`);

  const result = data as { status: string };
  return succeed(result, `Member marked ${result.status}.`);
}

/* ==========================================================================
 * Savings plans — the per-member weekly / monthly targets
 * ======================================================================== */

export async function setSavingsPlan(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const user = await requireUser();
  if (!can(user, 'savings.record')) {
    return { ok: false, error: 'You do not have permission to set savings targets.' };
  }

  const parsed = z
    .object({
      member_id: z.string().uuid(),
      kind: z.enum(['weekly', 'monthly']),
      target_amount: z.coerce.number().min(0, 'Enter a target of zero or more.'),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // Close the previous plan rather than editing it, so historic periods keep
  // the target they were actually judged against.
  await supabase
    .from('savings_plans')
    .update({ active_to: today })
    .eq('member_id', parsed.data.member_id)
    .eq('kind', parsed.data.kind)
    .is('active_to', null);

  const { error } = await supabase.from('savings_plans').insert({
    member_id: parsed.data.member_id,
    kind: parsed.data.kind,
    target_amount: parsed.data.target_amount,
    active_from: today,
  });

  if (error) return fail(error);

  revalidatePath(`/staff/members/${parsed.data.member_id}`);
  revalidatePath('/savings');

  return succeed(null, `${parsed.data.kind === 'weekly' ? 'Weekly' : 'Monthly'} target updated.`);
}

/* ==========================================================================
 * Staff accounts
 * ======================================================================== */

const roleKey = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Choose a role.');

/** A first password with letters and digits, from a proper random source. */
function temporaryPassword(): string {
  return `BND-${randomBytes(9).toString('base64url')}-7a`;
}

/**
 * Create a staff account. The role travels in the account's app metadata -
 * which only the service role can write - and the database checks, before the
 * account exists, that this person may hand out that role.
 */
export async function createStaffUser(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ user_id: string; temp_password: string }>> {
  const user = await requireUser();
  if (!can(user, 'users.manage')) {
    return { ok: false, error: 'You do not have permission to create staff accounts.' };
  }

  const parsed = z
    .object({
      full_name: z.string().trim().min(3, 'Enter the full name.').max(120),
      email: z.string().trim().email('Enter a valid email address.'),
      phone: z
        .string()
        .trim()
        .optional()
        .transform((v) => (v ? normalisePhone(v) : null)),
      role: roleKey,
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { error: roleError } = await supabase.rpc('assert_can_assign_role', { p_role: parsed.data.role });
  if (roleError) return fail(roleError, 'role');

  const tempPassword = temporaryPassword();
  const admin = createAdminClient();

  const { data: created, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name, phone: parsed.data.phone },
    app_metadata: { role: parsed.data.role },
  });

  if (error) return fail(error, 'email');
  if (!created.user) return { ok: false, error: 'The account could not be created.' };

  await supabase.rpc('log_staff_account_created', { p_user_id: created.user.id });

  revalidatePath('/staff/users');

  return succeed(
    { user_id: created.user.id, temp_password: tempPassword },
    `${parsed.data.full_name} can now sign in. Share the temporary password securely.`,
  );
}

export async function setUserRole(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ role: string }>> {
  const user = await requireUser();
  if (!can(user, 'users.manage')) {
    return { ok: false, error: 'You do not have permission to change roles.' };
  }

  const parsed = z
    .object({
      user_id: z.string().uuid(),
      role: roleKey,
      reason: z.string().trim().min(5, 'Give a reason for this change.').max(500),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_user_role', {
    p_user_id: parsed.data.user_id,
    p_role: parsed.data.role,
    p_reason: parsed.data.reason,
  });

  if (error) return fail(error, 'reason');

  revalidatePath('/staff/users');
  revalidatePath('/staff/roles');
  return succeed(data as { role: string }, 'Role updated.');
}

export async function setUserActive(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ is_active: boolean }>> {
  const user = await requireUser();
  if (!can(user, 'users.manage')) {
    return { ok: false, error: 'You do not have permission to deactivate accounts.' };
  }

  const parsed = z
    .object({
      user_id: z.string().uuid(),
      active: z.enum(['true', 'false']).transform((v) => v === 'true'),
      reason: z.string().trim().min(5, 'Give a reason for this change.').max(500),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_user_active', {
    p_user_id: parsed.data.user_id,
    p_active: parsed.data.active,
    p_reason: parsed.data.reason,
  });

  if (error) return fail(error, 'reason');

  revalidatePath('/staff/users');
  const result = data as { is_active: boolean };
  return succeed(result, result.is_active ? 'Account activated.' : 'Account deactivated.');
}

/* ==========================================================================
 * Notifications
 * ======================================================================== */

export async function markNotificationsRead(ids?: string[]): Promise<ActionResult<number>> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('mark_notifications_read', {
    p_ids: ids && ids.length > 0 ? ids : null,
  });

  if (error) return fail(error);

  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
  return succeed((data as number) ?? 0);
}
