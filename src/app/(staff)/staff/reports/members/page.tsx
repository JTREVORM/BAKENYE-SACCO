import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Icon, PageTitle } from '@/components/ui/primitives';
import { MemberStatusBadge } from '@/components/ui/status';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ExportButtons } from '@/components/ExportButtons';
import { PrintFooter, PrintLetterhead } from '@/components/print/PrintLetterhead';
import { documentName } from '@/lib/print';
import { formatDate, formatPhone } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import type { MemberFinancialsRow, MemberRegisterTotals, MemberStatus } from '@/types/db';
import styles from './MemberRegister.module.css';
import { ScrollRow } from '@/components/ui/scroll';

export const metadata: Metadata = { title: 'Member Register' };

/** Screen and print show one page; the streaming CSV covers the full register. */
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
  const statuses: MemberStatus[] = ['pending', 'active', 'inactive', 'suspended', 'archived', 'exited'];
  const status = statuses.includes(sp.status as MemberStatus) ? sp.status as MemberStatus : null;
  const requestedPage = Number(sp.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
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

  if (page > pageCount) redirect(pageHref(pageCount));
  const firstRecord = rows.length ? from + 1 : 0;
  const lastRecord = from + rows.length;
  const rangeLabel = `Showing ${firstRecord.toLocaleString()}–${lastRecord.toLocaleString()} of ${totals.members.toLocaleString()} members`;
  const pageLinkClass = 'min-h-touch-target-min inline-flex items-center justify-center gap-2 rounded-full border border-outline-variant bg-surface px-4 py-2 text-body-md font-semibold text-primary hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

  return (
    <div className={styles.register} data-member-register>
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
                className="min-h-touch-target-min inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-body-md font-semibold text-on-primary shadow-card hover:bg-ink-soft"
              >
                <Icon name="download" size={20} />Download full CSV
              </a>
              <ExportButtons
                filename="bnd-member-register"
                documentTitle={documentName('Member Register', `Page ${page} of ${pageCount}`)}
                showCsv={false}
              />
            </div>
          }
        />
      </div>

      <PrintLetterhead
        title="Member Register"
        subtitle={`${status ? `${status} members` : 'All members'} — page ${page} of ${pageCount} · ${rangeLabel}`}
        generatedBy={user.fullName}
        meta={[
          { label: 'All filtered members', value: totals.members.toLocaleString() },
          { label: 'All-member savings', value: formatUGX(totals.savings) },
          { label: 'Share capital', value: formatUGX(totals.shares) },
          { label: 'Loans outstanding', value: formatUGX(totals.loans) },
        ]}
      />

      <form action="/staff/reports/members" method="get" className="no-print mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-body-md font-semibold text-on-surface">
          Member status
          <select name="status" defaultValue={status ?? ''} className="min-h-touch-target-min rounded-xl border-outline-variant bg-surface py-2 pl-3 pr-9 font-normal">
            <option value="">All statuses</option>
            {statuses.map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
          </select>
        </label>
        <button className={pageLinkClass} type="submit">Apply filter</button>
      </form>
      <div className="mb-4 rounded-xl border-l-4 border-[#bf9644] bg-surface-container-low p-4 text-body-md text-on-surface">
        <p className="font-semibold">{rangeLabel} · Page {page} of {pageCount}</p>
        <p className="mt-1">This view and its printout contain only this page. Totals cover every member in the selected status filter. Download the full CSV for the complete filtered register.</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="group" title="No members" description="The register is empty." />
      ) : (
        <div className="bg-surface shadow-card print-block overflow-hidden rounded-xl">
          <ScrollRow arrows="overlay" className="scroll-x" label="Table, scrolls sideways">
            <table className="w-full min-w-[960px] border-collapse text-left print:min-w-0">
              <caption className="sr-only">Member register, page {page} of {pageCount}. {rangeLabel}. Financial totals cover all filtered members.</caption>
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
                    <td className="tabular whitespace-nowrap p-3 text-right">{formatUGX(r.savings_balance)}</td>
                    <td className="tabular whitespace-nowrap p-3 text-right">
                      {formatUGX(r.share_value)}
                      <span className="text-on-surface-variant block text-xs">
                        {r.share_count} held
                      </span>
                    </td>
                    <td className="tabular whitespace-nowrap p-3 text-right">{formatUGX(r.loan_balance)}</td>
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
                  <td className="tabular whitespace-nowrap p-3 text-right">{formatUGX(totals.savings)}</td>
                  <td className="tabular whitespace-nowrap p-3 text-right">{formatUGX(totals.shares)}</td>
                  <td className="tabular whitespace-nowrap p-3 text-right">{formatUGX(totals.loans)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </ScrollRow>
        </div>
      )}

      <nav className="no-print mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-4 shadow-card" aria-label="Register pages">
        <p className="text-body-md text-on-surface-variant">Page <strong className="text-on-surface">{page}</strong> of {pageCount} · {totals.members.toLocaleString()} records</p>
        <div className="flex flex-wrap items-center gap-2">
          {page > 1 ? <a href={pageHref(1)} className={pageLinkClass} aria-label="First page">First</a> : null}
          {page > 1 ? <a href={pageHref(page - 1)} className={pageLinkClass} rel="prev"><Icon name="chevron_left" size={18} />Previous</a> : <span aria-disabled="true" className="inline-flex min-h-11 items-center px-4 text-body-md text-on-surface-variant">Previous</span>}
          {page < pageCount ? <a href={pageHref(page + 1)} className={pageLinkClass} rel="next">Next<Icon name="chevron_right" size={18} /></a> : <span aria-disabled="true" className="inline-flex min-h-11 items-center px-4 text-body-md text-on-surface-variant">Next</span>}
          {page < pageCount ? <a href={pageHref(pageCount)} className={pageLinkClass} aria-label="Last page">Last</a> : null}
        </div>
      </nav>

      <PrintFooter />
    </div>
  );
}
