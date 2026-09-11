/**
 * Member sign-in: member number + the phone number on the member's official
 * record. Server-only - imported by server actions, never by a component.
 *
 * HOW IT WORKS
 *
 * Supabase Auth signs people in with an email and a password. A member has
 * neither, necessarily, so each member login is created with:
 *
 *   - an internal sign-in address, `bnd-m-0000123@members.bnd-sacco.invalid`.
 *     `.invalid` is reserved (RFC 2606): it can never receive mail, and it is
 *     never shown to anyone;
 *   - a password nobody knows or types: an HMAC of the login's id and the
 *     member's registered phone number, keyed with a secret that exists only on
 *     the server.
 *
 * The member types their member number and phone. `member_login_verify()` in
 * Postgres checks that pair against the register, counts failures and locks a
 * member number after too many (Settings -> Security). Only then does the
 * server derive the password and sign in.
 *
 * So the register is the credential. Nothing sensitive is stored - Supabase
 * keeps only a bcrypt hash of the derived password - and knowing a member's
 * phone number is useless against Supabase Auth directly, because the password
 * also needs the server's secret. When staff change a member's phone number the
 * old one stops working at once, because the database check fails; the auth
 * password is brought back in step the next time the member signs in.
 *
 * THE SECRET
 *
 * `MEMBER_LOGIN_SECRET` if it is set, otherwise the service-role key, which is
 * already server-only. Rotating either is harmless: a password that no longer
 * matches is re-derived after the database has verified the member.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

const EMAIL_DOMAIN = 'members.bnd-sacco.invalid';

/** The internal sign-in address for a member number. Mirrors `member_auth_email()`. */
export function memberAuthEmail(memberNo: string): string {
  return `${memberNo.toLowerCase()}@${EMAIL_DOMAIN}`;
}

export function isMemberAuthEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${EMAIL_DOMAIN}`);
}

function secret(): string {
  const s = process.env.MEMBER_LOGIN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('Member sign-in is not configured: MEMBER_LOGIN_SECRET is not set.');
  return s;
}

/**
 * The password of a member login. The fixed prefix guarantees the upper-case
 * letter, digit and symbol that a project's password policy may insist on.
 */
export function memberCredential(userId: string, phoneE164: string): string {
  const mac = createHmac('sha256', secret())
    .update(`bnd-member-login:v1:${userId}:${phoneE164}`)
    .digest('base64url');
  return `Bm1!${mac}`;
}

/**
 * Create the login for a member who has none. The login names the member in
 * its app metadata - which only the service role can write - and the
 * `on_auth_user_created` trigger links the two in the same transaction.
 *
 * Returns the new auth user id.
 */
export async function provisionMemberLogin(member: {
  id: string;
  member_no: string;
  phone: string;
}): Promise<{ userId: string } | { error: string }> {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email: memberAuthEmail(member.member_no),
    // A throwaway, replaced immediately below by the derived password, which
    // needs the id this call is about to assign.
    password: `Tmp1!${randomBytes(24).toString('base64url')}`,
    email_confirm: true,
    app_metadata: { member_id: member.id },
  });
  if (error || !data.user) {
    return { error: error?.message ?? 'The login could not be created.' };
  }

  // If this fails the login still exists and is linked: the member's first
  // sign-in re-derives the password once the database has verified them.
  await admin.auth.admin.updateUserById(data.user.id, {
    password: memberCredential(data.user.id, member.phone),
  });
  return { userId: data.user.id };
}

/** Normalise what a member typed as their number: "123", "bnd-m-123", "BND-M-0000123". */
export function normaliseMemberNo(raw: string): string {
  const v = raw.replace(/\s/g, '').toUpperCase();
  const digits = v.match(/^(?:BND-?M-?)?(\d{1,7})$/);
  return digits ? `BND-M-${digits[1].padStart(7, '0')}` : v;
}
