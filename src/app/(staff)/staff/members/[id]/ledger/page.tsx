import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getMemberFinancials } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { Icon, Money, PageTitle } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { TxnStatusBadge } from '@/components/ui/status';
import { StatementRange } from '@/components/StatementRange';
import { ExportButtons } from '@/components/ExportButtons';
import { PrintFooter, PrintLetterhead } from '@/components/print/PrintLetterhead';
import { documentName } from '@/lib/print';
import { SAVINGS_FREQUENCY_ADVERB } from '@/lib/categories';
import { formatDate, monthStart, toISODate, TXN_LABELS } from '@/lib/format';
import { formatAmount, formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { MemberStatement } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

export const metadata: Metadata = { title: 'Member ledger' };

/**
 * The financial ledger of one member.
 *
 * Debit, credit, running balance — the classic three columns, in the order the
 * transactions actually happened. The balance is computed from the movements by
 * `member_statement()`; it is not a stored number this page reads back, which
 * is why the closing figure and the member dashboard can never disagree.
 */
export default async function MemberLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePermission('members.view');
  const { id } = await params;
  const sp = await searchParams;

  const member = await getMemberFinancials(id);
  if (!member) notFound();

  const today = new Date();
  const from = isDate(sp.from) ? sp.from! : firstOfYear(today);
  const to = isDate(sp.to) ? sp.to! : toISODate(today);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('member_statement', {
    p_member_id: id,
    p_from: from,
    p_to: to,
  });

  if (error || !data) {
    return (
      <ErrorState
        title="Unable to load this ledger"
        description="Please check your connection and try again."
      />
    );
  }

  const statement = data as unknown as MemberStatement;
  const rows = statement.rows ?? [];
  const closing = rows.length > 0 ? rows[rows.length - 1].running_balance : statement.opening_balance;

  const totals = rows.reduce(
    (acc, r) => {
      const credit = isCredit(r.type);
      return {
        credit: acc.credit + (credit && r.status !== 'reversed' ? toNumber(r.amount) : 0),
        debit: acc.debit + (!credit && r.status !== 'reversed' ? toNumber(r.amount) : 0),
      };
    },
    { credit: 0, debit: 0 },
  );

  const csv = [
    ['Date', 'Reference', 'Transaction', 'Debit', 'Credit', 'Balance', 'Status'],
    ...rows.map((r) => [
      r.occurred_on,
      r.reference,
      r.description ?? TXN_LABELS[r.type],
      isCredit(r.type) ? '' : formatAmount(r.amount),
      isCredit(r.type) ? formatAmount(r.amount) : '',
      formatAmount(r.running_balance),
      r.status,
    ]),
  ];

  return (
    <div className="space-y-6">
      <Link
        href={`/staff/members/${id}`}
        className="text-label-md font-label-md text-on-surface-variant hover:text-primary inline-flex items-center gap-1 normal-case print:hidden"
      >
        <Icon name="arrow_back" size={18} />
        {member.full_name}
      </Link>

      <div className="print:hidden">
      <PageTitle
        title="Financial ledger"
        subtitle={`${member.full_name} · ${member.member_no}${
          member.savings_category_name ? ` · ${member.savings_category_name}` : ''
        }`}
        action={
          <ExportButtons
            filename={`ledger-${member.member_no}-${from}-to-${to}`}
            documentTitle={documentName('Member Ledger', `${member.full_name} ${from} to ${to}`)}
            rows={csv}
          />
        }
      />
      </div>

      <PrintLetterhead
        title="Member Financial Ledger"
        subtitle={`${member.full_name} · ${member.member_no}`}
        generatedBy={user.fullName}
        meta={[
          { label: 'Period', value: `${formatDate(from)} to ${formatDate(to)}` },
          {
            label: 'Saves as',
            value:
              member.savings_category_name && member.savings_frequency
                ? `${member.savings_category_name} · ${formatUGX(
                    member.savings_expected_amount,
                  )} ${SAVINGS_FREQUENCY_ADVERB[member.savings_frequency]}`
                : 'No savings category',
          },
          { label: 'Shares', value: member.share_category_name ?? 'No share category' },
          { label: 'Opening', value: formatUGX(statement.opening_balance) },
          { label: 'Closing', value: formatUGX(closing) },
        ]}
      />

      <div className="print:hidden">
        <StatementRange from={from} to={to} />
      </div>

      {/* ------------------------------------------------------- summary */}
      <section className="bg-surface shadow-card print-plain grid grid-cols-2 gap-4 rounded-xl p-4 lg:grid-cols-4">
        <Total label="Opening balance" value={statement.opening_balance} />
        <Total label="Money in" value={totals.credit} tone="text-tertiary" />
        <Total label="Money out" value={totals.debit} tone="text-error" />
        <Total label="Closing balance" value={closing} strong />
      </section>

      {/* --------------------------------------------------------- ledger */}
      {rows.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="receipt_long"
            title="No movements in this period"
            description={`Nothing was recorded for ${member.full_name} between ${formatDate(from)} and ${formatDate(to)}.`}
          />
        </div>
      ) : (
        <>
          {/* Mobile: one card per movement, since a five-column ledger is
              unreadable at 360px. */}
          <ul className="flex flex-col gap-2 lg:hidden print:hidden">
            {rows.map((r) => {
              const credit = isCredit(r.type);
              return (
                <li
                  key={r.reference}
                  className="bg-surface border-surface-container shadow-card rounded-xl border p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-body-md font-body-md text-on-surface truncate font-semibold">
                        {r.description ?? TXN_LABELS[r.type]}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                        {formatDate(r.occurred_on)} · {r.reference}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={clsx(
                          'text-body-md font-body-md tabular font-bold',
                          r.status === 'reversed' && 'text-on-surface-variant line-through',
                          r.status !== 'reversed' && (credit ? 'text-tertiary' : 'text-error'),
                        )}
                      >
                        {credit ? '+' : '−'}
                        {formatAmount(r.amount)}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant tabular normal-case">
                        {formatUGX(r.running_balance)}
                      </p>
                    </div>
                  </div>
                  {r.status !== 'posted' ? (
                    <div className="mt-2">
                      <TxnStatusBadge status={r.status} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {/* Desktop and print: the real ledger. */}
          <div className="bg-surface shadow-card hidden overflow-hidden rounded-xl lg:block print:block">
            <ScrollRow arrows="overlay" label="Table, scrolls sideways">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                    <th className="p-4 font-semibold">Date</th>
                    <th className="p-4 font-semibold">Reference</th>
                    <th className="p-4 font-semibold">Transaction</th>
                    <th className="p-4 text-right font-semibold">Debit</th>
                    <th className="p-4 text-right font-semibold">Credit</th>
                    <th className="p-4 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
                  <tr className="bg-surface-container-lowest">
                    <td className="text-on-surface-variant p-4" colSpan={5}>
                      Opening balance at {formatDate(from)}
                    </td>
                    <td className="tabular p-4 text-right font-semibold">
                      {formatAmount(statement.opening_balance)}
                    </td>
                  </tr>
                  {rows.map((r) => {
                    const credit = isCredit(r.type);
                    const reversed = r.status === 'reversed';
                    return (
                      <tr key={r.reference} className="hover:bg-surface-container-low">
                        <td className="text-on-surface-variant p-4 whitespace-nowrap">
                          {formatDate(r.occurred_on)}
                        </td>
                        <td className="tabular text-on-surface-variant p-4 whitespace-nowrap text-xs">
                          {r.reference}
                        </td>
                        <td className="p-4">
                          <span className={clsx(reversed && 'text-on-surface-variant line-through')}>
                            {r.description ?? TXN_LABELS[r.type]}
                          </span>
                          {r.status !== 'posted' ? (
                            <span className="ml-2 inline-block align-middle">
                              <TxnStatusBadge status={r.status} />
                            </span>
                          ) : null}
                        </td>
                        <td className="tabular p-4 text-right">
                          {!credit && !reversed ? formatAmount(r.amount) : '—'}
                        </td>
                        <td className="tabular text-tertiary p-4 text-right font-semibold">
                          {credit && !reversed ? formatAmount(r.amount) : '—'}
                        </td>
                        <td className="tabular p-4 text-right font-semibold">
                          {formatAmount(r.running_balance)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-surface-container-low/50 font-semibold">
                    <td className="p-4" colSpan={3}>
                      Closing balance at {formatDate(to)}
                    </td>
                    <td className="tabular p-4 text-right">{formatAmount(totals.debit)}</td>
                    <td className="tabular p-4 text-right">{formatAmount(totals.credit)}</td>
                    <td className="tabular p-4 text-right">{formatAmount(closing)}</td>
                  </tr>
                </tbody>
              </table>
            </ScrollRow>
          </div>
        </>
      )}

      <PrintFooter />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * Money into the savings position of the member. Share purchases and loan
 * repayments are cash the member handed over, but they do not raise the savings
 * balance, so the ledger shows them on the debit side of it.
 */
function isCredit(type: string): boolean {
  return type === 'weekly_savings' || type === 'monthly_savings' || type === 'deposit';
}

function isDate(v: string | undefined): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function firstOfYear(d: Date): string {
  return toISODate(new Date(d.getFullYear(), 0, 1)) || monthStart(d);
}

function Total({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: unknown;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-label-md font-label-md text-on-surface-variant truncate">
        {label}
      </p>
      <Money
        value={value}
        className={clsx(
          'mt-0.5 block truncate font-bold',
          strong
            ? 'text-headline-lg-mobile font-headline-lg-mobile'
            : 'text-body-lg font-body-lg',
          tone ?? 'text-on-surface',
        )}
      />
    </div>
  );
}
