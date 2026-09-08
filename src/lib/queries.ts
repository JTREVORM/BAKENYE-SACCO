import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type {
  CollectionSheet,
  DashboardMetrics,
  GroupOverviewRow,
  GroupSavingToday,
  LoanBalanceRow,
  LoanProductRow,
  MemberFinancialsRow,
  NotificationRow,
  SaccoGroupRow,
  SaccoSettingsRow,
  ShareSettingsRow,
  SavingsDashboard,
  SavingsPeriodRow,
  TransactionFeedRow,
} from '@/types/db';

/**
 * Shared server-side reads.
 *
 * Everything here is wrapped in React `cache`, so a page that shows the unread
 * badge in the header and the notification list in the body issues one query,
 * not two. On a 3G connection each avoided round trip is roughly a quarter of a
 * second the member does not spend looking at a skeleton.
 */

export const getUnreadCount = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  return count ?? 0;
});

export const getMemberFinancials = cache(
  async (memberId: string): Promise<MemberFinancialsRow | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('member_financials')
      .select('*')
      .eq('id', memberId)
      .maybeSingle();
    return data ?? null;
  },
);

export const getRecentTransactions = cache(
  async (memberId: string, limit = 5): Promise<TransactionFeedRow[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('transaction_feed')
      .select('*')
      .eq('member_id', memberId)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    return data ?? [];
  },
);

export const getMemberLoans = cache(async (memberId: string): Promise<LoanBalanceRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('loan_balances')
    .select('*')
    .eq('member_id', memberId)
    .order('disbursed_on', { ascending: false, nullsFirst: false });
  return data ?? [];
});

export const getSavingsPeriods = cache(
  async (memberId: string, kind: 'weekly' | 'monthly', limit = 12): Promise<SavingsPeriodRow[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('savings_periods')
      .select('*')
      .eq('member_id', memberId)
      .eq('kind', kind)
      .order('period_start', { ascending: false })
      .limit(limit);
    return data ?? [];
  },
);

export const getNotifications = cache(async (limit = 30): Promise<NotificationRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
});

/**
 * The organisation record.
 *
 * Cached per request, because a printed statement asks for it in the letterhead
 * and again in the footer, and a page that renders twenty receipts would
 * otherwise ask twenty times.
 *
 * It falls back to the seeded defaults rather than throwing. A settings row
 * that cannot be read must not be the reason a member's statement fails to
 * print — the document still needs a name on it.
 */
export const getSaccoSettings = cache(async (): Promise<SaccoSettingsRow> => {
  const supabase = await createClient();
  const { data } = await supabase.from('sacco_settings').select('*').single();
  return (
    data ?? {
      id: true,
      legal_name: 'Bakenye Unity and Development SACCO',
      short_name: 'BUD-SACCO',
      motto: 'Together We Grow, Prosper and Build',
      registration_no: null,
      contact_email: null,
      contact_phone: null,
      address: null,
      default_saving_frequency: 'weekly',
      default_weekly_target: 0,
      default_monthly_target: 0,
      notify_in_app: true,
      updated_at: new Date().toISOString(),
      updated_by: null,
    }
  );
});

export const getShareSettings = cache(async (): Promise<ShareSettingsRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from('share_settings').select('*').single();
  return data ?? null;
});

/** Active products only — this is what a loan application may choose from. */
export const getLoanProducts = cache(async (): Promise<LoanProductRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('loan_products')
    .select('*')
    .eq('is_active', true)
    .order('name');
  return data ?? [];
});

/** Every product, retired ones included — the management screen shows both. */
export const getAllLoanProducts = cache(async (): Promise<LoanProductRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('loan_products')
    .select('*')
    .order('is_active', { ascending: false })
    .order('name');
  return data ?? [];
});

export const getDashboardMetrics = cache(async (): Promise<DashboardMetrics | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('dashboard_metrics');
  if (error) return null;
  return data as unknown as DashboardMetrics;
});

export type TrendPoint = {
  bucket: string;
  label: string;
  savings: number;
  repayments: number;
  shares: number;
};

export const getCollectionsTrend = cache(async (months = 6): Promise<TrendPoint[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('collections_trend', { p_months: months });
  if (error || !data) return [];
  return data as unknown as TrendPoint[];
});

export const getShareUnitPrice = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { data } = await supabase.from('share_settings').select('unit_price').single();
  return Number(data?.unit_price ?? 50000);
});

/* ==========================================================================
 * Groups and group savings
 * ======================================================================== */

/** Active groups, for the pickers on member and group forms. */
export const getActiveGroups = cache(async (): Promise<SaccoGroupRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('sacco_groups')
    .select('*')
    .neq('status', 'dissolved')
    .order('name');
  return data ?? [];
});

export const getGroupOverview = cache(async (groupId: string): Promise<GroupOverviewRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('group_overview')
    .select('*')
    .eq('id', groupId)
    .maybeSingle();
  return data ?? null;
});

/**
 * The whole collection screen in one round trip: the group, the cycle, the
 * member rows and the recent cycles to switch between.
 */
export const getCollectionSheet = cache(
  async (groupId: string, cycleId?: string | null): Promise<CollectionSheet | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('group_collection_sheet', {
      p_group_id: groupId,
      p_cycle_id: cycleId ?? null,
    });
    if (error || !data) return null;
    return data as unknown as CollectionSheet;
  },
);

/** The groups whose configured saving day falls on `on`. */
export const getGroupsSavingOn = cache(async (on: string): Promise<GroupSavingToday[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('groups_saving_on', { p_on: on });
  if (error || !data) return [];
  return data as unknown as GroupSavingToday[];
});

export const getSavingsDashboard = cache(
  async (on: string): Promise<SavingsDashboard | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('savings_dashboard', { p_on: on });
    if (error || !data) return null;
    return data as unknown as SavingsDashboard;
  },
);

/** Staff accounts that can be assigned to a group as its loan officer. */
export const getAssignableOfficers = cache(
  async (): Promise<{ id: string; full_name: string; role: string }[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('app_users')
      .select('id, full_name, role')
      .eq('is_active', true)
      .in('role', ['super_admin', 'manager', 'loan_officer', 'group_officer', 'cashier'])
      .order('full_name');
    return data ?? [];
  },
);
