import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageTitle } from '@/components/ui/primitives';
import { MemberStatusBadge } from '@/components/ui/status';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ExportButtons } from '@/components/ExportButtons';
import { formatDate, formatPhone } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import type { MemberFinancialsRow, MemberStatus } from '@/types/db';

export const metadata: Metadata = { title: 'Member Register' };

/**
 * Member register.
 *
 * The full statutory list, formatted to print on A4 in landscape and to export
 * as CSV for Excel. This is the one report that deliberately fetches every
 * active member rather than paging — a register with page breaks in it is not a
 * register — so it is capped and the cap is stated.
 */
export default async function MemberRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requirePermission('members.view');
  const sp = await searchParams;

  const supabase = await createClient();
  let query = supabase
    .from('member_financials')
    .select('*')
    .order('member_no')
    .limit(1000);

  if (sp.status) query = query.eq('status', sp.status as MemberStatus);

  const { data, error } = await query;

  if (error) {
    return <ErrorState title="Unable to load the member register" />;
  }

  const rows = (data ?? []) as MemberFinancialsRow[];
  const totals = rows.reduce(
    (acc, r) => ({
      savings: acc.savings + toNumber(r.savings_balance),
      shares: acc.shares + toNumber(r.share_value),
      loans: acc.loans + toNumber(r.loan_balance),
    }),
    { savings: 0, shares: 0, loans: 0 },
  );

  const csv = [
    ['Member No', 'Name', 'Phone', 'National ID', 'Joined', 'Status', 'Savings', 'Shares', 'Share value', 'Loan balance'],
    ...rows.map((r) => [
      r.member_no,
      r.full_name,
      r.phone,
      r.national_id ?? '',
      r.joined_on,
      r.status,
      String(toNumber(r.savings_balance)),
      String(r.share_count),
      String(toNumber(r.share_value)),
      String(toNumber(r.loan_balance)),
    ]),
  ];

  return (
    <div>
      <div className="no-print">
        <PageTitle
          title="Member Register"
          subtitle={`${rows.length} ${rows.length === 1 ? 'member' : 'members'}${
            rows.length === 1000 ? ' (showing the first 1,000)' : ''
          }`}
          action={<ExportButtons rows={csv} filename="bnd-member-register" />}
        />
      </div>

      <h1 className="text-headline-lg font-headline-lg text-primary mb-1 hidden print:block">
        BAKENYE NATIONAL DEVELOPMENT SACCO — Member Register
      </h1>
      <p className="text-body-md font-body-md text-on-surface-variant mb-4 hidden print:block">
        Generated {formatDate(new Date())} · {rows.length} members
      </p>

      {rows.length === 0 ? (
        <EmptyState icon="group" title="No members" description="The register is empty." />
      ) : (
        <div className="bg-surface border-outline-variant/30 elev-1 print-block overflow-hidden rounded-xl border">
          <div className="scroll-x">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant/50 border-b uppercase tracking-wider">
                  <th className="p-3 font-semibold">Member No</th>
                  <th className="p-3 font-semibold">Name</th>
                  <th className="p-3 font-semibold">Phone</th>
                  <th className="p-3 font-semibold">Joined</th>
                  <th className="p-3 text-right font-semibold">Savings</th>
                  <th className="p-3 text-right font-semibold">Shares</th>
                  <th className="p-3 text-right font-semibold">Loan balance</th>
                  <th className="p-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/30 divide-y">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="tabular p-3 whitespace-nowrap">{r.member_no}</td>
                    <td className="p-3 font-medium">{r.full_name}</td>
                    <td className="tabular p-3 whitespace-nowrap">{formatPhone(r.phone)}</td>
                    <td className="p-3 whitespace-nowrap">{formatDate(r.joined_on)}</td>
                    <td className="tabular p-3 text-right">{formatUGX(r.savings_balance)}</td>
                    <td className="tabular p-3 text-right">
                      {formatUGX(r.share_value)}
                      <span className="text-on-surface-variant block text-xs">
                        {r.share_count} held
                      </span>
                    </td>
                    <td className="tabular p-3 text-right">{formatUGX(r.loan_balance)}</td>
                    <td className="p-3">
                      <MemberStatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface-container-low/50 font-bold">
                  <td className="p-3" colSpan={4}>
                    Totals
                  </td>
                  <td className="tabular p-3 text-right">{formatUGX(totals.savings)}</td>
                  <td className="tabular p-3 text-right">{formatUGX(totals.shares)}</td>
                  <td className="tabular p-3 text-right">{formatUGX(totals.loans)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
