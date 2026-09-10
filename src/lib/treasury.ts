import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { CategoryRow } from '@/types/db';
import type {
  AccountMovementRow,
  CashBankReport,
  FinanceAccountType,
  FinancialAccountBalanceRow,
  MonthlyFlowPoint,
  MovementClass,
  PaymentCategoryRow,
  ReceiptsAndPayments,
  TreasurySummary,
} from '@/types/treasury';

/**
 * Server-side reads for the finance screens.
 *
 * Every figure is computed by Postgres - `treasury_summary()`,
 * `cash_bank_report()`, the `account_movements` view - and handed over as is.
 * Wrapped in React `cache` so a page that shows balances in its header and its
 * body asks once.
 */

export const getTreasurySummary = cache(async (on?: string): Promise<TreasurySummary | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('treasury_summary', on ? { p_on: on } : {});
  if (error || !data) return null;
  return data as unknown as TreasurySummary;
});

export const getMonthlyFlow = cache(async (months = 6): Promise<MonthlyFlowPoint[] | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('treasury_monthly_flow', { p_months: months });
  if (error || !data) return null;
  return data as unknown as MonthlyFlowPoint[];
});

/** Every account with its ledger-derived balance, merchant first, then bank, then cash. */
export const getAccounts = cache(
  async (opts?: { type?: FinanceAccountType; activeOnly?: boolean }): Promise<
    FinancialAccountBalanceRow[] | null
  > => {
    const supabase = await createClient();
    let q = supabase.from('financial_account_balances').select('*');
    if (opts?.type) q = q.eq('account_type', opts.type);
    if (opts?.activeOnly) q = q.eq('status', 'active');
    const { data, error } = await q
      .order('account_type')
      .order('is_default', { ascending: false })
      .order('name');
    if (error) return null;
    const order = { merchant: 0, bank: 1, cash: 2 } as const;
    return (data ?? []).sort((a, b) => order[a.account_type] - order[b.account_type]);
  },
);

export const getCashBankReport = cache(
  async (from: string, to: string): Promise<CashBankReport | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('cash_bank_report', { p_from: from, p_to: to });
    if (error || !data) return null;
    return data as unknown as CashBankReport;
  },
);

export const getReceiptsAndPayments = cache(
  async (from: string, to: string): Promise<ReceiptsAndPayments | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('receipts_and_payments', { p_from: from, p_to: to });
    if (error || !data) return null;
    return data as unknown as ReceiptsAndPayments;
  },
);

/** Active categories only - what a form may offer. */
export const getIncomeCategories = cache(async (): Promise<CategoryRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('income_categories')
    .select('id, name, is_system, is_active, description')
    .eq('is_active', true)
    .order('name');
  return (data ?? []) as CategoryRow[];
});

export const getExpenseCategories = cache(async (): Promise<CategoryRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('expense_categories')
    .select('id, name, is_system, is_active, description')
    .eq('is_active', true)
    .order('name');
  return (data ?? []) as CategoryRow[];
});

export const getPaymentCategories = cache(async (): Promise<PaymentCategoryRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('payment_categories')
    .select('*')
    .eq('is_active', true)
    .order('name');
  return data ?? [];
});

/** Staff who have recorded finance entries, for the ledger's "recorded by" filter. */
export const getStaffUsers = cache(async (): Promise<{ id: string; full_name: string }[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('app_users')
    .select('id, full_name')
    .neq('role', 'member')
    .order('full_name');
  return data ?? [];
});

/* --------------------------------------------------------------------------
 * The unified ledger
 * ----------------------------------------------------------------------- */

export const LEDGER_PAGE_SIZE = 25;

const MOVEMENT_CLASSES: MovementClass[] = [
  'collection',
  'other_receipt',
  'transfer_in',
  'transfer_out',
  'expense',
  'payment',
  'reversal',
];

export type LedgerFilters = {
  account?: string;
  type?: FinanceAccountType;
  from?: string;
  to?: string;
  kind?: string;
  user?: string;
  member?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

export async function queryLedger(
  f: LedgerFilters,
): Promise<{ rows: AccountMovementRow[]; total: number }> {
  const supabase = await createClient();
  const pageSize = f.pageSize ?? LEDGER_PAGE_SIZE;
  const page = Math.max(1, f.page ?? 1);

  let q = supabase
    .from('account_movements')
    .select('*', { count: 'exact' })
    .order('entry_date', { ascending: false })
    .order('entry_id', { ascending: false });

  if (f.account) q = q.eq('account_id', f.account);
  if (f.type) q = q.eq('account_type', f.type);
  if (f.from) q = q.gte('entry_date', f.from);
  if (f.to) q = q.lte('entry_date', f.to);
  if (f.user) q = q.eq('recorded_by', f.user);
  if (f.member) q = q.eq('member_id', f.member);
  if (f.kind && (MOVEMENT_CLASSES as string[]).includes(f.kind)) {
    q = q.eq('movement_class', f.kind as MovementClass);
  }
  if (f.q?.trim()) {
    // Characters with meaning inside a PostgREST `or` filter are dropped
    // rather than escaped: nobody searches for a reference by its comma.
    const term = `%${f.q.trim().replace(/[,()*%]/g, ' ').trim()}%`;
    q = q.or(
      `reference.ilike.${term},external_ref.ilike.${term},member_name.ilike.${term},` +
        `member_no.ilike.${term},description.ilike.${term}`,
    );
  }

  const offset = (page - 1) * pageSize;
  const { data, count, error } = await q.range(offset, offset + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/** A YYYY-MM-DD string, or nothing. */
export function isIsoDate(v: string | undefined | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
