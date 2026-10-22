'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import {
  RECOVERY_COOKIE,
  RECOVERY_SUSPENDED_MESSAGE,
  SELF_SERVICE_RECOVERY_ENABLED,
  siteUrl,
} from '@/lib/recovery';
import { IDLE_LIMIT_COOKIE, LAST_SEEN_COOKIE, sessionCookieOptions } from '@/lib/session-timeout';
import { INSTALL_PROMPT_COOKIE, installPromptCookieOptions, newLoginNonce } from '@/lib/pwa';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fail, succeed, type ActionResult } from '@/lib/errors';
import { getRules } from '@/lib/settings';
import { getSessionUser } from '@/lib/auth';
import { landingPath, type Access, type Dashboard, type RoleKind } from '@/lib/rbac';
import { isInternalEmail } from '@/lib/accounts';
import type { LoginResolution, SessionPayload } from '@/types/access';

/*
 * ONE SIGN-IN FOR EVERYONE
 *
 *   identifier (member number, phone, or a staff email) + password
 *        │
 *        ▼  login_resolve()          which accounts could this be? paused?
 *        ▼  Supabase Auth            does the password match one of them?
 *        ▼  my_session()             the role, from the database - never the form
 *        ▼  account standing         suspended / inactive / switched off?
 *        ▼  temporary password?      then "Choose your password" first
 *        ▼  landingPath()            that role's dashboard
 *
 * The person never says whether they are a member or staff; the account they
 * turn out to be says it for them.
 */

/**
 * Offer the app to whoever has just signed in.
 *
 * Called from every path that admits somebody into the application - the
 * ordinary sign-in and the "choose your password" step a first sign-in goes
 * through - because each of those is a successful login, and the offer is made
 * after every one of them. The value is a nonce identifying this sign-in; see
 * lib/pwa.ts for why that matters.
 *
 * Members and staff both get it. The SACCO asked for staff to be included after
 * the first release, which had deliberately left them out: a teller who opens the
 * workspace from a home-screen icon starts the day a step sooner, for the same
 * reason a member does.
 */
async function armInstallPrompt(): Promise<void> {
  const jar = await cookies();
  jar.set(INSTALL_PROMPT_COOKIE, newLoginNonce(), installPromptCookieOptions);
}

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

  // Start the idle clock with the SACCO's own timeout (Settings -> Security).
  const rules = await getRules();
  const jar = await cookies();
  jar.set(IDLE_LIMIT_COOKIE, String(Math.round(rules.sessionTimeoutMinutes)), sessionCookieOptions);
  jar.set(LAST_SEEN_COOKIE, String(Date.now()), sessionCookieOptions);

  // Offer the app on this sign-in, to members and staff alike.
  await armInstallPrompt();

  const access: Access = {
    role: s!.role,
    roleKind: s!.role_kind as RoleKind,
    permissions: s!.permissions,
    dashboard: s!.role_dashboard as Dashboard,
  };

  revalidatePath('/', 'layout');

  // A new account, or one just reset, is on a password somebody else was
  // shown. Nothing else opens until the owner replaces it.
  if (s!.must_change_password) redirect('/change-password');

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
  // Everything the sign-in path set, cleared here too. The `/auth/signout`
  // route already did this; the action only cleared the install-prompt cookie,
  // so a session ended through the action left its idle clock behind (F-08).
  const jar = await cookies();
  jar.delete(INSTALL_PROMPT_COOKIE);
  jar.delete(LAST_SEEN_COOKIE);
  jar.delete(IDLE_LIMIT_COOKIE);
  jar.delete(RECOVERY_COOKIE);
  revalidatePath('/', 'layout');
  redirect('/login');
}

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

/* ==========================================================================
 * Forgot password
 * ======================================================================== */

const forgotSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your member number, phone number or email.').max(120),
});

/**
 * SUSPENDED. Self-service recovery is a SACCO business decision, and the
 * decision is currently "no": a forgotten password is handled in person by an
 * officer who can identify the holder. See `lib/recovery.ts` for the switch,
 * the reasoning, and what must be true before it is turned back on.
 *
 * The refusal happens here, in the action, not in the screen - so a direct
 * POST from a script reaches the same closed door as the form does. Nothing is
 * resolved, nothing is emailed, nothing is logged against an identifier, and
 * the answer is one fixed sentence whether or not the account exists.
 */
export async function requestPasswordReset(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  if (!SELF_SERVICE_RECOVERY_ENABLED) {
    // Validated but discarded: the shape of what was typed must not change the
    // answer, or the answer becomes an oracle. Nothing touches the database.
    forgotSchema.safeParse({ identifier: formData.get('identifier') });
    return { ok: false, error: RECOVERY_SUSPENDED_MESSAGE };
  }

  const parsed = forgotSchema.safeParse({ identifier: formData.get('identifier') });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message, field: 'identifier' };
  }

  const done = succeed(
    null,
    'If this account has an email address, a reset link is on its way to it. If you do not use email, visit the SACCO office with your National ID - staff will give you a new temporary password, and you will choose your own when you sign in.',
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

  // The redirect host comes from configuration, never from a request header:
  // a link built from a header can be aimed anywhere (F-03).
  const origin = siteUrl();
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

/**
 * Set a new password from an emailed reset link. The session comes from the
 * link, which is why this path may skip the current password.
 *
 * SUSPENDED with the rest of self-service recovery. A link emailed before the
 * suspension must not still be spendable, so this refuses before looking at
 * the session at all - `/auth/callback` also declines to open one. Staff
 * resets, first-sign-in changes and profile password changes are unaffected:
 * none of them come through here.
 */
export async function resetPassword(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  if (!SELF_SERVICE_RECOVERY_ENABLED) {
    return { ok: false, error: RECOVERY_SUSPENDED_MESSAGE };
  }

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
  // Only a session opened from the emailed link may skip the current password;
  // an ordinary signed-in session changes its password from the profile.
  const jar = await cookies();
  if (!user || jar.get(RECOVERY_COOKIE)?.value !== user.id) {
    return { ok: false, error: 'This reset link has expired. Please request a new one.' };
  }

  const changed = await updateVerifiedPassword(supabase, user.id, password);
  if (!changed.ok) return changed;

  jar.delete(RECOVERY_COOKIE);
  revalidatePath('/', 'layout');
  return succeed(null, 'Your password has been changed.');
}

/**
 * Change a password through native Supabase Auth, with the database verifying
 * that the credential really moved before it lifts the temporary-password lock
 * (F-01, migration 0049).
 *
 *   begin_password_change     snapshot the current Auth hash, mint a nonce
 *   auth.updateUser()         the real credential change
 *   complete_password_change  refuses unless the hash differs from the snapshot
 *
 * Both database halves are service-role only, so a member's bearer token
 * cannot call either and cannot clear the flag on its own. The account ID
 * always comes from the server's own `getUser()`, never from a form field.
 *
 * Failure semantics, in the order they can happen:
 *
 *   the snapshot fails      nothing changed; ask them to try again
 *   updateUser() fails      nothing changed; the proof expires unused
 *   the completion fails    the password HAS changed, but the lock is still
 *                           on. Say so plainly: the new password works, and
 *                           signing in again takes them back to the same
 *                           screen, which will then complete cleanly. The
 *                           account is never left open on a credential
 *                           somebody else was shown.
 */
async function updateVerifiedPassword(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  password: string,
): Promise<ActionResult<null>> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'The password could not be changed just now. Please try again.' };
  }

  const { data: nonce, error: proofError } = await admin.rpc('begin_password_change', {
    p_user_id: userId,
  });
  if (proofError || !nonce) {
    return { ok: false, error: 'The password could not be changed just now. Please try again.' };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail(error, 'password');

  const { error: completionError } = await admin.rpc('complete_password_change', {
    p_user_id: userId,
    p_nonce: nonce,
  });
  if (completionError) {
    return {
      ok: false,
      error:
        'Your password was changed, but your account could not be opened just now. Please sign in with your new password and finish the step again.',
    };
  }
  return succeed(null);
}

/** Replace the signed-in person's password. Shared by both change-password forms. */
async function replacePassword(formData: FormData): Promise<ActionResult<null>> {
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

  // Changes the credential, and lifts the temporary-password lock only once
  // the database has seen that the credential really changed.
  const changed = await updateVerifiedPassword(supabase, user.id, password);
  if (!changed.ok) return changed;
  return succeed(null, 'Your password has been changed. Use the new one next time you sign in.');
}

/**
 * Change your own password while signed in - members and staff alike. It
 * changes nothing on the SACCO record: a password is the account holder's;
 * their name and phone are the SACCO's.
 */
export async function changePassword(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return replacePassword(formData);
}

/**
 * The forced change after signing in with a temporary password. On success the
 * account is unlocked and the person goes straight to their own dashboard.
 */
export async function chooseFirstPassword(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await replacePassword(formData);
  if (!result.ok) return result;

  const session = await getSessionUser();
  // This is the end of a successful sign-in: the person arrived here from the
  // sign-in screen on a temporary password and is being let in now. Without this,
  // anybody whose first sign-in goes through "choose your password" is never
  // offered the app for that sign-in.
  if (session) await armInstallPrompt();
  revalidatePath('/', 'layout');
  redirect(session ? landingPath(session) : '/login');
}
