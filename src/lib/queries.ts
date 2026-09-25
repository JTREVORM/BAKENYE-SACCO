import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type {
  DashboardMetrics,
  LoanBalanceRow,
  LoanProductRow,
  MemberCollectionView,
  MemberFinancialsRow,
  MemberSavingsOverview,
  MemberShareProgressRow,
  NotificationRow,
  SaccoSettingsRow,
  ShareSettingsRow,
  SavingsDashboard,
  SavingsPeriodRow,
  SavingsScheduleRow,
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

/**
 * The SACCO's share price — the one value every purchase is charged at, every
 * share purchase is charged at, and `buy_shares()` reads in the database.
 *
 * Null when the settings row cannot be read. There is deliberately no fallback
 * number: a share form priced by a guess is a wrong sale, so callers say the
 * price is unavailable instead.
 */
export const getShareUnitPrice = cache(async (): Promise<number | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from('share_settings').select('unit_price').single();
  const price = Number(data?.unit_price);
  return Number.isFinite(price) && price > 0 ? price : null;
});

/* ==========================================================================
 * Shares
 * ======================================================================== */

/** What one member holds, valued at the SACCO's one price. */
export const getShareProgress = cache(
  async (memberId: string): Promise<MemberShareProgressRow | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('member_share_progress')
      .select('*')
      .eq('member_id', memberId)
      .maybeSingle();
    return data ?? null;
  },
);

/** A member's savings month by month, most recent first. */
export const getMemberSchedules = cache(
  async (memberId: string, limit = 12): Promise<SavingsScheduleRow[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('savings_schedules')
      .select('*')
      .eq('member_id', memberId)
      .order('period_start', { ascending: false })
      .limit(limit);
    return data ?? [];
  },
);

/* ==========================================================================
 * Savings dashboards and collection
 * ======================================================================== */

/**
 * The staff savings dashboard: what members saved in a window, not what they
 * were expected to save. There is no expectation to report.
 */
export const getSavingsDashboard = cache(
  async (from?: string, to?: string): Promise<SavingsDashboard | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('savings_dashboard', {
      p_from: from ?? null,
      p_to: to ?? null,
    });
    if (error || !data) return null;
    return data as unknown as SavingsDashboard;
  },
);

/**
 * Everything the counter needs for one member, in one round trip: who they
 * are, what they have saved this month, what their balance is and what their
 * last few deposits were.
 */
export const getMemberCollectionView = cache(
  async (memberId: string, on?: string): Promise<MemberCollectionView | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('member_collection_view', {
      p_member_id: memberId,
      p_on: on ?? undefined,
    });
    if (error || !data) return null;
    return data as unknown as MemberCollectionView;
  },
);

/** The member's own financial dashboard. */
export const getMemberSavingsOverview = cache(
  async (memberId: string): Promise<MemberSavingsOverview | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('member_savings_overview', {
      p_member_id: memberId,
    });
    if (error || !data) return null;
    return data as unknown as MemberSavingsOverview;
  },
);

/** Staff accounts that may be assigned savings work. */
export const getAssignableOfficers = cache(
  async (): Promise<{ id: string; full_name: string; role: string }[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('app_users')
      .select('id, full_name, role')
      .eq('is_active', true)
      .in('role', ['super_admin', 'manager', 'loan_officer', 'field_officer', 'cashier'])
      .order('full_name');
    return data ?? [];
  },
);
