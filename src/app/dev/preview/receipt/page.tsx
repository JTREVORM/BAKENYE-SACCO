import { notFound } from 'next/navigation';
import { StaffShell } from '@/components/layout/StaffShell';
import { MemberShell } from '@/components/layout/MemberShell';
import { STAFF_NAV } from '@/lib/rbac';
import { Receipt } from '@/components/Receipt';
import { FIXTURE_RECEIPT } from '@/lib/fixtures';
import type { PaymentMethod, ReceiptPayload, TxnStatus, TxnType } from '@/types/db';

const types: TxnType[] = ['monthly_savings', 'weekly_savings', 'deposit', 'withdrawal', 'share_purchase', 'loan_repayment', 'loan_disbursement', 'fee', 'income', 'expense', 'penalty', 'transfer', 'payment'];
const methods: PaymentMethod[] = ['cash', 'mobile_money', 'bank_transfer', 'cheque', 'internal'];
const statuses: TxnStatus[] = ['posted', 'reversed', 'reversal'];

/** Synthetic presentation fixtures only; never available in a production build. */
export default async function ReceiptPreview({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const query = await searchParams;
  const type = types.find(t => t === query.type) ?? 'monthly_savings';
  const method = methods.find(m => m === query.method) ?? 'cash';
  const status = statuses.find(s => s === query.status) ?? 'posted';
  const long = query.long === '1';
  const missing = query.missing === '1';
  const amount = long ? 1250000000 : 20000;
  const payload: ReceiptPayload = {
    ...FIXTURE_RECEIPT,
    receipt_no: 'RCT-TEST-0001',
    transaction: {
      ...FIXTURE_RECEIPT.transaction, type, method, status, amount,
      reference: long ? 'SYNTHETIC-REFERENCE-' + '0123456789'.repeat(8) : 'TXN-TEST-0001',
      member_name: missing ? null : long ? 'Synthetic Member Alexandra Namutebi of the Community Savings Association' : 'Synthetic Member',
      member_no: missing ? null : 'MEM-TEST-001',
      recorded_by_name: 'Synthetic Cashier',
      description: missing ? null : long ? 'Synthetic description for wrapping validation. '.repeat(14) : 'Synthetic transaction for receipt design review.',
      reversal_reason: status === 'posted' ? null : 'Synthetic correction',
      created_at: '2026-10-19T18:48:00Z', occurred_on: '2026-10-19',
    },
    balance_after: amount,
    loan: type.startsWith('loan_') ? { loan_no: 'LN-TEST-001', outstanding: 45500000, total_payable: 50000000, next_due_on: null } : null,
    shares: type === 'share_purchase' ? { quantity: 1, unit_price: amount, total_value: amount } : null,
    receipt_title: type === 'fee' ? 'Membership Payment Receipt' : null,
    fee_lines: type === 'fee' ? [{ description: 'Membership fee', amount }] : [],
    external_ref: method === 'cash' || missing ? null : 'PROVIDER-TEST-001',
    source_account: type === 'transfer' || ['withdrawal', 'payment', 'expense', 'loan_disbursement'].includes(type) ? { id: 'test-source', name: 'Synthetic Cash at Hand', account_type: 'cash' } : null,
    destination_account: missing || ['withdrawal', 'payment', 'expense', 'loan_disbursement'].includes(type) ? null : { id: 'test-destination', name: 'Synthetic Receiving Account', account_type: 'bank' },
    transfer: type === 'transfer' ? { id: 'transfer-test', transfer_no: 'TRF-TEST-001', kind: 'cash_to_bank', source_reference: 'CASH-TEST-001', destination_reference: 'BANK-TEST-001', handled_by: 'Synthetic Handler', status: 'completed' } : null,
    payment: type === 'payment' ? { id: 'payment-test', payment_no: 'PAY-TEST-001', payee: 'Synthetic Payee', reference: 'PAYREF-TEST-001', status: 'completed' } : null,
  };
  const content = <div className="p-4 sm:p-8" data-source={JSON.stringify(payload)}>
    <div className="no-print mx-auto mb-4 max-w-3xl text-sm">Synthetic receipt · development review only</div>
    <Receipt payload={payload} footer="Thank you for supporting Bakenye Unity and Development SACCO." showBalance={query.balance !== 'off' && !missing} />
  </div>;
  if (query.shell === 'staff') return <StaffShell user={{fullName:'Synthetic Staff',roleName:'Cashier',photoUrl:null}} nav={STAFF_NAV}>{content}</StaffShell>;
  if (query.shell === 'member') return <MemberShell title="Receipt" backHref="/transactions">{content}</MemberShell>;
  return <main>{content}</main>;
}
