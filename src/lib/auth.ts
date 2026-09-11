import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { can, isStaff, landingPath, type Access, type Permission, type RoleKind } from '@/lib/rbac';
import type { MemberStatus } from '@/types/db';
import type { SessionPayload } from '@/types/access';

export type SessionUser = Access & {
  id: string;
  email: string | null;
  fullName: string;
  phone: string | null;
  /** The role's display name, from `roles`. */
  roleName: string;
  photoUrl: string | null;
  /** Present only when this user is linked to a member record. */
  memberId: string | null;
  memberNo: string | null;
  memberStatus: MemberStatus | null;
};

/**
 * Resolve the signed-in user, their role and every permission it holds.
 *
 * One call to `my_session()` answers all of it, and React `cache` makes that
 * one call per request however many components ask - which matters on 3G.
 *
 * A deactivated account, or one whose role has been retired, is treated as
 * signed out: it can reach nothing.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.rpc('my_session');
  const session = data as SessionPayload | null;
  if (!session || !session.is_active || !session.role_active) return null;

  return {
    id: session.id,
    // A member's sign-in address is an internal identifier, never shown.
    email: session.email ?? (session.role_kind === 'staff' ? user.email ?? null : null),
    fullName: session.full_name,
    phone: session.phone,
    role: session.role,
    roleKind: session.role_kind as RoleKind,
    roleName: session.role_name,
    permissions: session.permissions,
    photoUrl: session.photo_url,
    memberId: session.member?.id ?? null,
    memberNo: session.member?.member_no ?? null,
    memberStatus: session.member?.status ?? null,
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
  if (!can(user, permission)) {
    redirect(landingPath(user));
  }
  return user;
}

/** Staff-area guard. */
export async function requireStaff(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isStaff(user)) redirect('/');
  return user;
}

/**
 * Member-area guard. Only a member login has a member record to scope data
 * with; staff are sent back to the back office.
 */
export async function requireMember(): Promise<SessionUser & { memberId: string }> {
  const user = await requireUser();
  if (!user.memberId) {
    redirect(isStaff(user) ? '/staff' : '/no-member-record');
  }
  return user as SessionUser & { memberId: string };
}

/**
 * Guard for a member-scoped resource being viewed by someone else. Staff with
 * `members.view` may look at any member; a member may look only at themselves.
 */
export async function assertCanViewMember(memberId: string): Promise<SessionUser> {
  const user = await requireUser();
  if (can(user, 'members.view')) return user;
  if (user.memberId === memberId) return user;
  redirect(landingPath(user));
}

/** The minimal access object a client component needs, safe to serialise. */
export function accessOf(user: SessionUser): Access {
  return { role: user.role, roleKind: user.roleKind, permissions: user.permissions };
}
