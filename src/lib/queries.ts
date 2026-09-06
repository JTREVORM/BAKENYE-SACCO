import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type {
  DashboardMetrics,
  LoanBalanceRow,
  LoanProductRow,
  MemberFinancialsRow,
  NotificationRow,
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

export const getLoanProducts = cache(async (): Promise<LoanProductRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('loan_products')
    .select('*')
    .eq('is_active', true)
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
