/**
 * Login accounts - server-only. Imported by server actions, never by a
 * component, because it uses the service-role key.
 *
 * WHO IS WHO
 *
 *   User        a login: a row in Supabase Auth plus `app_users` (its role).
 *   Member      the SACCO's record of a member, in `members`.
 *   Role        what a user's job is, in `roles`.
 *   Permission  what that role may do, in `role_permissions`.
 *
 * A member has at most one user, linked by `members.user_id`. Staff users have
 * no member record.
 *
 * SIGN-IN ADDRESSES
 *
 * Supabase Auth identifies every account by an email address. Many members and
 * some staff have none, so their account gets an internal one ending in
 * `.invalid` - a domain reserved (RFC 2606) never to receive mail. People never
 * see or type it: they sign in with their member number or phone number, and
 * the server finds the account from that.
 *
 * PASSWORDS
 *
 * An account is created with a long random password that no person ever sees.
 * The account holder then chooses their own password with a one-time setup
 * code (`issue_account_setup_code()`), which only the officer who created the
 * account sees, once. Supabase keeps only a bcrypt hash of any password.
 */
import { randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

const MEMBER_DOMAIN = 'members.bnd-sacco.invalid';
const STAFF_DOMAIN = 'staff.bnd-sacco.invalid';

/** The internal sign-in address for a member number. */
export function memberAuthEmail(memberNo: string): string {
  return `${memberNo.toLowerCase()}@${MEMBER_DOMAIN}`;
}

/** An internal sign-in address for a staff account with no email of its own. */
export function staffAuthEmail(): string {
  return `u-${randomBytes(9).toString('hex')}@${STAFF_DOMAIN}`;
}

export function isInternalEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith('.invalid');
}

/** A password nobody knows, for an account whose holder has yet to choose one. */
export function unusablePassword(): string {
  return `Xx9!${randomBytes(32).toString('base64url')}`;
}

/**
 * Create the login for a member who has none. It names the member in its app
 * metadata - which only the service role can write - and the
 * `on_auth_user_created` trigger links the two in the same transaction.
 */
export async function provisionMemberLogin(member: {
  id: string;
  member_no: string;
}): Promise<{ userId: string } | { error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: memberAuthEmail(member.member_no),
    password: unusablePassword(),
    email_confirm: true,
    app_metadata: { member_id: member.id },
  });
  if (error || !data.user) {
    return { error: error?.message ?? 'The login could not be created.' };
  }
  return { userId: data.user.id };
}

/** Normalise what someone typed as a member number: "123", "bnd-m-123", "BND-M-0000123". */
export function normaliseMemberNo(raw: string): string | null {
  const v = raw.replace(/\s/g, '').toUpperCase();
  const m = v.match(/^(?:BND-?M-?)?(\d{1,7})$/);
  return m ? `BND-M-${m[1].padStart(7, '0')}` : null;
}
