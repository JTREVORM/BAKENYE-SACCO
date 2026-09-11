import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getAccounts } from '@/lib/treasury';
import { approvalNoteFor } from '@/lib/treasury-rules';
import { PageTitle, TabBar } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/states';
import { TransferForm } from '@/components/finance/forms/TransferForm';
import { TRANSFER_KIND_META, TRANSFER_KINDS, isTransferKind } from '@/lib/treasury-format';

export const metadata: Metadata = { title: 'Transfer' };

export default async function NewTransferPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const user = await requirePermission('finance.record');
  const sp = await searchParams;
  const kind = isTransferKind(sp.kind) ? sp.kind : 'merchant_to_bank';
  const meta = TRANSFER_KIND_META[kind];
  const [accounts, approvalNote] = await Promise.all([getAccounts({ activeOnly: true }), approvalNoteFor(user)]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        icon={meta.icon}
        title={meta.title}
        subtitle="An internal transfer between the SACCO's own accounts. It is not income or expense, and total funds do not change."
        breadcrumb={[
          { label: 'Finance', href: '/staff/finance' },
          { label: 'Transfers', href: '/staff/finance/transfers' },
          { label: meta.label },
        ]}
      />
      <TabBar
        className="mb-6"
        items={TRANSFER_KINDS.map((k) => ({
          label: TRANSFER_KIND_META[k].label,
          href: `/staff/finance/new/transfer?kind=${k}`,
          active: k === kind,
        }))}
      />
      {accounts ? (
        <TransferForm key={kind} kind={kind} accounts={accounts} recorderName={user.fullName}
          approvalNote={approvalNote} doneHref="/staff/finance/transfers" />
      ) : (
        <ErrorState title="Unable to load the accounts" />
      )}
    </div>
  );
}
