import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getUnreadCount } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { MemberShell } from '@/components/layout/MemberShell';
import { Icon, Money, Avatar } from '@/components/ui/primitives';
import { GuarantorStatusBadge, LoanStatusBadge } from '@/components/ui/status';
import { EmptyState, Alert } from '@/components/ui/states';
import { GuaranteeResponse } from './GuaranteeResponse';
import { formatDate } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import type { GuarantorStatus, LoanStatus } from '@/types/db';

export const metadata: Metadata = { title: 'My Guarantees' };

type GuaranteeRow = {
  id: string;
  loan_id: string;
  guaranteed_amount: number;
  status: GuarantorStatus;
  responded_on: string | null;
  created_at: string;
  loans: {
    loan_no: string;
    principal: number;
    status: LoanStatus;
    applied_on: string;
    purpose: string;
    members: { full_name: string; member_no: string; photo_url: string | null } | null;
  } | null;
};

/**
 * Loans this member is guaranteeing.
 *
 * Being a guarantor is a real financial obligation, so it gets a real screen:
 * who is borrowing, how much this member is on the hook for, and — where the
 * request is still pending — the accept/decline decision.
 */
export default async function GuaranteesPage() {
  const user = await requireMember();
  const unread = await getUnreadCount();

  const supabase = await createClient();
  const { data } = await supabase
    .from('loan_guarantors')
    .select(
      'id, loan_id, guaranteed_amount, status, responded_on, created_at, ' +
        'loans!loan_guarantors_loan_id_fkey(loan_no, principal, status, applied_on, purpose, ' +
        'members!loans_member_id_fkey(full_name, member_no, photo_url))',
    )
    .eq('member_id', user.memberId)
    .order('created_at', { ascending: false });

  const rows = (data ?? []) as unknown as GuaranteeRow[];
  const pending = rows.filter((r) => r.status === 'pending');
  const live = rows.filter(
    (r) => r.status === 'accepted' && ['active', 'disbursed', 'defaulted'].includes(r.loans?.status ?? ''),
  );
  const exposure = live.reduce((sum, r) => sum + Number(r.guaranteed_amount), 0);

  return (
    <MemberShell unreadCount={unread}>
      <div className="flex flex-col gap-6 py-4">
        <div>
          <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
            My Guarantees
          </h1>
          <p className="text-body-md font-body-md text-on-surface-variant mt-1">
            Loans you have agreed to back for other members.
          </p>
        </div>

        {/* Current exposure — the number that actually matters. */}
        <div className="bg-surface-container-high border-surface-container-highest shadow-card rounded-xl border p-5">
          <p className="text-label-md font-label-md text-on-surface-variant">
            Your current exposure
          </p>
          <Money
            value={exposure}
            className="text-display-currency font-display-currency text-on-surface mt-1 block"
          />
          <p className="text-body-md font-body-md text-on-surface-variant mt-1">
            across {live.length} active {live.length === 1 ? 'loan' : 'loans'}
          </p>
        </div>

        {pending.length > 0 ? (
          <Alert tone="warning" title={`${pending.length} guarantee request${pending.length === 1 ? '' : 's'} waiting`}>
            Someone has named you as a guarantor. Accepting means you may be asked to repay if they
            default.
          </Alert>
        ) : null}

        {rows.length === 0 ? (
          <div className="bg-surface rounded-xl shadow-neu-sm">
            <EmptyState
              icon="handshake"
              title="No guarantees"
              description="When another member asks you to guarantee their loan, the request will appear here."
            />
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((g) => (
              <li
                key={g.id}
                className="bg-surface shadow-card overflow-hidden rounded-xl"
              >
                <Link
                  href={`/loans/${g.loan_id}`}
                  className="hover:bg-surface-container-low flex items-start gap-3 p-4 transition-colors"
                >
                  <Avatar
                    name={g.loans?.members?.full_name}
                    src={g.loans?.members?.photo_url}
                    size={44}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                      {g.loans?.members?.full_name ?? 'Unknown member'}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                      {g.loans?.loan_no} · applied {formatDate(g.loans?.applied_on)}
                    </p>
                    <p className="text-body-md font-body-md text-on-surface-variant mt-1 truncate">
                      {g.loans?.purpose}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <GuarantorStatusBadge status={g.status} />
                      {g.loans ? <LoanStatusBadge status={g.loans.status} /> : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-label-md font-label-md text-on-surface-variant">
                      You back
                    </p>
                    <Money
                      value={g.guaranteed_amount}
                      className="text-body-lg font-body-lg text-on-surface font-bold"
                    />
                    <p className="text-label-md font-label-md text-on-surface-variant/70 mt-1 normal-case">
                      of {formatUGX(g.loans?.principal)}
                    </p>
                  </div>
                </Link>

                {g.status === 'pending' ? (
                  <div className="border-outline-variant bg-surface-container-low border-t p-4">
                    <GuaranteeResponse
                      guarantorId={g.id}
                      borrowerName={g.loans?.members?.full_name ?? 'this member'}
                      amount={Number(g.guaranteed_amount)}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="bg-surface-container-low rounded-xl p-4 shadow-neu-sm">
          <h2 className="text-button-text font-button-text text-on-surface flex items-center gap-2">
            <Icon name="info" size={20} className="text-primary" />
            What guaranteeing means
          </h2>
          <p className="text-body-md font-body-md text-on-surface-variant mt-2">
            If the borrower stops repaying, the SACCO may recover the amount you guaranteed from
            your savings. Only guarantee an amount you could afford to lose, and only for members
            you know well. You cannot withdraw a guarantee once the loan has been disbursed.
          </p>
        </div>
      </div>
    </MemberShell>
  );
}
