import { createClient } from '@/lib/supabase/server';
import type { LoanDetailData } from '@/components/LoanDetail';
import type {
  LoanBalanceRow,
  LoanGuarantorRow,
  LoanRepaymentRow,
  LoanRow,
  LoanScheduleRow,
} from '@/types/db';

/**
 * Everything the loan detail screen needs.
 *
 * Issued as one batch of parallel queries rather than a waterfall — six
 * sequential round trips on a 3G connection is roughly a second and a half of
 * staring at a skeleton.
 *
 * Returns `null` when the loan does not exist *or* when RLS hides it from the
 * caller, so the page renders a not-found instead of leaking the difference.
 */
export async function getLoanDetail(loanId: string): Promise<LoanDetailData | null> {
  const supabase = await createClient();

  const { data: loan } = await supabase.from('loans').select('*').eq('id', loanId).maybeSingle();
  if (!loan) return null;

  const [balanceRes, scheduleRes, repaymentsRes, guarantorsRes, memberRes, productRes] =
    await Promise.all([
      supabase.from('loan_balances').select('*').eq('loan_id', loanId).maybeSingle(),
      supabase
        .from('loan_schedule')
        .select('*')
        .eq('loan_id', loanId)
        .order('installment_no'),
      supabase
        .from('loan_repayments')
        .select('*')
        .eq('loan_id', loanId)
        .order('paid_on', { ascending: false }),
      supabase
        .from('loan_guarantors')
        .select('*, members!loan_guarantors_member_id_fkey(full_name, member_no, photo_url)')
        .eq('loan_id', loanId),
      supabase.from('members').select('full_name, member_no').eq('id', loan.member_id).maybeSingle(),
      supabase.from('loan_products').select('name').eq('id', loan.product_id).maybeSingle(),
    ]);

  const guarantors = (guarantorsRes.data ?? []).map((g) => {
    const joined = (g as unknown as {
      members: { full_name: string; member_no: string; photo_url: string | null } | null;
    }).members;
    return {
      ...(g as unknown as LoanGuarantorRow),
      member_name: joined?.full_name ?? 'Unknown member',
      member_no: joined?.member_no ?? '—',
      photo_url: joined?.photo_url ?? null,
    };
  });

  return {
    loan: loan as LoanRow,
    balance: (balanceRes.data ?? {
      loan_id: loanId,
      loan_no: loan.loan_no,
      member_id: loan.member_id,
      status: loan.status,
      principal: loan.principal,
      interest_amount: loan.interest_amount,
      processing_fee: loan.processing_fee,
      total_payable: loan.total_payable,
      installment_amount: loan.installment_amount,
      period_months: loan.period_months,
      disbursed_on: loan.disbursed_on,
      amount_paid: 0,
      outstanding: loan.total_payable,
      percent_repaid: 0,
      next_due_on: null,
      next_due_amount: null,
      overdue_amount: 0,
      days_overdue: null,
    }) as LoanBalanceRow,
    productName: productRes.data?.name ?? 'Loan',
    memberName: memberRes.data?.full_name ?? 'Unknown member',
    memberNo: memberRes.data?.member_no ?? '—',
    schedule: (scheduleRes.data ?? []) as LoanScheduleRow[],
    repayments: (repaymentsRes.data ?? []) as LoanRepaymentRow[],
    guarantors,
  };
}
