import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getMembershipFeeDashboard, searchMembershipFees } from '@/lib/queries';
import { getCollectionAccounts } from '@/lib/access-queries';
import { can } from '@/lib/rbac';
import { Icon, Money, PageTitle } from '@/components/ui/primitives';
import { ErrorState, StatGridSkeleton } from '@/components/ui/states';
import { PrintFooter, PrintLetterhead } from '@/components/print/PrintLetterhead';
import { MembershipFeesBrowser } from './MembershipFeesBrowser';
import { formatUGX } from '@/lib/money';
import { clsx } from '@/lib/clsx';

export const metadata: Metadata = { title: 'Membership fees' };

const PAGE_SIZE = 25;

/**
 * The Membership Fees module.
 *
 * Savings and Shares each have a module; the payment every member must make to
 * join had none, and was only reachable from a member's own record. This is
 * that module: what the SACCO has collected, who has settled, who is part way
 * and who has not started.
 *
 * The fee itself is never written down in this code. It is whatever the `fees`
 * configuration currently says, read by the database, and each member's
 * required amount is what *they* were charged — which is not always today's
 * figure, because a member charged before a rise keeps the charge they were
 * given and is topped up by a separate, visible charge.
 */
export default async function MembershipFeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const user = await requirePermission('members.view');
  const sp = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <PageTitle
          title="Membership fees"
          subtitle="What each member owes to join, what they have paid, and what is left. Part payments are welcome."
        />
      </div>

      <Suspense key={JSON.stringify(sp)} fallback={<StatGridSkeleton />}>
        <Board sp={sp} generatedBy={user.fullName} canCollect={can(user, 'fees.collect')} />
      </Suspense>
    </div>
  );
}

async function Board({
  sp,
  generatedBy,
  canCollect,
}: {
  sp: { q?: string; status?: string; page?: string };
  generatedBy: string;
  canCollect: boolean;
}) {
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const [dash, list, accounts] = await Promise.all([
    getMembershipFeeDashboard(),
    searchMembershipFees(sp.q, sp.status, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    getCollectionAccounts(),
  ]);

  if (!dash) {
    return (
      <ErrorState
        title="Unable to load membership fees"
        description="Please check your connection and try again."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PrintLetterhead
        title="Membership Fees"
        subtitle={`Current membership fee ${formatUGX(dash.fee_amount)}`}
        generatedBy={generatedBy}
        meta={[
          { label: 'Collected in total', value: formatUGX(dash.collected_total) },
          { label: 'Fully paid', value: String(dash.members_paid) },
          { label: 'Part paid', value: String(dash.members_partial) },
          { label: 'Unpaid', value: String(dash.members_unpaid) },
          { label: 'Still outstanding', value: formatUGX(dash.outstanding_total) },
        ]}
      />

      {/* ------------------------------------------------------- collected */}
      <section className="gap-gutter grid grid-cols-2 lg:grid-cols-4">
        <Tile label="Collected in total" money={dash.collected_total} icon="account_balance" />
        <Tile
          label="Collected this month"
          money={dash.collected_month}
          icon="calendar_month"
          tone="text-tertiary"
        />
        <Tile label="Collected today" money={dash.collected_today} icon="today" />
        <Tile label="Still outstanding" money={dash.outstanding_total} icon="pending" tone="text-primary" />
      </section>

      {/* --------------------------------------------------- who stands where */}
      <section className="bg-surface shadow-card grid grid-cols-2 gap-4 rounded-xl p-4 sm:grid-cols-4">
        <Count label="Fully paid" value={dash.members_paid} tone="text-tertiary" />
        <Count label="Part paid" value={dash.members_partial} />
        <Count label="Unpaid" value={dash.members_unpaid} tone="text-primary" />
        <Count label="Waived" value={dash.members_waived} />
      </section>

      {/* ------------------------------------------------------ the fee itself */}
      <section className="bg-surface shadow-card flex flex-wrap items-center justify-between gap-4 rounded-xl p-5">
        <div className="min-w-0">
          <p className="text-label-md font-label-md text-on-surface-variant">
            Membership fee to join today
          </p>
          <Money
            value={dash.fee_amount}
            className="text-display-currency font-display-currency text-on-surface"
          />
        </div>
        <p className="text-label-md font-label-md text-on-surface-variant max-w-sm normal-case">
          Set under Settings → Fees. A member charged before a change keeps the amount they were
          charged, and any difference is raised as its own charge.
        </p>
      </section>

      {/* The rule, said once. */}
      <section className="bg-secondary-fixed text-on-secondary-fixed flex items-start gap-3 rounded-xl p-4 print:hidden">
        <Icon name="info" size={20} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-button-text font-button-text">
            The membership fee is mandatory, and may be paid in instalments.
          </p>
          <p className="text-body-md font-body-md mt-1 normal-case">
            A new member stays Pending until the whole fee is settled. Part payments are recorded
            against the balance and shown here; the counter will not take more than is owed.
          </p>
        </div>
      </section>

      <MembershipFeesBrowser
        rows={list.rows}
        total={list.total}
        page={page}
        pageSize={PAGE_SIZE}
        accounts={accounts}
        canCollect={canCollect}
      />

      <PrintFooter />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function Tile({
  label,
  money,
  icon,
  tone,
}: {
  label: string;
  money: unknown;
  icon: string;
  tone?: string;
}) {
  return (
    <div className="bg-surface shadow-card rounded-xl p-5">
      <div className="bg-primary-fixed text-primary mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg">
        <Icon name={icon} size={20} />
      </div>
      <p className="text-label-md font-label-md text-on-surface-variant mb-1">{label}</p>
      <Money
        value={money}
        compact
        className={clsx('text-display-currency font-display-currency', tone ?? 'text-on-surface')}
      />
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-label-md font-label-md text-on-surface-variant truncate">{label}</p>
      <p
        className={clsx(
          'text-headline-lg-mobile font-headline-lg-mobile tabular mt-0.5',
          tone ?? 'text-on-surface',
        )}
      >
        {value}
      </p>
    </div>
  );
}
