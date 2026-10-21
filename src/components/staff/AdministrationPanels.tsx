import Link from 'next/link';
import { KpiCard, Panel, Badge, Icon } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { formatAgo } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import type { AuditLogRow, DashboardMetrics } from '@/types/db';
import type { SecurityOverview } from '@/types/access';

export type SecurityActivityRow = Pick<AuditLogRow, 'id' | 'actor_name' | 'action' | 'summary' | 'created_at' | 'module'>;

/** Shared view for fixture review; the production queries and permissions stay in the route. */
export function AdminSecurityFigures({ s }: { s: SecurityOverview }) {
  return (
    <section aria-label="Accounts and sign-in" className="grid grid-cols-2 gap-gutter lg:grid-cols-4">
      <KpiCard
        icon="manage_accounts"
        label="Active staff accounts"
        value={s.staff_accounts}
        tone="primary"
        href="/staff/users"
        footnote={`${s.member_logins} member ${s.member_logins === 1 ? 'login' : 'logins'}`}
      />
      <KpiCard
        icon="key"
        label="On a temporary password"
        value={s.must_change}
        tone={s.must_change > 0 ? 'warning' : 'neutral'}
        footnote={"Must choose their own at next sign\u2011in"}
      />
      <KpiCard
        icon="login"
        label="Sign-ins, last 24 hours"
        value={s.signins_24h}
        tone="success"
        footnote={`${s.failures_24h} failed ${s.failures_24h === 1 ? 'attempt' : 'attempts'}`}
      />
      <KpiCard
        icon="lock"
        label="Identifiers paused now"
        value={s.paused_now}
        tone={s.paused_now > 0 ? 'danger' : 'neutral'}
        footnote={
          s.members_without_login > 0
            ? `${s.members_without_login} ${s.members_without_login === 1 ? 'member has' : 'members have'} no login`
            : 'Every member has a login'
        }
      />
    </section>
  );
}

export function AdminSaccoFigures({ m }: { m: Pick<DashboardMetrics, 'total_members' | 'members_this_month' | 'total_savings' | 'outstanding_loans' | 'active_loan_count' | 'pending_loans'> }) {
  return (
    <section aria-label="The SACCO" className="grid grid-cols-2 gap-gutter lg:grid-cols-4">
      <KpiCard
        icon="group"
        label="Active members"
        value={m.total_members}
        href="/staff/members"
        footnote={
          m.members_this_month > 0
            ? `${m.members_this_month} joined this month`
            : 'No new members this month'
        }
        trend={m.members_this_month > 0 ? 'up' : 'flat'}
      />
      <KpiCard icon="savings" label="Total savings" value={formatUGX(m.total_savings)} tone="success" href="/staff/savings" />
      <KpiCard icon="payments" label="Loans outstanding" value={formatUGX(m.outstanding_loans)} tone="accent" footnote={`${m.active_loan_count} active`} href="/staff/loans" />
      <KpiCard
        icon="pending_actions"
        label="Loans awaiting a decision"
        value={m.pending_loans}
        tone={m.pending_loans > 0 ? 'warning' : 'neutral'}
        href="/staff/loans"
      />
    </section>
  );
}

export function AdminSecurityActivity({ rows }: { rows: SecurityActivityRow[] }) {
  return (
    <Panel
      title="Security activity"
      icon="policy"
      padded={false}
      action={
        <Link href="/staff/audit?module=Security" className="text-primary text-label-md font-semibold hover:underline">
          Full log
        </Link>
      }
    >
      {rows.length === 0 ? (
        <EmptyState compact icon="policy" title="No sign-in activity yet" description="Sign-ins, failed attempts, resets and role changes appear here." />
      ) : (
        <ul className="divide-outline-variant/70 divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3">
              <span className="bg-surface-container text-on-surface-variant mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <Icon name={r.action.includes('failed') ? 'warning' : r.action.includes('password') || r.action.includes('code') ? 'key' : r.action.includes('role') ? 'admin_panel_settings' : 'login'} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-md text-on-surface break-words">{r.summary}</p>
                <p className="text-label-md text-on-surface-variant font-normal">
                  {r.actor_name} · {formatAgo(r.created_at)}
                </p>
              </div>
              {r.action.includes('failed') ? <Badge tone="warning">Failed</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
