import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { can, isStaff, landingPath, type Permission, type Role } from '@/lib/rbac';

export type SessionUser = {
  id: string;
  email: string | null;
  fullName: string;
  phone: string | null;
  role: Role;
  photoUrl: string | null;
  /** Present only when this user is linked to a member record. */
  memberId: string | null;
  memberNo: string | null;
};

/**
 * Resolve the signed-in user and their role.
 *
 * Wrapped in React `cache` so that a page rendering a header, a sidebar and
 * three data sections issues one auth round trip, not five - which matters a
 * lot on a 3G connection.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('app_users')
    .select('id, full_name, email, phone, role, photo_url, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active) return null;

  const { data: member } = await supabase
    .from('members')
    .select('id, member_no')
    .eq('user_id', user.id)
    .maybeSingle();

  return {
    id: profile.id,
    email: profile.email ?? user.email ?? null,
    fullName: profile.full_name,
    phone: profile.phone,
    role: profile.role as Role,
    photoUrl: profile.photo_url,
    memberId: member?.id ?? null,
    memberNo: member?.member_no ?? null,
  };
});

/** Require a signed-in user, or bounce to login preserving the target URL. */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login');
  }
  return user;
}

/**
 * Require a specific capability. A user who lacks it is sent to their own
 * landing page rather than shown an error - the navigation already hides the
 * link, so arriving here means a hand-typed URL or a stale bookmark.
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) {
    redirect(landingPath(user.role));
  }
  return user;
}

/** Staff-area guard. */
export async function requireStaff(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isStaff(user.role)) redirect('/');
  return user;
}

/**
 * Member-area guard. Staff are allowed through (they may want to see the member
 * experience), but only a real member has a `memberId` to scope data with.
 */
export async function requireMember(): Promise<SessionUser & { memberId: string }> {
  const user = await requireUser();
  if (!user.memberId) {
    redirect(isStaff(user.role) ? '/staff' : '/no-member-record');
  }
  return user as SessionUser & { memberId: string };
}

/**
 * Guard for a member-scoped resource being viewed by someone else. Staff with
 * `members.view` may look at any member; a member may look only at themselves.
 */
export async function assertCanViewMember(memberId: string): Promise<SessionUser> {
  const user = await requireUser();
  if (can(user.role, 'members.view')) return user;
  if (user.memberId === memberId) return user;
  redirect(landingPath(user.role));
}
