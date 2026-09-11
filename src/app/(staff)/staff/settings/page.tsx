import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can, roleLabel, type Access } from '@/lib/rbac';
import { getEffectivePermissions, getFees, getIncomeCategories, getRoles } from '@/lib/access-queries';
import { FeeManager } from '@/components/fees/FeeManager';
import { getSaccoSettings, getShareSettings, getAllLoanProducts } from '@/lib/queries';
import { getSettingsByCategory, SETTING_CATEGORIES } from '@/lib/settings';
import { Icon, Panel, Badge, PageTitle } from '@/components/ui/primitives';
import { EmptyState, PanelSkeleton, Alert } from '@/components/ui/states';
import { ScrollRow } from '@/components/ui/scroll';
import { OrganisationForm } from '@/components/settings/OrganisationForm';
import { ShareSettingsForm } from '@/components/settings/ShareSettingsForm';
import { SettingsSectionForm } from '@/components/settings/SettingsSectionForm';
import { formatDate } from '@/lib/format';
import { clsx } from '@/lib/clsx';
import type { SettingCategory } from '@/types/db';

export const metadata: Metadata = { title: 'Settings' };

/**
 * The SACCO Configuration Centre.
 *
 * Every operating rule the SACCO decides for itself is edited here, and every
 * value on the screen is read from the database rather than written into the
 * page. The sections come in three kinds:
 *
 *  - **Organisation** and **Shares** have their own forms, because they write
 *    to purpose-built tables with their own audited functions. The share price
 *    in particular is read by `buy_shares()` itself, which is why it stays in
 *    `share_settings` rather than moving into the registry: one value, one
 *    home.
 *  - **Financial, Loans, Members, Savings, Categories, Notifications, Security**
 *    and **System** are rendered from the settings registry. Their fields,
 *    labels, help text, units and bounds are all rows in `system_settings`, so
 *    adding a setting to the database adds a field to this screen and nothing
 *    here changes.
 *  - **Loan Products**, **Users & Roles** and **Audit** are indexes: each one
 *    summarises what is configured and hands off to the screen that owns it.
 *
 * Sections are chosen with `?section=`, so a link to a particular part of the
 * configuration can be shared and bookmarked, and the page is server-rendered
 * whichever section is open.
 *
 * Where a setting genuinely lives outside this application — Supabase Auth's
 * email templates, for instance — the section says so plainly instead of
 * offering a control that would silently do nothing.
 */

type SectionId =
  | 'organisation'
  | 'fees'
  | SettingCategory
  | 'products'
  | 'users'
  | 'audit';

const SECTIONS: { id: SectionId; label: string; icon: string; description: string }[] = [
  {
    id: 'organisation',
    label: 'Organisation',
    icon: 'apartment',
    description: 'The name, contact details and registration of the SACCO itself.',
  },
  {
    id: 'fees',
    label: 'Fees',
    icon: 'receipt',
    description: 'Membership, registration and other fees - what they cost and when they apply.',
  },
  ...SETTING_CATEGORIES.map((c) => ({
    id: c.id as SectionId,
    label: c.label,
    icon: c.icon,
    description: c.description,
  })),
  {
    id: 'products',
    label: 'Loan Products',
    icon: 'inventory_2',
    description: 'The products members may borrow under, and the terms of each.',
  },
  {
    id: 'users',
    label: 'Users & Roles',
    icon: 'manage_accounts',
    description: 'Who may do what.',
  },
  {
    id: 'audit',
    label: 'Change History',
    icon: 'policy',
    description: 'Every configuration change, with who made it and what it was before.',
  },
];

function isSection(value: string | undefined): value is SectionId {
  return !!value && SECTIONS.some((s) => s.id === value);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const user = await requirePermission('settings.view');
  const params = await searchParams;
  const section: SectionId = isSection(params.section) ? params.section : 'organisation';
  const canManage = can(user, 'settings.manage');

  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="settings"
        title="Settings"
        subtitle="How this SACCO is configured. Every value here is read from the database."
        breadcrumb={[{ label: 'Staff', href: '/staff' }, { label: 'Settings' }]}
      />

      {!canManage ? (
        <Alert tone="info" title="You have read-only access to settings">
          You can see how the SACCO is configured. Changing a value needs the settings
          permission, which a Super Admin gives to roles under Roles & Permissions.
        </Alert>
      ) : null}

      <SectionNav current={section} />

      <Panel
        title={current.label}
        icon={current.icon}
        subtitle={current.description}
        key={section}
      >
        <Suspense fallback={<PanelSkeleton height="h-64" />}>
          <SectionBody section={section} canManage={canManage} role={user} />
        </Suspense>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * The section switcher.
 *
 * A horizontal rail of links rather than client-side tabs: each section is a
 * real URL, so it can be linked to, opened in a new tab and returned to with
 * the browser's own Back button. `ScrollRow` gives it the arrow controls and
 * edge fades every other horizontal strip in the product has.
 */
function SectionNav({ current }: { current: SectionId }) {
  return (
    <nav aria-label="Settings sections" className="min-w-0">
      <ScrollRow
        label="Settings sections"
        wrapperClassName="-mx-container-margin-mobile md:mx-0"
        className="no-scrollbar flex gap-2 px-container-margin-mobile pb-1 md:flex-wrap md:px-0"
      >
        {SECTIONS.map((s) => {
          const active = s.id === current;
          return (
            <Link
              key={s.id}
              href={`/staff/settings?section=${s.id}`}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-label-md font-semibold transition-shadow',
                active
                  ? 'bg-primary text-on-primary shadow-card'
                  : 'bg-surface text-on-surface-variant shadow-neu-sm hover:text-primary hover:shadow-card active:shadow-neu-pressed',
              )}
            >
              <Icon name={s.icon} size={16} />
              {s.label}
            </Link>
          );
        })}
      </ScrollRow>
    </nav>
  );
}

/* ------------------------------------------------------------------------ */

async function SectionBody({
  section,
  canManage,
  role,
}: {
  section: SectionId;
  canManage: boolean;
  role: Access;
}) {
  if (section === 'organisation') {
    const settings = await getSaccoSettings();
    return <OrganisationForm settings={settings} canManage={canManage} />;
  }

  if (section === 'fees') {
    const [fees, incomeCategories] = await Promise.all([getFees(), getIncomeCategories()]);
    return (
      <FeeManager
        fees={fees}
        incomeCategories={incomeCategories}
        canManage={can(role, 'fees.manage')}
      />
    );
  }

  if (section === 'products') return <LoanProductsSummary canManage={canManage} />;
  if (section === 'users') return <UsersAndRoles role={role} />;
  if (section === 'audit') return <ConfigurationHistory />;

  // Everything else is a registry category. Financial additionally carries the
  // share price, which lives in its own table for the reason set out above.
  const grouped = await getSettingsByCategory();
  const rows = grouped.get(section) ?? [];
  const meta = SETTING_CATEGORIES.find((c) => c.id === section);

  return (
    <div className="space-y-8">
      {section === 'financial' ? <SharesBlock canManage={canManage} /> : null}

      {rows.length === 0 ? (
        <EmptyState
          compact
          icon="tune"
          title="Nothing to configure here yet"
          description="No settings are registered in this category."
        />
      ) : (
        <SettingsSectionForm
          rows={rows}
          canManage={canManage}
          title={meta?.label ?? 'Settings'}
          description={meta?.description}
        />
      )}

      {section === 'security' ? (
        <Alert tone="warning" title="Some of this is enforced by Supabase Auth">
          Session lifetime, multi-factor options and the email templates for password resets
          are configured in the Supabase project dashboard, not in this application. The
          values above record the SACCO&apos;s policy in one place and are applied wherever
          this application sets a password itself.
        </Alert>
      ) : null}

      {section === 'treasury' ? (
        <Alert tone="info" title="The accounts themselves are set up under Finance">
          The merchant, bank and cash accounts - provider, merchant code, bank, account number,
          opening balance - and the income, expense and payment categories live under{' '}
          <Link href="/staff/finance/accounts" className="font-semibold text-primary underline">
            Finance → Accounts &amp; Setup
          </Link>
          .
        </Alert>
      ) : null}

      {section === 'loans' ? (
        <Alert tone="info" title="These are the rules that apply to every product">
          Interest rates, fees, terms and guarantor counts belong to each loan product.{' '}
          <Link href="/staff/loans/products" className="font-semibold text-primary underline">
            Manage loan products
          </Link>
          .
        </Alert>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

async function SharesBlock({ canManage }: { canManage: boolean }) {
  const shares = await getShareSettings();

  if (!shares) {
    return (
      <EmptyState
        compact
        icon="pie_chart"
        title="Share settings unavailable"
        description="The share price record could not be read, so it cannot be edited here."
      />
    );
  }

  return (
    <div className="border-b border-outline-variant/70 pb-8">
      <ShareSettingsForm settings={shares} canManage={canManage} />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

async function LoanProductsSummary({ canManage }: { canManage: boolean }) {
  const products = await getAllLoanProducts();
  const active = products.filter((p) => p.is_active);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-md text-on-surface-variant">
          {products.length === 0
            ? 'No loan products are configured.'
            : `${active.length} active of ${products.length} product${
                products.length === 1 ? '' : 's'
              }.`}
        </p>
        <Link
          href="/staff/loans/products"
          className="inline-flex h-touch-target-min items-center gap-2 rounded-full bg-ink px-5 text-button-text font-semibold text-white shadow-neu-dark transition-[background-color,box-shadow] hover:bg-ink-soft"
        >
          <Icon name={canManage ? 'tune' : 'view_list'} size={18} />
          {canManage ? 'Manage loan products' : 'View loan products'}
        </Link>
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon="inventory_2"
          title="No loan products yet"
          description="A loan product sets the interest rate, term limits, fees and eligibility rules members borrow under. Create one to open lending."
          action={
            canManage ? (
              <Link
                href="/staff/loans/products/new"
                className="inline-flex h-touch-target-min items-center gap-2 rounded-full bg-ink px-5 text-button-text font-semibold text-white shadow-neu-dark transition-[background-color,box-shadow] hover:bg-ink-soft"
              >
                <Icon name="add" size={18} />
                Create a product
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {products.map((p) => (
            <li
              key={p.id}
              className="rounded-2xl bg-surface-container p-4 shadow-neu-inset-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-body-lg font-semibold text-on-surface">{p.name}</p>
                  <p className="tabular text-label-md font-normal text-on-surface-variant">
                    {p.code}
                    {p.category ? ` · ${p.category}` : ''}
                  </p>
                </div>
                <Badge tone={p.is_active ? 'success' : 'neutral'} dot>
                  {p.is_active ? 'Active' : 'Retired'}
                </Badge>
              </div>
              <p className="tabular mt-3 text-body-md text-on-surface-variant">
                {p.interest_rate}% {p.interest_method} · {p.min_period_months}–
                {p.max_period_months} months · {p.repayment_frequency}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

async function UsersAndRoles({ role }: { role: Access }) {
  const supabase = await createClient();
  const [{ data }, roles, effective] = await Promise.all([
    supabase.from('app_users').select('id, role, is_active'),
    getRoles(),
    getEffectivePermissions(),
  ]);

  const rows = (data ?? []) as { id: string; role: string; is_active: boolean }[];
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.is_active) continue;
    counts.set(r.role, (counts.get(r.role) ?? 0) + 1);
  }
  const staffRoles = roles.filter((r) => r.kind === 'staff');
  const activeStaff = rows.filter(
    (r) => r.is_active && staffRoles.some((sr) => sr.key === r.role),
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-md text-on-surface-variant">
          {activeStaff} active staff {activeStaff === 1 ? 'account' : 'accounts'} across{' '}
          {staffRoles.filter((r) => r.status === 'active').length} roles. Only roles holding the
          settings permission can change the configuration.
        </p>
        <div className="flex flex-wrap gap-2">
          {can(role, 'users.manage') ? (
            <Link
              href="/staff/users"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-label-md font-semibold text-primary shadow-neu-sm transition-shadow hover:shadow-card active:shadow-neu-pressed"
            >
              Manage users
              <Icon name="chevron_right" size={15} />
            </Link>
          ) : null}
          {can(role, 'roles.manage') ? (
            <Link
              href="/staff/roles"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-label-md font-semibold text-primary shadow-neu-sm transition-shadow hover:shadow-card active:shadow-neu-pressed"
            >
              Roles &amp; permissions
              <Icon name="chevron_right" size={15} />
            </Link>
          ) : null}
        </div>
      </div>

      <ul className="space-y-2.5">
        {staffRoles.map((r) => {
          const manages = effective.get(r.key)?.has('settings.manage') ?? false;
          return (
            <li
              key={r.key}
              className={clsx(
                'flex items-start gap-3 rounded-2xl bg-surface-container p-3.5 shadow-neu-inset-sm',
                r.status !== 'active' && 'opacity-60',
              )}
            >
              <span
                className={clsx(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  manages ? 'bg-primary/10 text-primary' : 'bg-surface-container-high text-on-surface-variant',
                )}
              >
                <Icon name={manages ? 'shield_person' : 'badge'} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body-md font-semibold text-on-surface">{r.name}</span>
                  <Badge tone={counts.get(r.key) ? 'info' : 'neutral'}>{counts.get(r.key) ?? 0}</Badge>
                  {manages ? <Badge tone="warning">Can change settings</Badge> : null}
                  {r.status !== 'active' ? <Badge tone="neutral">Retired</Badge> : null}
                </div>
                {r.description ? (
                  <p className="mt-0.5 text-label-md font-normal text-on-surface-variant">
                    {r.description}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * Configuration changes, most recent first.
 *
 * The same audit log the rest of the system writes to, filtered to the module
 * settings changes are recorded under. Every row carries who, what, when and —
 * in the full log — the value before and after.
 */
async function ConfigurationHistory() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('audit_logs')
    .select('id, actor_name, actor_role, action, summary, reason, created_at')
    .eq('module', 'Settings')
    .order('created_at', { ascending: false })
    .limit(30);

  const rows = (data ?? []) as {
    id: number;
    actor_name: string;
    actor_role: string | null;
    action: string;
    summary: string;
    reason: string | null;
    created_at: string;
  }[];

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="policy"
        title="No configuration changes recorded yet"
        description="Every change to a setting, a share price or a loan product is logged here with the value before and after it."
      />
    );
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.id} className="rounded-2xl bg-surface-container p-3.5 shadow-neu-inset-sm">
            <p className="text-body-md text-on-surface">{row.summary}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label-md font-normal text-on-surface-variant">
              <span className="font-semibold">{row.actor_name}</span>
              {row.actor_role ? (
                <span>· {roleLabel(row.actor_role)}</span>
              ) : null}
              <span>· {formatDate(row.created_at)}</span>
            </p>
            {row.reason ? (
              <p className="mt-1.5 text-label-md font-normal italic text-on-surface-variant">
                Reason: {row.reason}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      <Link
        href="/staff/audit?module=Settings"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-label-md font-semibold text-primary shadow-neu-sm transition-shadow hover:shadow-card active:shadow-neu-pressed"
      >
        Open the full audit log
        <Icon name="chevron_right" size={15} />
      </Link>
    </div>
  );
}
