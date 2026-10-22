import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageTitle } from '@/components/ui/primitives';
import { MemberStatusBadge } from '@/components/ui/status';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ExportButtons } from '@/components/ExportButtons';
import { PrintFooter, PrintLetterhead } from '@/components/print/PrintLetterhead';
import { documentName } from '@/lib/print';
import { formatDate, formatPhone } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import type { MemberFinancialsRow, MemberRegisterTotals, MemberStatus } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

export const metadata: Metadata = { title: 'Member Register' };

/** Members per page. A register prints as a register; the screen pages. */
const PAGE_SIZE = 250;

/**
 * Member register.
 *
 * The full statutory list, formatted to print on A4 in landscape and to export
 * as CSV for Excel.
 *
 * F-05 changed three things about how this page gets its numbers, and none of
 * them is cosmetic:
 *
 *  - **The totals come from the database**, over every member the filter
 *    selects, through `member_register_totals()`. They used to be summed from
 *    the rows this page had fetched, which was capped at 1,000 — so past 1,000
 *    members the register would have shown a SACCO-wide-looking total that
 *    understated savings, share capital and the loan book. A total computed
 *    from a page is not a total.
 *  - **The table pages** rather than being capped and left to say so in its
 *    heading.
 *  - **The CSV is a streaming download** (`./export`) covering the whole roll,
 *    instead of being built in the browser from the rows on screen.
 */
export default async function MemberRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const user = await requirePermission('members.view');
  const sp = await searchParams;
  const status = sp.status ? (sp.status as MemberStatus) : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  let query = supabase
    .from('member_financials')
    .select('*')
    .order('member_no')
    .range(from, from + PAGE_SIZE - 1);

  if (status) query = query.eq('status', status);

  // The page of rows, and the totals for the whole filtered set, together.
  const [{ data, error }, { data: totalsData, error: totalsError }] = await Promise.all([
    query,
    supabase.rpc('member_register_totals', { p_status: status }),
  ]);

  if (error || totalsError) {
    return <ErrorState title="Unable to load the member register" />;
  }

  const rows = (data ?? []) as MemberFinancialsRow[];
  const registerTotals = (totalsData ?? null) as MemberRegisterTotals | null;
  const totals = {
    members: registerTotals ? Number(registerTotals.members) : rows.length,
    savings: toNumber(registerTotals?.savings_balance ?? 0),
    shares: toNumber(registerTotals?.share_value ?? 0),
    loans: toNumber(registerTotals?.loan_balance ?? 0),
  };
  const pageCount = Math.max(1, Math.ceil(totals.members / PAGE_SIZE));
  const exportHref = `/staff/reports/members/export${status ? `?status=${status}` : ''}`;
  const pageHref = (n: number) =>
    `/staff/reports/members?${new URLSearchParams({
      ...(status ? { status } : {}),
      page: String(n),
    }).toString()}`;

  return (
    <div>
      <div className="no-print">
        <PageTitle
          title="Member Register"
          subtitle={
            pageCount > 1
              ? `${totals.members.toLocaleString()} members — page ${page} of ${pageCount}`
              : `${totals.members.toLocaleString()} ${totals.members === 1 ? 'member' : 'members'}`
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              {/* The whole roll, streamed from the server, never just this page. */}
              <a
                href={exportHref}
                className="text-label-lg font-label-lg text-on-surface border-outline-variant min-h-touch-target-min inline-flex items-center rounded-full border px-4 py-2"
              >
                Download CSV
              </a>
              <ExportButtons
                filename="bnd-member-register"
                documentTitle={documentName('Member Register')}
                showCsv={false}
              />
            </div>
          }
        />
      </div>

      <PrintLetterhead
        title="Member Register"
        subtitle={sp.status ? `${sp.status} members` : 'All members'}
        generatedBy={user.fullName}
        meta={[
          { label: 'Members', value: totals.members.toLocaleString() },
          { label: 'Total savings', value: formatUGX(totals.savings) },
          { label: 'Share capital', value: formatUGX(totals.shares) },
          { label: 'Loans outstanding', value: formatUGX(totals.loans) },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState icon="group" title="No members" description="The register is empty." />
      ) : (
        <div className="bg-surface shadow-card print-block overflow-hidden rounded-xl">
          <ScrollRow arrows="overlay" className="scroll-x" label="Table, scrolls sideways">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
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
              <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
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
                    {/* Every member the filter selects, not the rows above. */}
                    Totals — all {totals.members.toLocaleString()} members
                  </td>
                  <td className="tabular p-3 text-right">{formatUGX(totals.savings)}</td>
                  <td className="tabular p-3 text-right">{formatUGX(totals.shares)}</td>
                  <td className="tabular p-3 text-right">{formatUGX(totals.loans)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </ScrollRow>
        </div>
      )}

      {pageCount > 1 ? (
        <nav className="no-print mt-4 flex items-center justify-between gap-3" aria-label="Register pages">
          {page > 1 ? (
            <a
              href={pageHref(page - 1)}
              className="text-label-lg font-label-lg text-on-surface border-outline-variant min-h-touch-target-min inline-flex items-center rounded-full border px-4 py-2"
            >
              Previous
            </a>
          ) : (
            <span />
          )}
          <span className="text-body-sm font-body-sm text-on-surface-variant">
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <a
              href={pageHref(page + 1)}
              className="text-label-lg font-label-lg text-on-surface border-outline-variant min-h-touch-target-min inline-flex items-center rounded-full border px-4 py-2"
            >
              Next
            </a>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <PrintFooter />
    </div>
  );
}
