import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { getAllLoanProducts } from '@/lib/queries';
import { getRules } from '@/lib/settings';
import { Icon, Panel, Badge, PageTitle, DataTable } from '@/components/ui/primitives';
import { EmptyState, Alert } from '@/components/ui/states';
import { formatUGX } from '@/lib/money';
import { LoanProductStatusControl } from '@/components/loans/LoanProductStatusControl';
import {
  REPAYMENT_FREQUENCY_LABELS,
  type LoanProductRow,
} from '@/types/db';

export const metadata: Metadata = { title: 'Loan Products' };

/**
 * Loan products.
 *
 * The catalogue of what a member may borrow, and on what terms. Everything here
 * is a row in `loan_products` — there is no product written into the source,
 * and no `if (type === 'business')` anywhere in the application. Adding a
 * product is a form; the loan wizard, the quote, the eligibility check and the
 * reports all pick it up because they all read the same table.
 *
 * Products are never deleted. Every loan ever written under one references it,
 * and a financial record that cannot name the terms it was written on is not a
 * record. They are retired instead, which takes them out of the application
 * form and leaves the history intact.
 */
export default async function LoanProductsPage() {
  const user = await requirePermission('loans.view');
  const canManage = can(user.role, 'settings.manage');

  const [products, rules, counts] = await Promise.all([
    getAllLoanProducts(),
    getRules(),
    loanCountsByProduct(),
  ]);

  const active = products.filter((p) => p.is_active);

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="inventory_2"
        title="Loan Products"
        subtitle="The terms members may borrow under. Editing a product changes future applications only."
        breadcrumb={[
          { label: 'Staff', href: '/staff' },
          { label: 'Loans', href: '/staff/loans' },
          { label: 'Products' },
        ]}
        action={
          canManage ? (
            <Link
              href="/staff/loans/products/new"
              className="inline-flex h-touch-target-min items-center gap-2 rounded-full bg-ink px-5 text-button-text font-semibold text-white shadow-neu-dark transition-[background-color,box-shadow] hover:bg-ink-soft"
            >
              <Icon name="add" size={18} />
              New product
            </Link>
          ) : null
        }
      />

      {products.length === 0 ? (
        <Panel title="Loan Products" icon="inventory_2">
          <EmptyState
            icon="inventory_2"
            title="No loan products yet"
            description="A loan product sets the interest rate, term limits, fees and eligibility rules a member borrows under. Until one exists, no application can be made."
            action={
              canManage ? (
                <Link
                  href="/staff/loans/products/new"
                  className="inline-flex h-touch-target-min items-center gap-2 rounded-full bg-ink px-5 text-button-text font-semibold text-white shadow-neu-dark transition-[background-color,box-shadow] hover:bg-ink-soft"
                >
                  <Icon name="add" size={18} />
                  Create the first product
                </Link>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <>
          <Alert tone="info" title="These products sit under the SACCO-wide loan rules">
            Whatever a product allows, every application is also checked against the rules in{' '}
            <Link
              href="/staff/settings?section=loans"
              className="font-semibold text-primary underline"
            >
              Settings → Loans
            </Link>
            : at most {rules.maxActiveLoans} loan
            {rules.maxActiveLoans === 1 ? '' : 's'} at a time per member
            {rules.maxSavingsMultiple > 0
              ? `, and borrowing capped at ${rules.maxSavingsMultiple}× savings unless a product sets its own limit`
              : ''}
            .
          </Alert>

          <Panel
            title="Products"
            icon="inventory_2"
            subtitle={`${active.length} active of ${products.length}`}
            padded={false}
          >
            {/* Mobile: cards, because eleven columns do not fit a phone. */}
            <ul className="divide-y divide-outline-variant/70 lg:hidden">
              {products.map((p) => (
                <li key={p.id} className="p-4">
                  <ProductCard
                    product={p}
                    liveLoans={counts.get(p.id) ?? 0}
                    canManage={canManage}
                  />
                </li>
              ))}
            </ul>

            <div className="hidden lg:block">
              <DataTable
                className="rounded-none border-0 shadow-none"
                head={
                  <>
                    <th>Product</th>
                    <th className="text-right">Interest</th>
                    <th className="text-right">Amount range</th>
                    <th className="text-right">Term</th>
                    <th>Repaid</th>
                    <th className="text-right">Fees</th>
                    <th className="text-center">Guarantors</th>
                    <th className="text-right">Loans</th>
                    <th>Status</th>
                    <th className="text-right">Manage</th>
                  </>
                }
              >
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link
                        href={`/staff/loans/products/${p.id}`}
                        className="font-semibold text-on-surface hover:text-primary"
                      >
                        {p.name}
                      </Link>
                      <div className="tabular text-label-md font-normal text-on-surface-variant">
                        {p.code}
                        {p.category ? ` · ${p.category}` : ''}
                      </div>
                    </td>
                    <td className="tabular whitespace-nowrap text-right">
                      <span className="font-semibold">{p.interest_rate}%</span>
                      <div className="text-label-md font-normal capitalize text-on-surface-variant">
                        {p.interest_method}
                      </div>
                    </td>
                    <td className="tabular whitespace-nowrap text-right">
                      {compact(p.min_amount)} – {compact(p.max_amount)}
                    </td>
                    <td className="tabular whitespace-nowrap text-right">
                      {p.min_period_months}–{p.max_period_months} mo
                    </td>
                    <td className="whitespace-nowrap text-on-surface-variant">
                      {REPAYMENT_FREQUENCY_LABELS[p.repayment_frequency]}
                    </td>
                    <td className="tabular whitespace-nowrap text-right">
                      {feeSummary(p)}
                    </td>
                    <td className="tabular text-center">
                      {p.requires_guarantors ? p.min_guarantors : '—'}
                    </td>
                    <td className="tabular text-right">{counts.get(p.id) ?? 0}</td>
                    <td>
                      <Badge tone={p.is_active ? 'success' : 'neutral'} dot>
                        {p.is_active ? 'Active' : 'Retired'}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/staff/loans/products/${p.id}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-label-md font-semibold text-primary shadow-neu-sm transition-shadow hover:shadow-card active:shadow-neu-pressed"
                        >
                          {canManage ? 'Edit' : 'View'}
                        </Link>
                        {canManage ? (
                          <LoanProductStatusControl
                            productId={p.id}
                            name={p.name}
                            isActive={p.is_active}
                            liveLoans={counts.get(p.id) ?? 0}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </DataTable>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function ProductCard({
  product: p,
  liveLoans,
  canManage,
}: {
  product: LoanProductRow;
  liveLoans: number;
  canManage: boolean;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/staff/loans/products/${p.id}`}
            className="truncate text-body-lg font-semibold text-on-surface hover:text-primary"
          >
            {p.name}
          </Link>
          <p className="tabular text-label-md font-normal text-on-surface-variant">
            {p.code}
            {p.category ? ` · ${p.category}` : ''}
          </p>
        </div>
        <Badge tone={p.is_active ? 'success' : 'neutral'} dot>
          {p.is_active ? 'Active' : 'Retired'}
        </Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <Fact label="Interest" value={`${p.interest_rate}% ${p.interest_method}`} />
        <Fact label="Term" value={`${p.min_period_months}–${p.max_period_months} months`} />
        <Fact label="Amount" value={`${compact(p.min_amount)} – ${compact(p.max_amount)}`} />
        <Fact label="Repaid" value={REPAYMENT_FREQUENCY_LABELS[p.repayment_frequency]} />
        <Fact label="Fees" value={feeSummary(p)} />
        <Fact
          label="Guarantors"
          value={p.requires_guarantors ? String(p.min_guarantors) : 'Not required'}
        />
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/staff/loans/products/${p.id}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-label-md font-semibold text-primary shadow-neu-sm transition-shadow hover:shadow-card active:shadow-neu-pressed"
        >
          <Icon name={canManage ? 'edit' : 'visibility'} size={15} />
          {canManage ? 'Edit terms' : 'View terms'}
        </Link>
        {canManage ? (
          <LoanProductStatusControl
            productId={p.id}
            name={p.name}
            isActive={p.is_active}
            liveLoans={liveLoans}
          />
        ) : null}
        {liveLoans > 0 ? (
          <span className="text-label-md font-normal text-on-surface-variant">
            {liveLoans} loan{liveLoans === 1 ? '' : 's'} written
          </span>
        ) : null}
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-normal text-on-surface-variant">{label}</dt>
      <dd className="tabular truncate text-body-md font-semibold text-on-surface">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * How many loans exist per product.
 *
 * Shown so that retiring a product is an informed decision: a product with
 * forty loans running under it is not one to switch off casually, even though
 * doing so is safe.
 */
async function loanCountsByProduct(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase.from('loans').select('product_id');
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { product_id: string }[]) {
    counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1);
  }
  return counts;
}

function feeSummary(p: LoanProductRow): string {
  const parts: string[] = [];
  if (Number(p.processing_fee_pct) > 0) parts.push(`${p.processing_fee_pct}% proc`);
  if (Number(p.insurance_fee_pct) > 0) parts.push(`${p.insurance_fee_pct}% ins`);
  if (Number(p.application_fee) > 0) parts.push(formatUGX(p.application_fee));
  return parts.length === 0 ? 'None' : parts.join(' + ');
}

function compact(value: number): string {
  const n = Number(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
