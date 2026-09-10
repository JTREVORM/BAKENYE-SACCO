import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/rbac';
import { getRules } from '@/lib/settings';
import { Badge, Icon, Money, PageTitle, ProgressBar } from '@/components/ui/primitives';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { ShareCategoryDialog } from '@/components/categories/ShareCategoryDialog';
import { SavingsCategoryDialog } from '@/components/categories/SavingsCategoryDialog';
import { CategoryStatusControl } from '@/components/categories/CategoryStatusControl';
import {
  CATEGORY_STATUS_LABELS,
  CATEGORY_STATUS_TONES,
  SAVINGS_FREQUENCY_ADVERB,
  categoryTier,
  qualificationWindow,
} from '@/lib/categories';
import { formatUGX, percent, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type {
  SavingsCategoryRow,
  SavingsCategorySummaryRow,
  ShareCategoryRow,
  ShareCategorySummaryRow,
} from '@/types/db';

export const metadata: Metadata = { title: 'Categories' };

/**
 * Category management — section 16 of the brief.
 *
 * Share categories and savings categories are configuration, not code. Required
 * shares, share price, qualification window, savings amount and frequency are
 * all editable here, and every screen in the application reads them back — so a
 * SACCO that introduces a fourth tier, or moves the Gold Saver from UGX 50,000
 * to UGX 60,000, does it on this page rather than in a migration.
 *
 * Each category is shown next to what it is actually doing: how many members
 * hold it, what it expects each cycle, and — for shares — how many members have
 * qualified. Those figures are aggregates over real rows, so a category with no
 * members reads zero and says so.
 */
export default async function CategoriesPage() {
  const user = await requirePermission('categories.view');
  const canManage = can(user.role, 'categories.manage');

  return (
    <div className="flex flex-col gap-8">
      <PageTitle
        title="Categories"
        subtitle="The share and savings tiers members are held to. Every figure below is read back by the rest of the application."
      />

      <Suspense fallback={<TableSkeleton rows={3} cols={5} />}>
        <SavingsCategories canManage={canManage} />
      </Suspense>

      <Suspense fallback={<TableSkeleton rows={3} cols={5} />}>
        <ShareCategories canManage={canManage} />
      </Suspense>

      <Suspense fallback={null}>
        <MatchingRule />
      </Suspense>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

async function SavingsCategories({ canManage }: { canManage: boolean }) {
  const supabase = await createClient();
  const [{ data: rows, error }, { data: summaries }] = await Promise.all([
    supabase
      .from('savings_categories')
      .select('*')
      .order('status')
      .order('sort_order')
      .order('name'),
    supabase.from('savings_category_summary').select('*'),
  ]);

  if (error) {
    return (
      <ErrorState
        title="Unable to load savings categories"
        description="Please check your connection and try again."
      />
    );
  }

  const categories = (rows ?? []) as SavingsCategoryRow[];
  const byId = new Map(
    ((summaries ?? []) as SavingsCategorySummaryRow[]).map((s) => [s.savings_category_id, s]),
  );

  return (
    <section>
      <Header
        icon="savings"
        title="Savings categories"
        description="What a member in each category saves, and how often. This is what raises their schedule."
        action={canManage ? <SavingsCategoryDialog /> : null}
      />

      {categories.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="savings"
            title="No savings categories yet"
            description="Until a category exists, no schedule can be raised and nothing is expected of any member."
          />
        </div>
      ) : (
        <ul className="gap-gutter grid grid-cols-1 lg:grid-cols-3">
          {categories.map((c) => {
            const s = byId.get(c.id);
            const tier = categoryTier(c.code);
            const rate = toNumber(s?.collection_rate);

            return (
              <li
                key={c.id}
                className={clsx(
                  'bg-surface shadow-card flex flex-col gap-4 rounded-xl p-5',
                  c.status === 'inactive' && 'opacity-70',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="bg-primary-fixed text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                      <Icon name={tier.icon} size={22} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                        {c.name}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant tabular normal-case">
                        {c.code}
                      </p>
                    </div>
                  </div>
                  <Badge tone={CATEGORY_STATUS_TONES[c.status]}>
                    {CATEGORY_STATUS_LABELS[c.status]}
                  </Badge>
                </div>

                <p className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface tabular">
                  {formatUGX(c.amount)}
                  <span className="text-body-md font-body-md text-on-surface-variant ml-1.5 font-normal">
                    {SAVINGS_FREQUENCY_ADVERB[c.frequency]}
                  </span>
                </p>

                {c.description ? (
                  <p className="text-body-md font-body-md text-on-surface-variant">
                    {c.description}
                  </p>
                ) : null}

                <dl className="border-outline-variant grid grid-cols-2 gap-3 border-t pt-4">
                  <Figure label="Members" value={String(s?.active_member_count ?? 0)} />
                  <Figure
                    label="Expected each cycle"
                    value={formatUGX(s?.expected_per_cycle ?? 0)}
                  />
                </dl>

                {/* Only shown once there is something to report a rate on. */}
                {toNumber(s?.expected_total) > 0 ? (
                  <div>
                    <div className="text-label-md font-label-md text-on-surface-variant mb-1.5 flex justify-between normal-case">
                      <span>
                        {formatUGX(s?.collected_total)} collected of{' '}
                        {formatUGX(s?.expected_total)}
                      </span>
                      <span className="tabular text-on-surface font-semibold">
                        {rate.toFixed(0)}%
                      </span>
                    </div>
                    <ProgressBar
                      value={rate}
                      tone={rate >= 80 ? 'tertiary' : rate >= 40 ? 'secondary' : 'error'}
                      label={`${c.name} collection rate`}
                    />
                  </div>
                ) : (
                  <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                    Nothing has been scheduled under this category yet.
                  </p>
                )}

                {canManage ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <SavingsCategoryDialog category={c} trigger="link" />
                    <CategoryStatusControl
                      kind="savings"
                      id={c.id}
                      name={c.name}
                      status={c.status}
                      members={s?.active_member_count ?? 0}
                    />
                    <Link
                      href={`/staff/members?category=${c.id}`}
                      className="bg-surface text-label-md text-on-surface-variant hover:text-primary hover:shadow-card inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 font-semibold shadow-neu-sm transition-shadow"
                    >
                      <Icon name="group" size={15} />
                      Members
                    </Link>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */

async function ShareCategories({ canManage }: { canManage: boolean }) {
  const supabase = await createClient();
  const [{ data: rows, error }, { data: summaries }] = await Promise.all([
    supabase
      .from('share_categories')
      .select('*')
      .order('status')
      .order('sort_order')
      .order('name'),
    supabase.from('share_category_summary').select('*'),
  ]);

  if (error) {
    return (
      <ErrorState
        title="Unable to load share categories"
        description="Please check your connection and try again."
      />
    );
  }

  const categories = (rows ?? []) as ShareCategoryRow[];
  const byId = new Map(
    ((summaries ?? []) as ShareCategorySummaryRow[]).map((s) => [s.share_category_id, s]),
  );

  return (
    <section>
      <Header
        icon="pie_chart"
        title="Share categories"
        description="How many shares a member must buy to qualify, at what price, and by when."
        action={canManage ? <ShareCategoryDialog /> : null}
      />

      {categories.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="pie_chart"
            title="No share categories yet"
            description="Add the tiers members buy shares under. Until then there is no target to measure anyone against."
          />
        </div>
      ) : (
        <ul className="gap-gutter grid grid-cols-1 lg:grid-cols-3">
          {categories.map((c) => {
            const s = byId.get(c.id);
            const tier = categoryTier(c.code);
            const qualifiedRate = percent(s?.qualified_members ?? 0, s?.member_count ?? 0);

            return (
              <li
                key={c.id}
                className={clsx(
                  'bg-surface shadow-card flex flex-col gap-4 rounded-xl p-5',
                  c.status === 'inactive' && 'opacity-70',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="bg-primary-fixed text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                      <Icon name={tier.icon} size={22} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                        {c.name}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant tabular normal-case">
                        {c.code}
                      </p>
                    </div>
                  </div>
                  <Badge tone={CATEGORY_STATUS_TONES[c.status]}>
                    {CATEGORY_STATUS_LABELS[c.status]}
                  </Badge>
                </div>

                <div>
                  <p className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface tabular">
                    <Money value={c.required_amount} />
                  </p>
                  <p className="text-body-md font-body-md text-on-surface-variant">
                    {c.required_shares} {c.required_shares === 1 ? 'share' : 'shares'} at{' '}
                    {formatUGX(c.share_price)} each
                  </p>
                </div>

                <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                  <Icon name="schedule" size={15} className="mr-1 align-text-bottom" />
                  {qualificationWindow(c.qualification_months)}
                </p>

                <dl className="border-outline-variant grid grid-cols-2 gap-3 border-t pt-4">
                  <Figure label="Members" value={String(s?.active_member_count ?? 0)} />
                  <Figure
                    label="Qualified"
                    value={`${s?.qualified_members ?? 0}`}
                    tone={
                      (s?.lapsed_members ?? 0) > 0 ? 'text-error' : undefined
                    }
                    note={
                      (s?.lapsed_members ?? 0) > 0
                        ? `${s?.lapsed_members} past the deadline`
                        : undefined
                    }
                  />
                </dl>

                {(s?.member_count ?? 0) > 0 ? (
                  <ProgressBar
                    value={qualifiedRate}
                    tone={qualifiedRate >= 80 ? 'tertiary' : 'secondary'}
                    label={`${c.name} qualification rate`}
                  />
                ) : (
                  <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                    No member holds this category yet.
                  </p>
                )}

                {canManage ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <ShareCategoryDialog category={c} trigger="link" />
                    <CategoryStatusControl
                      kind="share"
                      id={c.id}
                      name={c.name}
                      status={c.status}
                      members={s?.active_member_count ?? 0}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * The one rule the brief asked to be configurable rather than assumed.
 *
 * It ships off, because the SACCO's own worked example — Gold shares, Diamond
 * Saver — has to be recordable on day one. Stating the current setting here,
 * next to the categories it governs, is more useful than leaving it buried in
 * the settings screen where nobody setting a member's tier would look.
 */
async function MatchingRule() {
  const rules = await getRules();

  return (
    <section
      className={clsx(
        'flex flex-wrap items-start justify-between gap-4 rounded-xl p-5',
        rules.shareMatchesSavings
          ? 'bg-primary-fixed text-on-primary-fixed'
          : 'bg-surface border-outline-variant border',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon
          name={rules.shareMatchesSavings ? 'lock' : 'lock_open'}
          size={22}
          className="mt-0.5 shrink-0"
        />
        <div className="min-w-0">
          <p className="text-button-text font-button-text">
            {rules.shareMatchesSavings
              ? 'Savings category must match share category'
              : 'Share and savings categories are set independently'}
          </p>
          <p className="text-body-md font-body-md mt-0.5">
            {rules.shareMatchesSavings
              ? 'A Gold shareholder may only be given the Gold Saver category. Existing members whose categories already differ are not changed.'
              : 'A member may hold Gold shares and save at the Diamond rate. Turn the rule on in Settings if the SACCO decides the two must always agree.'}
          </p>
        </div>
      </div>
      <Link
        href="/staff/settings?section=categories"
        className={clsx(
          'h-touch-target-min text-button-text font-button-text inline-flex shrink-0 items-center gap-2 rounded-lg px-4 font-semibold',
          rules.shareMatchesSavings
            ? 'bg-white/80 text-on-primary-fixed'
            : 'bg-surface text-primary shadow-neu-sm',
        )}
      >
        <Icon name="settings" size={20} />
        Change this rule
      </Link>
    </section>
  );
}

/* ------------------------------------------------------------------------ */

function Header({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="bg-surface-container-high text-on-surface-variant flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <Icon name={icon} size={20} />
        </span>
        <div className="min-w-0">
          <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
            {title}
          </h2>
          <p className="text-body-md font-body-md text-on-surface-variant mt-0.5">
            {description}
          </p>
        </div>
      </div>
      {action}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone?: string;
  note?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate">{label}</dt>
      <dd
        className={clsx(
          'text-body-lg font-body-lg tabular truncate font-bold',
          tone ?? 'text-on-surface',
        )}
      >
        {value}
      </dd>
      {note ? (
        <p className="text-label-md font-label-md text-error truncate normal-case">{note}</p>
      ) : null}
    </div>
  );
}
