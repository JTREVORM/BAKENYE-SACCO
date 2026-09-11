import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type {
  CollectionAccount,
  FeeRow,
  MemberFeeRow,
  MemberProfileChangeRow,
  PermissionRow,
  RegistrationFee,
  RolePermissionRow,
  RoleRow,
} from '@/types/access';
import type { CategoryRow } from '@/types/db';

/**
 * Reads for roles, permissions, fees and member history. Each runs as the
 * signed-in user, so RLS decides what comes back; `cache` makes each one a
 * single round trip per request however many components ask.
 */

export const getRoles = cache(async (): Promise<RoleRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from('roles').select('*').order('sort_order').order('name');
  return (data ?? []) as RoleRow[];
});

export const getPermissions = cache(async (): Promise<PermissionRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from('permissions').select('*').order('sort_order');
  return (data ?? []) as PermissionRow[];
});

export const getRolePermissions = cache(async (): Promise<RolePermissionRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from('role_permissions').select('*');
  return (data ?? []) as RolePermissionRow[];
});

/**
 * Each role's effective permissions: what `has_permission()` would answer.
 * A Super Admin holds every staff permission; a core permission is held by
 * every role of its scope; the rest are the granted rows.
 */
export async function getEffectivePermissions(): Promise<Map<string, Set<string>>> {
  const [roles, permissions, grants] = await Promise.all([
    getRoles(),
    getPermissions(),
    getRolePermissions(),
  ]);
  const map = new Map<string, Set<string>>();
  for (const role of roles) {
    const held = new Set<string>();
    for (const p of permissions) {
      if (p.scope !== role.kind) continue;
      if (role.key === 'super_admin' || p.is_core) held.add(p.key);
    }
    map.set(role.key, held);
  }
  for (const g of grants) map.get(g.role_key)?.add(g.permission_key);
  return map;
}

export const getFees = cache(async (): Promise<FeeRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('fees')
    .select('*')
    .order('status')
    .order('sort_order')
    .order('name');
  return (data ?? []) as FeeRow[];
});

export const getRegistrationFees = cache(async (): Promise<RegistrationFee[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc('registration_fee_schedule', {});
  return (data ?? []) as RegistrationFee[];
});

export const getIncomeCategories = cache(async (): Promise<(CategoryRow & { is_active?: boolean })[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from('income_categories').select('*').order('name');
  return (data ?? []) as (CategoryRow & { is_active?: boolean })[];
});

export const getMemberFees = cache(async (memberId: string): Promise<MemberFeeRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('member_fees')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });
  return (data ?? []) as MemberFeeRow[];
});

export const getMemberProfileChanges = cache(
  async (memberId: string, limit = 50): Promise<MemberProfileChangeRow[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('member_profile_changes')
      .select('*')
      .eq('member_id', memberId)
      .order('changed_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as MemberProfileChangeRow[];
  },
);

export const getCollectionAccounts = cache(async (): Promise<CollectionAccount[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc('collection_accounts');
  return (data ?? []) as CollectionAccount[];
});
