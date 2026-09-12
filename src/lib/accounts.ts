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
 * An account is created ready to use, with a generated temporary password that
 * the officer who created it is shown once and hands over. It is never stored
 * in readable form - Supabase keeps only a bcrypt hash - and the account holder
 * must replace it the first time they sign in: until they do, the database
 * lets the account do nothing else (`must_change_password`, 0034). A password
 * reset issues a new temporary password the same way.
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

/**
 * A temporary password: four letters and four digits, e.g. `KQPM-4827`.
 *
 * Easy to read out across a counter and to type on a basic phone - no 0/O or
 * 1/I/L to confuse. It only has to survive until the first sign-in, when the
 * account holder must replace it, and sign-in attempts are rate-limited, so
 * this is ample.
 */
export function temporaryPassword(): string {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 4; i++) out += letters[bytes[i] % letters.length];
  out += '-';
  for (let i = 4; i < 8; i++) out += digits[bytes[i] % digits.length];
  return out;
}

/**
 * Create the login for a member who has none, with a temporary password. It
 * names the member in its app metadata - which only the service role can
 * write - and the database links the two as Supabase writes that metadata.
 */
export async function provisionMemberLogin(member: {
  id: string;
  member_no: string;
}): Promise<{ userId: string; password: string } | { error: string }> {
  const admin = createAdminClient();
  const password = temporaryPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: memberAuthEmail(member.member_no),
    password,
    email_confirm: true,
    app_metadata: { member_id: member.id },
  });
  if (error || !data.user) {
    return { error: error?.message ?? 'The login could not be created.' };
  }
  return { userId: data.user.id, password };
}

/**
 * Normalise what someone typed as a member number: `bnd26001`, `BND-26001`
 * and `BND26001` are all the same member.
 *
 * A member number is BND, the two-digit year of registration, and the
 * registration sequence for that year - BND26001 is the first member of 2026.
 * The BND is required: bare digits are far more often the start of a phone
 * number, and guessing wrong on a sign-in screen is worse than asking again.
 *
 * Numbers issued under the pre-0038 scheme (BND-M-0000123) still normalise to
 * themselves, so a passbook printed before the change is still readable.
 * Mirrors `login_identifier_key()` in the database, which is the authority.
 */
export function normaliseMemberNo(raw: string): string | null {
  const v = raw.replace(/[\s-]/g, '').toUpperCase();
  const legacy = v.match(/^BNDM(\d{1,7})$/);
  if (legacy) return `BND-M-${legacy[1].padStart(7, '0')}`;
  return /^BND\d{5,}$/.test(v) ? v : null;
}
