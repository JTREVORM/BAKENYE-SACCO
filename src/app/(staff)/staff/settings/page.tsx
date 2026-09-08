import { Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can, ROLE_DESCRIPTIONS, ROLE_LABELS, STAFF_ROLES } from '@/lib/rbac';
import {
  Icon,
  Panel,
  Badge,
  DetailRow,
  PageTitle,
  DataTable,
  Money,
} from '@/components/ui/primitives';
import { EmptyState, PanelSkeleton, Alert } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import type { LoanProductRow } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings — how this SACCO is configured.
 *
 * This screen is deliberately a *reflection* of real configuration rather than
 * a wall of toggles. Every value shown is read from the database or from the
 * application's own constants, and every "change this" route points at the
 * screen that already owns that change and already enforces its permission.
 *
 * Where a setting genuinely lives outside this application — Supabase Auth's
 * email templates, for instance — the card says so plainly instead of offering
 * a control that would silently do nothing.
 */
export default async function SettingsPage() {
  const user = await requirePermission('settings.view');

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="settings"
        title="Settings"
        subtitle="Organisation details, roles, and the rules the SACCO operates by."
        breadcrumb={[{ label: 'Staff', href: '/staff' }, { label: 'Settings' }]}
      />

      <SettingsNav />

      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
        <Organisation />

        <Suspense fallback={<PanelSkeleton height="h-56" />}>
          <UsersAndRoles canManage={can(user.role, 'users.manage')} />
        </Suspense>

        <Authentication />

        <Notifications />

        <Suspense fallback={<PanelSkeleton height="h-56" />}>
          <SharesSettings />
        </Suspense>

        <Suspense fallback={<PanelSkeleton height="h-56" />}>
          <SavingsSettings />
        </Suspense>
      </div>

      <Suspense fallback={<PanelSkeleton height="h-56" />}>
        <LoanProducts />
      </Suspense>

      <SystemPreferences />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

const SECTIONS = [
  { id: 'organisation', label: 'Organisation', icon: 'apartment' },
  { id: 'users', label: 'Users & Roles', icon: 'manage_accounts' },
  { id: 'authentication', label: 'Authentication', icon: 'security' },
  { id: 'notifications', label: 'Notifications & Email', icon: 'mail' },
  { id: 'shares', label: 'Shares', icon: 'pie_chart' },
  { id: 'savings', label: 'Savings', icon: 'account_balance_wallet' },
  { id: 'loans', label: 'Loans', icon: 'payments' },
  { id: 'system', label: 'System', icon: 'tune' },
] as const;

/** In-page jump list. On a long settings screen this is the whole navigation. */
function SettingsNav() {
  return (
    <nav aria-label="Settings sections" className="min-w-0">
      <ScrollRow
        label="Settings sections"
        wrapperClassName="-mx-container-margin-mobile md:mx-0"
        className="no-scrollbar flex gap-2 px-container-margin-mobile pb-1 md:flex-wrap md:px-0"
      >
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-surface px-4 py-2 text-label-md font-semibold text-on-surface-variant shadow-neu-sm transition-shadow hover:text-primary hover:shadow-card active:shadow-neu-pressed"
        >
          <Icon name={s.icon} size={16} />
          {s.label}
        </a>
      ))}
    </ScrollRow>
    </nav>
  );
}

/* ------------------------------------------------------------------------ */

function Organisation() {
  return (
    <Panel title="Organisation" icon="apartment" className="scroll-mt-24" id="organisation">
      <div className="mb-5 flex items-center gap-4 rounded-2xl bg-surface-container p-4 shadow-neu-inset-sm">
        <Image
          src="/brand/bnd-logo.png"
          alt=""
          width={56}
          height={56}
          className="h-14 w-14 shrink-0 object-contain"
        />
        <div className="min-w-0">
          <p className="text-title-md text-on-surface">Bakenye Unity and Development SACCO</p>
          <p className="mt-0.5 text-label-md font-normal italic text-on-surface-variant">
            Together We Grow, Prosper and Build
          </p>
        </div>
      </div>

      <dl>
        <DetailRow label="Legal name" value="Bakenye Unity and Development SACCO" />
        <DetailRow label="Short name" value="BUD-SACCO" />
        <DetailRow label="Currency" value="Ugandan Shilling (UGX)" />
        <DetailRow label="Contact email" value="info@bakenyesacco.org" />
        <DetailRow
          label="Document prefix"
          value={<span className="tabular">BND-</span>}
        />
      </dl>

      <p className="mt-4 text-label-md font-normal leading-relaxed text-on-surface-variant">
        The organisation name appears on every receipt, statement and report letterhead. Document
        reference prefixes are part of the financial record and are never changed once references
        have been issued.
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */

async function UsersAndRoles({ canManage }: { canManage: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('app_users')
    .select('id, role, is_active')
    .neq('role', 'member');

  const rows = (data ?? []) as { id: string; role: string; is_active: boolean }[];
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.is_active) continue;
    counts.set(r.role, (counts.get(r.role) ?? 0) + 1);
  }

  return (
    <Panel
      title="Users & Roles"
      icon="manage_accounts"
      subtitle={`${rows.filter((r) => r.is_active).length} active staff accounts`}
      className="scroll-mt-24"
      id="users"
      action={
        canManage ? (
          <Link
            href="/staff/users"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-label-md font-semibold text-primary shadow-neu-sm transition-shadow hover:shadow-card active:shadow-neu-pressed"
          >
            Manage
            <Icon name="chevron_right" size={15} />
          </Link>
        ) : null
      }
    >
      <ul className="space-y-2.5">
        {STAFF_ROLES.map((role) => (
          <li
            key={role}
            className="flex items-start gap-3 rounded-2xl bg-surface-container p-3 shadow-neu-inset-sm"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon name="badge" size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-body-md font-semibold text-on-surface">
                  {ROLE_LABELS[role]}
                </span>
                <Badge tone={counts.get(role) ? 'info' : 'neutral'}>
                  {counts.get(role) ?? 0}
                </Badge>
              </div>
              <p className="mt-0.5 text-label-md font-normal text-on-surface-variant">
                {ROLE_DESCRIPTIONS[role]}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */

function Authentication() {
  return (
    <Panel title="Authentication" icon="security" className="scroll-mt-24" id="authentication">
      <dl>
        <DetailRow label="Sign-in identifier" value="Email address or member number" />
        <DetailRow label="Password reset" value="Self-service email link" />
        <DetailRow label="Session storage" value="Secure, http-only cookies" />
        <DetailRow label="Access control" value="Role permissions + database row-level security" />
      </dl>

      <Alert tone="info" className="mt-4">
        Authentication is handled by Supabase Auth. Password policy, session lifetime and multi-factor
        options are configured in the Supabase project dashboard, not in this application.
      </Alert>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */

function Notifications() {
  return (
    <Panel
      title="Notifications & Email"
      icon="mail"
      className="scroll-mt-24"
      id="notifications"
      action={
        <Link
          href="/staff/notifications"
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-label-md font-semibold text-primary shadow-neu-sm transition-shadow hover:shadow-card active:shadow-neu-pressed"
        >
          Inbox
          <Icon name="chevron_right" size={15} />
        </Link>
      }
    >
      <dl>
        <DetailRow label="In-app notifications" value={<Badge tone="success" dot>Active</Badge>} />
        <DetailRow
          label="Collection day reminders"
          value={<Badge tone="success" dot>Active</Badge>}
        />
        <DetailRow
          label="Outbound email"
          value={<Badge tone="neutral" dot>Supabase Auth only</Badge>}
        />
      </dl>

      <Alert tone="warning" className="mt-4" title="Email templates live outside this codebase">
        Password-reset and account-verification emails are sent by Supabase Auth. Their wording and
        sender name are edited in the Supabase dashboard under Authentication → Email Templates.
      </Alert>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */

async function SharesSettings() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('share_settings')
    .select('unit_price, min_shares_on_join, updated_at')
    .single();

  return (
    <Panel title="Shares" icon="pie_chart" className="scroll-mt-24" id="shares">
      {data ? (
        <dl>
          <DetailRow label="Share unit price" value={<Money value={data.unit_price} />} />
          <DetailRow
            label="Minimum shares on joining"
            value={<span className="tabular">{data.min_shares_on_join}</span>}
          />
          <DetailRow
            label="Minimum buy-in"
            value={<Money value={Number(data.unit_price) * Number(data.min_shares_on_join)} />}
          />
          <DetailRow label="Last updated" value={formatDate(data.updated_at)} />
        </dl>
      ) : (
        <EmptyState
          compact
          icon="pie_chart"
          title="Share settings unavailable"
          description="The share price record could not be read."
        />
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */

async function SavingsSettings() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('sacco_groups')
    .select('saving_frequency, saving_day, status')
    .eq('status', 'active');

  const groups = (data ?? []) as { saving_frequency: string; saving_day: number }[];
  const byFrequency = new Map<string, number>();
  for (const g of groups) {
    byFrequency.set(g.saving_frequency, (byFrequency.get(g.saving_frequency) ?? 0) + 1);
  }

  return (
    <Panel title="Savings" icon="account_balance_wallet" className="scroll-mt-24" id="savings">
      <dl>
        <DetailRow label="Collection model" value="Group-based, per configured saving day" />
        <DetailRow label="Recording" value="Manual entry by staff, with a unique reference" />
        <DetailRow label="Active groups" value={<span className="tabular">{groups.length}</span>} />
        <DetailRow
          label="Frequencies in use"
          value={
            byFrequency.size === 0 ? (
              '—'
            ) : (
              <span className="flex flex-wrap justify-end gap-1.5">
                {[...byFrequency.entries()].map(([f, n]) => (
                  <Badge key={f} tone="info">
                    {f} · {n}
                  </Badge>
                ))}
              </span>
            )
          }
        />
      </dl>

      <p className="mt-4 text-label-md font-normal leading-relaxed text-on-surface-variant">
        Each group sets its own saving day and target amounts. Change them on the group&apos;s own
        profile — there is no system-wide saving day.
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */

async function LoanProducts() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('loan_products')
    .select('*')
    .order('name', { ascending: true });

  const rows = (data ?? []) as LoanProductRow[];

  return (
    <Panel
      title="Loan Products"
      icon="payments"
      subtitle={`${rows.filter((r) => r.is_active).length} active of ${rows.length}`}
      className="scroll-mt-24"
      id="loans"
      padded={false}
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon="payments"
          title="No loan products configured"
          description="Loan products define the interest rate, term limits and guarantor requirements members can borrow under."
        />
      ) : (
        <>
          {/* Mobile: cards. */}
          <ul className="divide-y divide-outline-variant/70 md:hidden">
            {rows.map((p) => (
              <li key={p.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-body-md font-semibold text-on-surface">{p.name}</p>
                    <p className="tabular text-label-md font-normal text-on-surface-variant">
                      {p.code}
                    </p>
                  </div>
                  <Badge tone={p.is_active ? 'success' : 'neutral'} dot>
                    {p.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                  <SmallFact label="Interest" value={`${p.interest_rate}% ${p.interest_method}`} />
                  <SmallFact label="Term" value={`${p.min_period_months}–${p.max_period_months} mo`} />
                  <SmallFact label="Amount" value={`${compact(p.min_amount)}–${compact(p.max_amount)}`} />
                  <SmallFact label="Guarantors" value={String(p.min_guarantors)} />
                </dl>
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
            <DataTable
              className="rounded-none border-0 shadow-none"
              head={
                <>
                  <th>Product</th>
                  <th className="text-right">Interest</th>
                  <th>Method</th>
                  <th className="text-right">Amount range</th>
                  <th className="text-right">Term</th>
                  <th className="text-right">Fee</th>
                  <th className="text-center">Guarantors</th>
                  <th>Status</th>
                </>
              }
            >
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="font-semibold text-on-surface">{p.name}</div>
                    <div className="tabular text-label-md font-normal text-on-surface-variant">
                      {p.code}
                    </div>
                  </td>
                  <td className="tabular text-right font-semibold">{p.interest_rate}%</td>
                  <td className="capitalize text-on-surface-variant">{p.interest_method}</td>
                  <td className="tabular whitespace-nowrap text-right">
                    {compact(p.min_amount)} – {compact(p.max_amount)}
                  </td>
                  <td className="tabular whitespace-nowrap text-right">
                    {p.min_period_months}–{p.max_period_months} mo
                  </td>
                  <td className="tabular text-right">{p.processing_fee_pct}%</td>
                  <td className="tabular text-center">{p.min_guarantors}</td>
                  <td>
                    <Badge tone={p.is_active ? 'success' : 'neutral'} dot>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      )}
    </Panel>
  );
}

function SmallFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-normal text-on-surface-variant">{label}</dt>
      <dd className="tabular truncate text-body-md font-semibold text-on-surface">{value}</dd>
    </div>
  );
}

function compact(value: number): string {
  const n = Number(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/* ------------------------------------------------------------------------ */

function SystemPreferences() {
  const facts = [
    { icon: 'paid', label: 'Currency', value: 'UGX — Ugandan Shilling, whole shillings' },
    { icon: 'calendar_today', label: 'Date format', value: 'Day Month Year (7 Sep 2026)' },
    { icon: 'schedule', label: 'Week starts', value: 'Monday (ISO weekday 1–7)' },
    { icon: 'receipt_long', label: 'Ledger', value: 'Append-only. Corrections are reversals.' },
    { icon: 'policy', label: 'Audit trail', value: 'Every financial write is logged' },
    { icon: 'print', label: 'Documents', value: 'Print to PDF with letterhead' },
  ];

  return (
    <Panel title="System Preferences" icon="tune" className="scroll-mt-24" id="system">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map((f) => (
          <div
            key={f.label}
            className="flex items-start gap-3 rounded-2xl bg-surface-container p-3.5 shadow-neu-inset-sm"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant">
              <Icon name={f.icon} size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-label-md font-semibold text-on-surface-variant">{f.label}</p>
              <p className="text-body-md text-on-surface">{f.value}</p>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
