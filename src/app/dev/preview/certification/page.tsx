import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { MemberShell } from '@/components/layout/MemberShell';
import { StaffShell } from '@/components/layout/StaffShell';
import { TransactionRow } from '@/components/member/TransactionRow';
import { Panel } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/states';
import MemberLoading from '@/app/(member)/loading';
import StaffLoading from '@/app/(staff)/staff/loading';
import { FIXTURE_TRANSACTIONS } from '@/lib/fixtures';

export const metadata: Metadata = { title: 'Shared component certification', robots: { index: false } };

/** Presentation-only non-dashboard/state regression samples. No auth bypass,
 * database calls, financial forms or writes. Production always returns 404. */
export default async function CertificationPreview({ searchParams }: {
  searchParams: Promise<{ shell?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { shell } = await searchParams;
  const rows = <div className="space-y-3">{FIXTURE_TRANSACTIONS.slice(0,2).map(t => <TransactionRow key={t.id} txn={t} href={`/transactions/${t.id}`} />)}</div>;
  if (shell === 'staff') return <StaffShell user={{fullName:'MWESIGWA TREVOR JOSEPH',roleName:'Loan Officer',role:'loan_officer',photoUrl:null}} nav={[{label:'Loans',href:'/staff/loans',icon:'payments'}]} showRecordSaving={false}>
    <Panel title="Transactions">{rows}</Panel>
  </StaffShell>;
  if (shell === 'states') return <div className="mx-auto max-w-4xl p-4">
    <section aria-label="Member loading"><MemberLoading /></section>
    <section aria-label="Staff loading"><StaffLoading /></section>
    <section aria-label="Empty state"><EmptyState title="No transactions yet" description="Your transactions will appear here." /></section>
    <ErrorState />
  </div>;
  return <MemberShell title="Transactions"><h1 className="mb-5 text-title-lg">Transactions</h1>{rows}</MemberShell>;
}
