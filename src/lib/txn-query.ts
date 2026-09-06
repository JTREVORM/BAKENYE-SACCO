import { createClient } from '@/lib/supabase/server';
import type { TransactionFeedRow, TxnType } from '@/types/db';

export const TXN_PAGE_SIZE = 20;

/**
 * One paginated, filtered read of `transaction_feed`.
 *
 * `count: 'exact'` gives the pager a real total without a second query. RLS
 * scopes the rows: a member gets their own, staff get everyone's — the same
 * function serves both, with no `if (isMember)` branch to get wrong.
 */
export async function queryTransactions({
  memberId,
  query,
  type,
  from,
  to,
  page = 1,
  pageSize = TXN_PAGE_SIZE,
}: {
  memberId?: string | null;
  query?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: TransactionFeedRow[]; total: number }> {
  const supabase = await createClient();

  let q = supabase
    .from('transaction_feed')
    .select('*', { count: 'exact' })
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });

  if (memberId) q = q.eq('member_id', memberId);

  const types = expandTypeFilter(type);
  if (types) q = q.in('type', types);

  if (from) q = q.gte('occurred_on', from);
  if (to) q = q.lte('occurred_on', to);

  if (query?.trim()) {
    const term = `%${query.trim()}%`;
    q = q.or(`reference.ilike.${term},member_name.ilike.${term},member_no.ilike.${term}`);
  }

  const offset = Math.max(0, (page - 1) * pageSize);
  const { data, count, error } = await q.range(offset, offset + pageSize - 1);

  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

function expandTypeFilter(value: string | undefined): TxnType[] | null {
  if (!value) return null;
  if (value === 'savings') return ['weekly_savings', 'monthly_savings'];
  const valid: TxnType[] = [
    'share_purchase', 'weekly_savings', 'monthly_savings', 'loan_disbursement',
    'loan_repayment', 'deposit', 'withdrawal', 'income', 'expense', 'fee', 'penalty',
  ];
  return valid.includes(value as TxnType) ? [value as TxnType] : null;
}
