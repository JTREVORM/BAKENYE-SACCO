'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import { normalisePhone } from '@/lib/format';

/**
 * Member and user administration.
 *
 * Creating a member optionally creates the auth account that lets them sign in.
 * That needs the service-role key, so it is the one place in the app that
 * touches `createAdminClient()` — and it checks `members.manage` first, before
 * the key is ever used.
 */

const phone = z
  .string()
  .trim()
  .min(9, 'Enter a phone number.')
  .transform(normalisePhone)
  .refine((v) => /^\+\d{9,15}$/.test(v), 'Enter a valid phone number, e.g. 0772 123 456.');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

const memberSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(3, 'Enter the member’s full name.')
    .max(120)
    .refine((v) => v.split(/\s+/).length >= 2, 'Enter both a first and last name.'),
  phone,
  national_id: optionalText(30),
  email: z
    .string()
    .trim()
    .email('Enter a valid email address.')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined)),
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined)),
  gender: z.enum(['male', 'female', 'other']).optional().or(z.literal('')),
  address: optionalText(300),
  occupation: optionalText(120),
  next_of_kin_name: optionalText(120),
  next_of_kin_phone: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? normalisePhone(v) : undefined)),
  next_of_kin_relation: optionalText(60),
  photo_url: optionalText(500),
  group_id: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine(
      (v) => v === undefined || z.string().uuid().safeParse(v).success,
      'Choose a group from the list.',
    ),
  create_login: z.enum(['on', 'off']).optional(),
});

export async function createMember(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ member_id: string; member_no: string; temp_password?: string }>> {
  const user = await requireUser();
  if (!can(user.role, 'members.manage')) {
    return { ok: false, error: 'You do not have permission to register members.' };
  }

  const parsed = memberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  const d = parsed.data;
  const wantsLogin = d.create_login === 'on';

  if (wantsLogin && !d.email) {
    return {
      ok: false,
      error: 'An email address is required to create a login for this member.',
      field: 'email',
    };
  }

  const supabase = await createClient();
  let authUserId: string | null = null;
  let tempPassword: string | undefined;

  if (wantsLogin && d.email) {
    // A random first password, shown once to the registering officer so they
    // can hand it over. The member is expected to change it on first sign-in.
    tempPassword = `BND-${Math.random().toString(36).slice(2, 8).toUpperCase()}${Math.floor(
      Math.random() * 90 + 10,
    )}`;

    const admin = createAdminClient();
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: d.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: d.full_name, phone: d.phone, role: 'member' },
    });

    if (authError) return fail(authError, 'email');
    authUserId = created.user?.id ?? null;
  }

  const { data, error } = await supabase.rpc('create_member', {
    p_full_name: d.full_name,
    p_phone: d.phone,
    p_national_id: d.national_id ?? null,
    p_email: d.email ?? null,
    p_address: d.address ?? null,
    p_date_of_birth: d.date_of_birth ?? null,
    p_gender: d.gender || null,
    p_occupation: d.occupation ?? null,
    p_next_of_kin_name: d.next_of_kin_name ?? null,
    p_next_of_kin_phone: d.next_of_kin_phone ?? null,
    p_next_of_kin_relation: d.next_of_kin_relation ?? null,
    p_photo_url: d.photo_url ?? null,
    p_user_id: authUserId,
  });

  if (error) {
    // Do not strand an orphaned auth account if the member insert failed.
    if (authUserId) {
      try {
        await createAdminClient().auth.admin.deleteUser(authUserId);
      } catch {
        // Reported below; the account is inert without a member record.
      }
    }
    return fail(error);
  }

  const result = data as { member_id: string; member_no: string };

  // Placement is a separate, audited step - assign_member_group() records who
  // put this member in which group, and moves their pending schedules with
  // them if they are ever moved again.
  if (d.group_id) {
    const { error: groupError } = await supabase.rpc('assign_member_group', {
      p_member_id: result.member_id,
      p_group_id: d.group_id,
      p_reason: 'Set at registration',
    });
    if (groupError) {
      // The member exists and is usable; only the placement failed.
      revalidatePath('/staff/members');
      return {
        ok: false,
        error: `${d.full_name} was registered as ${result.member_no}, but could not be placed in the group. Assign the group from their profile.`,
        field: 'group_id',
      };
    }
  }

  revalidatePath('/staff/members');
  revalidatePath('/staff/groups');
  revalidatePath('/staff');

  return succeed(
    { ...result, temp_password: tempPassword },
    `${d.full_name} registered as ${result.member_no}.`,
  );
}

export async function updateMember(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ member_id: string }>> {
  const user = await requireUser();

  const memberId = String(formData.get('member_id') ?? '');
  if (!z.string().uuid().safeParse(memberId).success) {
    return { ok: false, error: 'That member could not be found.' };
  }

  const isOwnProfile = user.memberId === memberId;
  if (!can(user.role, 'members.manage') && !isOwnProfile) {
    return { ok: false, error: 'You do not have permission to edit this member.' };
  }

  const parsed = memberSchema.omit({ create_login: true }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  const d = parsed.data;
  const supabase = await createClient();

  // A member editing their own profile may change contact details only. RLS
  // enforces this too; keeping the column list narrow here means the UI and the
  // policy agree instead of the member seeing a silent no-op.
  const patch = isOwnProfile && !can(user.role, 'members.manage')
    ? {
        phone: d.phone,
        email: d.email ?? null,
        address: d.address ?? null,
        occupation: d.occupation ?? null,
        next_of_kin_name: d.next_of_kin_name ?? null,
        next_of_kin_phone: d.next_of_kin_phone ?? null,
        next_of_kin_relation: d.next_of_kin_relation ?? null,
      }
    : {
        full_name: d.full_name,
        phone: d.phone,
        email: d.email ?? null,
        national_id: d.national_id ?? null,
        date_of_birth: d.date_of_birth ?? null,
        gender: d.gender || null,
        address: d.address ?? null,
        occupation: d.occupation ?? null,
        next_of_kin_name: d.next_of_kin_name ?? null,
        next_of_kin_phone: d.next_of_kin_phone ?? null,
        next_of_kin_relation: d.next_of_kin_relation ?? null,
        photo_url: d.photo_url ?? null,
      };

  const { error } = await supabase.from('members').update(patch).eq('id', memberId);
  if (error) return fail(error);

  // Group placement never rides along on a column update - it goes through the
  // audited RPC, which also decides which schedules follow the member.
  if (can(user.role, 'groups.manage')) {
    const { data: current } = await supabase
      .from('members')
      .select('group_id')
      .eq('id', memberId)
      .maybeSingle();

    if ((current?.group_id ?? null) !== (d.group_id ?? null)) {
      const { error: groupError } = await supabase.rpc('assign_member_group', {
        p_member_id: memberId,
        p_group_id: d.group_id ?? null,
        p_reason: 'Changed while editing the member',
      });
      if (groupError) return fail(groupError, 'group_id');
      revalidatePath('/staff/groups');
    }
  }

  revalidatePath('/staff/members');
  revalidatePath(`/staff/members/${memberId}`);
  revalidatePath('/profile');

  return succeed({ member_id: memberId }, 'Details updated.');
}

export async function setMemberStatus(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ status: string }>> {
  const user = await requireUser();
  if (!can(user.role, 'members.status')) {
    return { ok: false, error: 'You do not have permission to change a member’s status.' };
  }

  const parsed = z
    .object({
      member_id: z.string().uuid(),
      status: z.enum(['active', 'inactive', 'suspended', 'exited']),
      reason: z
        .string()
        .trim()
        .min(5, 'Give a reason — this is recorded in the audit log.')
        .max(500),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

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
  if (!can(user.role, 'savings.record')) {
    return { ok: false, error: 'You do not have permission to set savings targets.' };
  }

  const parsed = z
    .object({
      member_id: z.string().uuid(),
      kind: z.enum(['weekly', 'monthly']),
      target_amount: z.coerce.number().min(0, 'Enter a target of zero or more.'),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

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

export async function createStaffUser(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ user_id: string; temp_password: string }>> {
  const user = await requireUser();
  if (!can(user.role, 'users.manage')) {
    return { ok: false, error: 'Only a super admin can create staff accounts.' };
  }

  const parsed = z
    .object({
      full_name: z.string().trim().min(3, 'Enter the full name.').max(120),
      email: z.string().trim().email('Enter a valid email address.'),
      phone: phone.optional().or(z.literal('')),
      role: z.enum(['super_admin', 'manager', 'loan_officer', 'cashier']),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  const tempPassword = `BND-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const admin = createAdminClient();

  const { data: created, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.full_name,
      phone: parsed.data.phone || null,
      role: parsed.data.role,
    },
  });

  if (error) return fail(error, 'email');
  if (!created.user) return { ok: false, error: 'The account could not be created.' };

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
  if (!can(user.role, 'users.manage')) {
    return { ok: false, error: 'Only a super admin can change roles.' };
  }

  const parsed = z
    .object({
      user_id: z.string().uuid(),
      role: z.enum(['super_admin', 'manager', 'loan_officer', 'cashier', 'member']),
      reason: z.string().trim().min(5, 'Give a reason for this change.').max(500),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_user_role', {
    p_user_id: parsed.data.user_id,
    p_role: parsed.data.role,
    p_reason: parsed.data.reason,
  });

  if (error) return fail(error, 'reason');

  revalidatePath('/staff/users');
  return succeed(data as { role: string }, 'Role updated.');
}

export async function setUserActive(
  _prev: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ is_active: boolean }>> {
  const user = await requireUser();
  if (!can(user.role, 'users.manage')) {
    return { ok: false, error: 'Only a super admin can deactivate accounts.' };
  }

  const parsed = z
    .object({
      user_id: z.string().uuid(),
      active: z.enum(['true', 'false']).transform((v) => v === 'true'),
      reason: z.string().trim().min(5, 'Give a reason for this change.').max(500),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

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
