'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import { getRules } from '@/lib/settings';
import { getSessionUser } from '@/lib/auth';
import { formatDateTime, normaliseUgandanMobile } from '@/lib/format';
import { memberCredential, normaliseMemberNo, provisionMemberLogin } from '@/lib/member-auth';
import type { MemberLoginVerdict, SessionPayload } from '@/types/access';

/** Only a path on this site, never `//evil.example`. */
function safeNext(next: string | undefined | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

async function clientAddress(): Promise<string | null> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim() || null;
}

/* ==========================================================================
 * Members: member number + registered phone number
 * ======================================================================== */

const memberLoginSchema = z.object({
  member_no: z.string().trim().min(1, 'Enter your member number.').max(40),
  phone: z.string().trim().min(1, 'Enter your phone number.').max(30),
  next: z.string().optional(),
});

/**
 * Sign a member in with their member number and the phone number on their
 * official SACCO record. No email and no password: see `lib/member-auth.ts`.
 *
 * The database decides (`member_login_verify()`), counts failures and locks a
 * member number after too many. A wrong pair gets the same sentence whether
 * the number exists or not, so the form cannot be used to discover members.
 */
export async function signInMember(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = memberLoginSchema.safeParse({
    member_no: formData.get('member_no'),
    phone: formData.get('phone'),
    next: formData.get('next') ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  const memberNo = normaliseMemberNo(parsed.data.member_no);
  const phone = normaliseUgandanMobile(parsed.data.phone);
  if (!phone) {
    return {
      ok: false,
      error: 'Enter the mobile number registered with the SACCO, e.g. 0772 123 456.',
      field: 'phone',
    };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'Member sign-in is not available right now. Please contact the SACCO office.' };
  }

  const { data, error } = await admin.rpc('member_login_verify', {
    p_member_no: memberNo,
    p_phone: phone,
    p_client: await clientAddress(),
  });
  if (error || !data) {
    return { ok: false, error: 'Sign-in is not available right now. Please try again shortly.' };
  }

  const verdict = data as MemberLoginVerdict;
  if (!verdict.ok) {
    switch (verdict.reason) {
      case 'invalid':
        return {
          ok: false,
          field: 'phone',
          error:
            verdict.attempts_left > 0 && verdict.attempts_left <= 2
              ? `That member number and phone number do not match our records. ${verdict.attempts_left} ${verdict.attempts_left === 1 ? 'try' : 'tries'} left before sign-in is paused.`
              : 'That member number and phone number do not match our records.',
        };
      case 'locked':
        return {
          ok: false,
          error: `Too many attempts. Sign-in for this member number is paused until ${formatDateTime(verdict.retry_at)}. If you need help sooner, visit the SACCO office.`,
        };
      case 'inactive':
        return {
          ok: false,
          error: `Your membership is ${verdict.status}. Please contact the SACCO office.`,
        };
      case 'staff_account':
        return {
          ok: false,
          error: 'This number belongs to a staff account. Use the Staff tab to sign in with your email and password.',
        };
      case 'disabled':
        return { ok: false, error: 'Your sign-in has been switched off. Please contact the SACCO office.' };
      default:
        return { ok: false, error: 'We could not sign you in. Please contact the SACCO office.' };
    }
  }

  // A member who has never signed in gets their login now.
  let userId = verdict.user_id;
  if (!userId) {
    const created = await provisionMemberLogin({
      id: verdict.member_id,
      member_no: verdict.member_no,
      phone: verdict.phone,
    });
    if ('error' in created) {
      return { ok: false, error: 'We could not set up your sign-in. Please contact the SACCO office.' };
    }
    userId = created.userId;
  }

  const password = memberCredential(userId, verdict.phone);
  const supabase = await createClient();
  let { error: signInError } = await supabase.auth.signInWithPassword({
    email: verdict.auth_email,
    password,
  });

  if (signInError) {
    // The register already verified this member. If the login's password has
    // fallen out of step with it - the phone number was changed, the secret
    // rotated, an older login - the register wins and the password follows.
    const { error: resetError } = await admin.auth.admin.updateUserById(userId, { password });
    if (!resetError) {
      ({ error: signInError } = await supabase.auth.signInWithPassword({
        email: verdict.auth_email,
        password,
      }));
    }
  }
  if (signInError) {
    return { ok: false, error: 'We could not sign you in. Please try again, or contact the SACCO office.' };
  }

  await supabase.rpc('touch_last_login');
  revalidatePath('/', 'layout');
  const next = safeNext(parsed.data.next);
  redirect(next && !next.startsWith('/staff') ? next : '/');
}

/* ==========================================================================
 * Staff: email + password
 * ======================================================================== */

const staffLoginSchema = z.object({
  email: z.string().trim().email('Enter the email address of your staff account.'),
  password: z.string().min(1, 'Enter your password.'),
  next: z.string().optional(),
});

/**
 * Sign a member of staff in. Member logins are turned away here - members sign
 * in with their member number and phone - so an old member password cannot be
 * used as a way around that.
 */
export async function signInStaff(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = staffLoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !auth.user) {
    return { ok: false, error: 'Incorrect email or password.', field: 'password' };
  }

  const { data } = await supabase.rpc('my_session');
  const session = data as SessionPayload | null;

  if (!session?.is_active || !session.role_active) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error: 'This account has been deactivated. Please contact the SACCO office.',
    };
  }
  if (session.role_kind !== 'staff') {
    await supabase.auth.signOut();
    return {
      ok: false,
      error: 'Members sign in on the Member tab, with their member number and phone number.',
    };
  }

  await supabase.rpc('touch_last_login');
  revalidatePath('/', 'layout');
  redirect(safeNext(parsed.data.next) ?? '/staff');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

/* ==========================================================================
 * Staff passwords
 *
 * Members have no password to forget. If a member's phone number has changed,
 * staff update their record after checking who they are, and the new number
 * signs in from that moment.
 * ======================================================================== */

const emailSchema = z.string().trim().email('Enter a valid email address.');

/**
 * Send a password-reset link to a staff account. Always reports success,
 * whether or not the address is registered, so the form reveals nothing.
 */
export async function requestPasswordReset(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = emailSchema.safeParse(formData.get('email'));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message, field: 'email' };
  }

  const supabase = await createClient();
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get('origin') ?? 'http://localhost:3000';

  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  return succeed(null, 'If that email belongs to a staff account, a reset link is on its way.');
}

/**
 * The password rule, built from the SACCO's configured minimum length
 * (`security.password_min_length`). Supabase Auth enforces its own
 * project-level minimum as well; this is the check that names the SACCO's own.
 */
async function passwordSchema() {
  const rules = await getRules();
  const min = Math.max(6, Math.round(rules.passwordMinLength));
  return z
    .string()
    .min(min, `Use at least ${min} characters.`)
    .regex(/[a-zA-Z]/, 'Include at least one letter.')
    .regex(/[0-9]/, 'Include at least one number.');
}

/** Set a new password from a reset link. The session comes from the link. */
export async function resetPassword(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  const parsed = (await passwordSchema()).safeParse(password);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message, field: 'password' };
  }
  if (password !== confirm) {
    return { ok: false, error: 'The two passwords do not match.', field: 'confirm' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'This reset link has expired. Please request a new one.' };
  }

  const session = await getSessionUser();
  if (session && session.roleKind !== 'staff') {
    return { ok: false, error: 'Members sign in with their member number and phone number, not a password.' };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail(error, 'password');

  revalidatePath('/', 'layout');
  return succeed(null, 'Your password has been changed.');
}

/** Change a staff password while signed in - requires the current one. */
export async function changePassword(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const current = String(formData.get('current_password') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  const session = await getSessionUser();
  if (!session) return { ok: false, error: 'Your session has expired. Please sign in again.' };
  if (session.roleKind !== 'staff') {
    return { ok: false, error: 'Members sign in with their member number and phone number, not a password.' };
  }

  const parsed = (await passwordSchema()).safeParse(password);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message, field: 'password' };
  }
  if (password !== confirm) {
    return { ok: false, error: 'The two passwords do not match.', field: 'confirm' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { ok: false, error: 'Your session has expired. Please sign in again.' };
  }

  // Re-authenticate: a borrowed unlocked phone must not be able to take over
  // the account.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (verifyError) {
    return { ok: false, error: 'Your current password is incorrect.', field: 'current_password' };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail(error, 'password');

  return succeed(null, 'Your password has been changed.');
}
