import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getUnreadCount } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { MemberShell } from '@/components/layout/MemberShell';
import { Receipt } from '@/components/Receipt';
import type { ReceiptPayload } from '@/types/db';

export const metadata: Metadata = { title: 'Receipt' };

/**
 * A member's receipt.
 *
 * `receipt_for_transaction` refuses to return a transaction that belongs to
 * someone else, so pasting another member's transaction id into the URL
 * produces a not-found rather than a leak.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMember();
  const { id } = await params;
  const unread = await getUnreadCount();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('receipt_for_transaction', {
    p_transaction_id: id,
  });

  if (error || !data) notFound();

  return (
    <MemberShell title="Receipt" backHref="/transactions" unreadCount={unread}>
      <div className="py-2">
        <Receipt payload={data as ReceiptPayload} />
      </div>
    </MemberShell>
  );
}
