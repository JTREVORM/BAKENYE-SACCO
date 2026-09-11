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
import { landingPath, type Access, type Dashboard, type RoleKind } from '@/lib/rbac';
import { isInternalEmail } from '@/lib/accounts';
import type { LoginResolution, SessionPayload, SetupCodeVerdict } from '@/types/access';

/*
 * ONE SIGN-IN FOR EVERYONE
 *
 *   identifier (member number, phone, or a staff email) + password
 *        │
 *        ▼  login_resolve()          which accounts could this be? paused?
 *        ▼  Supabase Auth            does the password match one of them?
 *        ▼  my_session()             the role, from the database - never the form
 *        ▼  account standing         suspended / inactive / switched off?
 *        ▼  landingPath()            that role's dashboard
 *
 * The person never says whether they are a member or staff; the account they
 * turn out to be says it for them.
 */

/** Messages the brief fixed, so every path says the same thing. */
const INVALID = 'Invalid login credentials. Please check your identifier and password.';
const UNAVAILABLE = 'Your account is currently unavailable. Please contact SACCO administration.';
const SUSPENDED = 'Your account is currently suspended. Please contact the SACCO administration.';
const OFFLINE = 'Unable to sign in right now. Please check your connection and try again.';

/** Only a path on this site, never `//evil.example`. */
function safeNext(next: string | undefined | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

async function clientAddress(): Promise<string | null> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim() || null;
}

function pausedMessage(retryAt: string | undefined): string {
  const mins = retryAt ? Math.max(1, Math.ceil((new Date(retryAt).getTime() - Date.now()) / 60_000)) : null;
  return mins
    ? `Too many unsuccessful attempts. Please wait ${mins} minute${mins === 1 ? '' : 's'} and try again, or visit the SACCO office.`
    : 'Too many unsuccessful attempts. Please wait a few minutes and try again, or visit the SACCO office.';
}

/** A Supabase Auth failure that is not "wrong password": the service or the network. */
function isOutage(error: { status?: number; code?: string; name?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'invalid_credentials' || error.status === 400) return false;
  return !error.status || error.status >= 500 || error.name === 'AuthRetryableFetchError';
}

/**
 * The account has proved its password. Is it allowed in, and where does it go?
 * Signs the session back out if not, so nothing is left half-open.
 */
async function admitOrRefuse(
  identifier: string,
  client: string | null,
  next: string | null,
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data } = await supabase.rpc('my_session');
  const s = data as SessionPayload | null;

  let refusal: string | null = null;
  if (!s || !s.is_active || !s.role_active) refusal = UNAVAILABLE;
  else if (s.member?.status === 'suspended') refusal = SUSPENDED;
  else if (s.member && !['active', 'pending'].includes(s.member.status)) refusal = UNAVAILABLE;

  if (refusal) {
    await supabase.auth.signOut();
    await admin.rpc('login_record', {
      p_identifier: identifier, p_client: client, p_user_id: s?.id ?? null,
      p_succeeded: false, p_reason: 'disabled',
    });
    return { ok: false, error: refusal };
  }

  await admin.rpc('login_record', {
    p_identifier: identifier, p_client: client, p_user_id: s!.id, p_succeeded: true,
  });

  const access: Access = {
    role: s!.role,
    roleKind: s!.role_kind as RoleKind,
    permissions: s!.permissions,
    dashboard: s!.role_dashboard as Dashboard,
  };

  revalidatePath('/', 'layout');
  // A remembered destination is honoured only if it belongs to this kind of
  // account: a member is never sent into /staff, nor staff into the portal.
  const staffPath = next?.startsWith('/staff') ?? false;
  const fits = next && next !== '/' && (access.roleKind === 'staff') === staffPath;
  redirect(fits ? next! : landingPath(access));
}

/* ==========================================================================
 * Sign in
 * ======================================================================== */

const signInSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your member number or phone number.').max(120),
  password: z.string().min(1, 'Enter your password.').max(200),
  next: z.string().optional(),
});

export async function signIn(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = signInSchema.safeParse({
    identifier: formData.get('identifier'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  const { identifier, password } = parsed.data;
  const client = await clientAddress();

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: OFFLINE };
  }

  const { data, error } = await admin.rpc('login_resolve', { p_identifier: identifier, p_client: client });
  if (error || !data) return { ok: false, error: OFFLINE };

  const resolution = data as LoginResolution;
  if (resolution.locked) return { ok: false, error: pausedMessage(resolution.retry_at) };

  // Usually exactly one account. Where two members share a phone number by an
  // authorised override, the password decides which of them this is.
  const supabase = await createClient();
  let matched = false;
  for (const candidate of resolution.candidates) {
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: candidate.auth_email,
      password,
    });
    if (!authError) {
      matched = true;
      break;
    }
    if (isOutage(authError)) return { ok: false, error: OFFLINE };
  }

  if (!matched) {
    await admin.rpc('login_record', {
      p_identifier: identifier, p_client: client,
      p_user_id: resolution.candidates.length === 1 ? resolution.candidates[0].user_id : null,
      p_succeeded: false, p_reason: 'invalid',
    });
    return { ok: false, error: INVALID, field: 'password' };
  }

  return admitOrRefuse(identifier, client, safeNext(parsed.data.next));
}

/* ==========================================================================
 * Sign out
 *
 * The forms post to `/auth/signout`, a route handler, so the browser makes a
 * full navigation to the sign-in page and keeps no client-side copy of the
 * pages it just left. This action remains for any caller that needs it.
 * ======================================================================== */

export async function signOut() {
  const supabase = await createClient();
  await supabase.rpc('log_logout');
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

/* ==========================================================================
 * Setting up an account, or a new password, with a setup code
 * ======================================================================== */

/**
 * The password rule, built from the SACCO's configured minimum length
 * (`security.password_min_length`). Supabase Auth enforces its own
 * project-level minimum as well; this is the check that names the SACCO's own.
 */
async function passwordSchema() {
  const rules = await getRules();
  const min = Math.max(8, Math.round(rules.passwordMinLength));
  return z
    .string()
    .min(min, `Use at least ${min} characters.`)
    .max(72, 'Use at most 72 characters.')
    .regex(/[a-zA-Z]/, 'Include at least one letter.')
    .regex(/[0-9]/, 'Include at least one number.');
}

const setupSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your member number or phone number.').max(120),
  code: z
    .string()
    .trim()
    .transform((v) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .refine((v) => v.length === 10, 'Enter the 10-character setup code, e.g. K7QMP-4X2RA.'),
});

/**
 * "Set up your account": identifier + one-time code + the password the person
 * chooses. Used for a first password and for a reset alike. On success the
 * person is signed straight in.
 */
export async function activateAccount(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = setupSchema.safeParse({
    identifier: formData.get('identifier'),
    code: formData.get('code'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const pw = (await passwordSchema()).safeParse(password);
  if (!pw.success) return { ok: false, error: pw.error.issues[0].message, field: 'password' };
  if (password !== confirm) return { ok: false, error: 'The two passwords do not match.', field: 'confirm' };

  const client = await clientAddress();
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: OFFLINE };
  }

  const { data, error } = await admin.rpc('setup_code_verify', {
    p_identifier: parsed.data.identifier,
    p_code: parsed.data.code,
    p_client: client,
  });
  if (error || !data) return { ok: false, error: OFFLINE };

  const verdict = data as SetupCodeVerdict;
  if (!verdict.ok) {
    return verdict.reason === 'locked'
      ? { ok: false, error: pausedMessage(verdict.retry_at) }
      : {
          ok: false,
          field: 'code',
          error:
            'That setup code does not match, has expired, or has already been used. Ask the SACCO office for a new one.',
        };
  }

  const { data: authUser, error: updateError } = await admin.auth.admin.updateUserById(verdict.user_id, {
    password,
  });
  if (updateError || !authUser.user?.email) return fail(updateError ?? OFFLINE, 'password');

  const { error: spendError } = await admin.rpc('setup_code_complete', { p_code_id: verdict.code_id });
  if (spendError) return { ok: false, error: OFFLINE };

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: authUser.user.email,
    password,
  });
  if (signInError) {
    // The password is set; only the automatic sign-in failed.
    redirect('/login?setup=done');
  }

  return admitOrRefuse(parsed.data.identifier, client, null);
}

/* ==========================================================================
 * Forgot password
 * ======================================================================== */

const forgotSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your member number, phone number or email.').max(120),
});

/**
 * Where an account has a real email address, Supabase sends it a reset link.
 * Many members have none; they get a reset code from the SACCO office. The
 * answer is the same sentence either way, so the form reveals nothing about
 * which identifiers exist.
 */
export async function requestPasswordReset(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = forgotSchema.safeParse({ identifier: formData.get('identifier') });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message, field: 'identifier' };
  }

  const done = succeed(
    null,
    'If this account has an email address, a reset link is on its way to it. If you do not use email, visit the SACCO office with your ID - staff will give you a reset code to use under "Set up your account".',
  );

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return done;
  }

  const { data } = await admin.rpc('login_resolve', {
    p_identifier: parsed.data.identifier,
    p_client: await clientAddress(),
  });
  const resolution = data as LoginResolution | null;
  if (!resolution || resolution.locked) return done;

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get('origin') ?? 'http://localhost:3000';
  const supabase = await createClient();

  for (const c of resolution.candidates) {
    if (isInternalEmail(c.auth_email)) continue;
    await supabase.auth.resetPasswordForEmail(c.auth_email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
    await admin.from('audit_logs').insert({
      actor_id: c.user_id,
      actor_name: 'self-service',
      action: 'auth.password_reset_requested',
      module: 'Security',
      record_id: c.user_id,
      summary: 'Password reset link requested by email',
    });
  }

  return done;
}

/** Set a new password from an emailed reset link. The session comes from the link. */
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

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail(error, 'password');

  await supabase.rpc('log_password_changed');
  revalidatePath('/', 'layout');
  return succeed(null, 'Your password has been changed.');
}

/**
 * Change your own password while signed in - members and staff alike. It
 * needs the current password, and it changes nothing on the SACCO record: a
 * password is the account holder's; their name and phone are the SACCO's.
 */
export async function changePassword(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const current = String(formData.get('current_password') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  const session = await getSessionUser();
  if (!session) return { ok: false, error: 'Your session has expired. Please sign in again.' };

  if (!current) return { ok: false, error: 'Enter your current password.', field: 'current_password' };
  const parsed = (await passwordSchema()).safeParse(password);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message, field: 'password' };
  }
  if (password !== confirm) {
    return { ok: false, error: 'The two passwords do not match.', field: 'confirm' };
  }
  if (password === current) {
    return { ok: false, error: 'Choose a password different from your current one.', field: 'password' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return { ok: false, error: 'Your session has expired. Please sign in again.' };
  }

  // Re-authenticate: a borrowed, unlocked phone must not be able to take over
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

  await supabase.rpc('log_password_changed');
  return succeed(null, 'Your password has been changed. Use the new one next time you sign in.');
}
