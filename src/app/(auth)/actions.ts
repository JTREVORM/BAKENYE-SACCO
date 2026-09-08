'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import { landingPath, type Role } from '@/lib/rbac';
import { getRules } from '@/lib/settings';

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or member number.'),
  password: z.string().min(1, 'Enter your password.'),
  next: z.string().optional(),
});

/**
 * Sign in.
 *
 * Members are onboarded with a member number rather than an email they
 * remember, so we accept either. A member number is resolved to the account's
 * email first; anything containing "@" is treated as an email directly.
 *
 * The failure message is deliberately identical for "no such account" and
 * "wrong password" — telling an attacker which member numbers exist would be a
 * free enumeration oracle over a 500-person register.
 */
export async function signIn(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get('identifier'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  const { identifier, password, next } = parsed.data;
  const supabase = await createClient();

  let email = identifier;

  if (!identifier.includes('@')) {
    /*
     * Resolve the member number to an account email.
     *
     * This runs with the service-role key rather than the anon key, and
     * `email_for_member_no` is granted to neither `anon` nor `authenticated`.
     * Exposing that lookup to the browser would be a member-number-to-email
     * oracle over the whole register. Here it never leaves the server, and the
     * failure below is worded identically whether or not the number exists.
     */
    let resolved: string | null = null;
    try {
      const admin = createAdminClient();
      const { data } = await admin.rpc('email_for_member_no', {
        p_member_no: identifier.toUpperCase(),
      });
      resolved = (data as string | null) ?? null;
    } catch {
      // Service role not configured. Fall through to the generic failure
      // rather than telling the caller how the system is set up.
    }

    if (!resolved) {
      return { ok: false, error: 'Incorrect member number or password.', field: 'identifier' };
    }
    email = resolved;
  }

  const { data: auth, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !auth.user) {
    return {
      ok: false,
      error: identifier.includes('@')
        ? 'Incorrect email or password.'
        : 'Incorrect member number or password.',
      field: 'password',
    };
  }

  const { data: profile } = await supabase
    .from('app_users')
    .select('role, is_active')
    .eq('id', auth.user.id)
    .single();

  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error: 'This account has been deactivated. Please contact the SACCO office.',
    };
  }

  await supabase
    .from('app_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', auth.user.id);

  revalidatePath('/', 'layout');
  redirect(next && next.startsWith('/') ? next : landingPath(profile.role as Role));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

const emailSchema = z.string().trim().email('Enter a valid email address.');

/**
 * Send a password-reset link.
 *
 * Always reports success, whether or not the address is registered — same
 * enumeration reasoning as sign-in.
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

  return succeed(null, 'If that email is registered, a reset link is on its way.');
}

/**
 * The password rule, built from the SACCO's configured minimum length.
 *
 * The length is a setting (`security.password_min_length`) because it is a
 * policy decision a SACCO is entitled to make; the letter and digit
 * requirements stay in code because they are not a dial anyone asked to turn,
 * and a configurable "may be all digits" is a footgun rather than a feature.
 *
 * Supabase Auth enforces its own project-level minimum as well. This is the
 * check that produces a sentence naming the SACCO's own number.
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
    return {
      ok: false,
      error: 'This reset link has expired. Please request a new one.',
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail(error, 'password');

  revalidatePath('/', 'layout');
  return succeed(null, 'Your password has been changed.');
}

/** Change password while signed in — requires the current one. */
export async function changePassword(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const current = String(formData.get('current_password') ?? '');
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
