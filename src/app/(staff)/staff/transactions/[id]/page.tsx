import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/rbac';
import { Receipt } from '@/components/Receipt';
import { ReverseTransaction } from './ReverseTransaction';
import type { ReceiptPayload } from '@/types/db';

export const metadata: Metadata = { title: 'Receipt' };

export default async function StaffReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('transactions.view');
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('receipt_for_transaction', {
    p_transaction_id: id,
  });

  if (error || !data) notFound();
  const payload = data as ReceiptPayload;

  return (
    <div className="mx-auto max-w-md">
      <Receipt payload={payload} />

      {can(user.role, 'transactions.reverse') && payload.transaction.status === 'posted' ? (
        <div className="no-print mt-8">
          <ReverseTransaction
            transactionId={payload.transaction.id}
            reference={payload.transaction.reference}
            amount={Number(payload.transaction.amount)}
            memberName={payload.transaction.member_name}
          />
        </div>
      ) : null}
    </div>
  );
}
