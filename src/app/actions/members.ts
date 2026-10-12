'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import { normalisePhone, PHONE_ERROR } from '@/lib/phone';
import { provisionMemberLogin, staffAuthEmail, temporaryPassword } from '@/lib/accounts';
import type { RegistrationResult, TemporaryPassword } from '@/types/access';

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

const phoneNumber = z
  .string()
  .trim()
  .min(1, 'Enter the member’s phone number. It is how they sign in.')
  .transform((v, ctx) => {
    const n = normalisePhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_ERROR });
      return z.NEVER;
    }
    return n;
  });

const optionalPhoneNumber = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = normalisePhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_ERROR });
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
  phone: phoneNumber,
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
  next_of_kin_phone: optionalPhoneNumber,
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

export type RegistrationOutcome = RegistrationResult & {
  login_note: string | null;
  /** Shown once, to the officer, to hand to the member. Never stored in plain text. */
  temporary: TemporaryPassword | null;
};

/**
 * Register a member: one call to `register_member()`, which creates the member,
 * charges the fees, posts the payment into Cash at Merchant / Bank / Hand,
 * issues the receipt and writes the audit trail in one database transaction.
 *
 * The member's login is created straight after that transaction commits,
 * because it lives in Supabase Auth rather than in the database. It gets a
 * generated temporary password, shown to the officer now, once, to hand to the
 * member, who must change it the first time they sign in. If the login cannot
 * be created the registration still stands - nothing financial depends on it -
 * and "Create login" on the member's page tries again.
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
  const login = result.duplicate ? { temporary: null, note: null } : await createLoginWithPassword(result);

  revalidatePath('/staff/members');
  revalidatePath('/staff/categories');
  revalidatePath('/staff/finance');
  revalidatePath('/staff');

  return succeed(
    { ...result, has_login: result.has_login || !!login.temporary, login_note: login.note, temporary: login.temporary },
    result.duplicate
      ? `${result.full_name} was already registered as ${result.member_no}. Nothing was recorded twice.`
      : `${result.full_name} registered as ${result.member_no}.`,
  );
}

/**
 * Create a member's login with a temporary password. The password is returned
 * to the caller once and never kept in readable form.
 */
async function createLoginWithPassword(member: {
  member_id: string;
  member_no: string;
}): Promise<{ temporary: TemporaryPassword | null; note: string | null }> {
  try {
    const created = await provisionMemberLogin({ id: member.member_id, member_no: member.member_no });
    if ('error' in created) {
      return {
        temporary: null,
        note: 'The member is registered, but their login could not be created just now. Use "Create login" on their page to try again.',
      };
    }
    const supabase = await createClient();
    await supabase.rpc('log_member_login_created', { p_member_id: member.member_id });
    return { temporary: { password: created.password }, note: null };
  } catch {
    return {
      temporary: null,
      note: 'The member is registered, but their login could not be created just now. Use "Create login" on their page to try again.',
    };
  }
}

/* ==========================================================================
 * Sign-in accounts: creating a login, resetting a password
 *
 * Every account the SACCO creates is ready to use at once, on a generated
 * temporary password shown once to the officer. The account holder must
 * replace it at their first sign-in, and the database gives the account
 * nothing until they do - so nobody at the SACCO ends up knowing a password
 * that is actually in use.
 * ======================================================================== */

/** Create a login for a member who has none (registered before logins existed). */
export async function createMemberLogin(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<TemporaryPassword>> {
  const user = await requireUser();
  if (!can(user, 'members.manage') && !can(user, 'members.create')) {
    return { ok: false, error: 'You do not have permission to create member logins.' };
  }
  const memberId = z.string().uuid().safeParse(formData.get('member_id'));
  if (!memberId.success) return { ok: false, error: 'That member could not be found.' };

  const supabase = await createClient();
  const { data: member } = await supabase
    .from('members')
    .select('id, member_no, user_id')
    .eq('id', memberId.data)
    .maybeSingle();
  if (!member) return { ok: false, error: 'That member could not be found.' };
  if (member.user_id) return { ok: false, error: 'This member already has a login. Use "Reset password" instead.' };

  const login = await createLoginWithPassword({ member_id: member.id, member_no: member.member_no });
  if (!login.temporary) return { ok: false, error: login.note ?? 'The login could not be created.' };

  revalidatePath(`/staff/members/${member.id}`);
  return succeed(login.temporary, 'Login created. Give the member this temporary password.');
}

/**
 * Reset a member's or colleague's password: a new temporary password, shown
 * once, which they must change at their next sign-in. The database checks the
 * officer may do this (and records it) before anything changes.
 */
export async function resetUserPassword(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<TemporaryPassword>> {
  await requireUser();
  const userId = z.string().uuid().safeParse(formData.get('user_id'));
  if (!userId.success) return { ok: false, error: 'That account could not be found.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('issue_temporary_password', { p_user_id: userId.data });
  if (error) return fail(error);

  const password = temporaryPassword();
  const { error: authError } = await createAdminClient().auth.admin.updateUserById(userId.data, { password });
  if (authError) {
    return { ok: false, error: 'The password could not be reset just now. Please try again.' };
  }

  revalidatePath('/staff/users');
  revalidatePath('/staff/members', 'layout');
  return succeed({ password }, 'Password reset. It is shown only now.');
}

/** Set a staff account's sign-in phone number. */
export async function setUserPhone(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ phone: string | null }>> {
  await requireUser();
  const parsed = z
    .object({
      user_id: z.string().uuid(),
      phone: z.string().trim().max(30).optional().transform((v) => (v ? v : null)),
      reason: z.string().trim().min(3, 'Give a reason for this change.').max(500),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  if (parsed.data.phone && !normalisePhone(parsed.data.phone)) {
    return { ok: false, error: PHONE_ERROR, field: 'phone' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_user_phone', {
    p_user_id: parsed.data.user_id,
    p_phone: parsed.data.phone,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, error.hint || undefined);

  revalidatePath('/staff/users');
  return succeed(data as { phone: string | null }, 'Sign-in phone number updated.');
}

/* ==========================================================================
 * Editing the official record
 * ======================================================================== */

const editSchema = z.object({
  member_id: z.string().uuid(),
  ...profileFields,
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

  let changed: string[] = [];
  const { data, error } = await supabase.rpc('update_member_profile', {
    p_member_id: d.member_id,
    p_changes: changes,
    p_reason: d.reason,
    p_allow_shared_phone: d.allow_shared_phone === 'on',
  });

  if (error) return fail(error);

  // A new phone number is a new sign-in identifier from this moment; the
  // member's password is untouched, because it is theirs, not the record's.
  changed = (data as { changed: string[] }).changed;

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
 * Staff accounts
 * ======================================================================== */

const roleKey = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Choose a role.');

/**
 * Create a staff account.
 *
 * Email is optional: a colleague can sign in with their phone number instead,
 * and one of the two is required. The role travels in the account's app
 * metadata - which only the service role can write - and the database checks,
 * before the account exists, that this person may hand out that role.
 *
 * The account is ready at once, on a generated temporary password shown here
 * once. The colleague must replace it the first time they sign in.
 */
export async function createStaffUser(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ user_id: string; temporary: TemporaryPassword }>> {
  const user = await requireUser();
  if (!can(user, 'users.manage')) {
    return { ok: false, error: 'You do not have permission to create staff accounts.' };
  }

  const parsed = z
    .object({
      full_name: z.string().trim().min(3, 'Enter the full name.').max(120),
      email: z
        .string()
        .trim()
        .optional()
        .transform((v) => (v ? v.toLowerCase() : null))
        .refine((v) => v === null || z.string().email().safeParse(v).success, 'Enter a valid email address.'),
      phone: z.string().trim().optional().transform((v) => (v ? v : null)),
      role: roleKey,
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  if (!d.email && !d.phone) {
    return { ok: false, error: 'Give a phone number or an email address to sign in with.', field: 'phone' };
  }

  const supabase = await createClient();
  const { error: roleError } = await supabase.rpc('assert_can_assign_role', { p_role: d.role });
  if (roleError) return fail(roleError, 'role');

  let phone: string | null = null;
  if (d.phone) {
    const { data: ok, error: phoneError } = await supabase.rpc('assert_login_phone_available', {
      p_phone: d.phone,
      p_except_user: null,
    });
    if (phoneError) return fail(phoneError, 'phone');
    phone = ok as string | null;
  }

  const admin = createAdminClient();
  const password = temporaryPassword();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: d.email ?? staffAuthEmail(),
    password,
    email_confirm: true,
    user_metadata: { full_name: d.full_name, phone },
    app_metadata: { role: d.role },
  });

  if (error) return fail(error, 'email');
  if (!created.user) return { ok: false, error: 'The account could not be created.' };

  await supabase.rpc('log_staff_account_created', { p_user_id: created.user.id });
  revalidatePath('/staff/users');

  return succeed(
    { user_id: created.user.id, temporary: { password } },
    `${d.full_name}'s account is ready. Give them this temporary password; they will choose their own at first sign-in.`,
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
