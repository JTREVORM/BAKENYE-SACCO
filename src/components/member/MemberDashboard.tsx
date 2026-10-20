import Link from 'next/link';
import { MemberShell } from '@/components/layout/MemberShell';
import { MemberHero } from '@/components/layout/Hero';
import { Avatar, DataTable, Icon, Money } from '@/components/ui/primitives';
import { MemberStatusBadge, TxnStatusBadge } from '@/components/ui/status';
import { EmptyState, BalanceCardSkeleton } from '@/components/ui/states';
import { TransactionRow } from './TransactionRow';
import { daysUntil, formatDate, formatRelativeDay, TXN_LABELS } from '@/lib/format';
import { clsx } from '@/lib/clsx';
import type { MemberFinancialsRow, MemberStatus, TransactionFeedRow } from '@/types/db';
import styles from './MemberDashboard.module.css';

/** Presentation shared by the authenticated home page and development QA.
 * Data access, membership checks and action permissions stay in the page. */
export function MemberDashboardFrame({ children, fullName, memberNo, status, unreadCount = 0 }: {
  children: React.ReactNode;
  fullName: string;
  memberNo: string | null;
  status: MemberStatus | null;
  unreadCount?: number;
}) {
  return <div className={styles.dashboard}>
    <MemberShell dashboard unreadCount={unreadCount} desktopHeader={
      <header data-app-header className={styles.accountHeader}>
        <div><p className={styles.eyebrow}>Member portal</p><p className={styles.accountTitle}>My account</p></div>
        <div className="flex min-w-0 items-center gap-5">
          <Link href="/notifications" aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'} className={styles.notification}>
            <Icon name="notifications" filled={false} />
            {unreadCount > 0 ? <span>{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
          </Link>
          <Link href="/profile" className={styles.profile} aria-label="My profile">
            <Avatar name={fullName} size={46} />
            <span className="min-w-0"><span className="block break-words font-semibold">{fullName}</span><span className="mt-0.5 block text-label-md text-on-surface-variant">My profile</span></span>
            <Icon name="chevron_right" size={18} />
          </Link>
        </div>
      </header>
    }>
      <div data-member-dashboard className={styles.content}>
        <MemberHero fullName={fullName} memberNo={memberNo} status={status ? <MemberStatusBadge status={status} /> : null} description="Your savings, shares and loans, all in one place." />
        {children}
      </div>
    </MemberShell>
  </div>;
}

export function MemberBalances({ member: m }: { member: MemberFinancialsRow }) {
  const dueIn = daysUntil(m.next_due_on);
  const overdue = Number(m.overdue_amount) > 0;
  return <>
    <section aria-label="Your account balances" className={styles.balanceGrid}>
      <Link href="/savings" data-member-balance className={clsx(styles.balanceCard, styles.savings)}>
        <div className={styles.cardHeading}><span className={styles.icon}><Icon name="account_balance_wallet" /></span><h2>Total Savings</h2><Icon name="chevron_right" size={20} /></div>
        <Money value={m.savings_balance} className={styles.amount} />
        <span className={styles.cardFootnote}>View details <Icon name="arrow_forward" size={16} /></span>
      </Link>
      <Link href="/shares" data-member-balance className={styles.balanceCard}>
        <div className={styles.cardHeading}><span className={clsx(styles.icon, styles.gold)}><Icon name="pie_chart" /></span><h2>Shares</h2><Icon name="chevron_right" size={20} /></div>
        <Money value={m.share_value} className={styles.amount} />
        <span className={styles.cardFootnote}>{m.share_count} {m.share_count === 1 ? 'share' : 'shares'}</span>
      </Link>
      <Link href="/loans" data-member-balance className={styles.balanceCard}>
        <div className={styles.cardHeading}><span className={clsx(styles.icon, styles.blue)}><Icon name="payments" /></span><h2>Loan Balance</h2><Icon name="chevron_right" size={20} /></div>
        <Money value={m.loan_balance} className={clsx(styles.amount, Number(m.loan_balance) > 0 && styles.loanAmount)} />
        <span className={styles.cardFootnote}>{m.active_loans === 0 ? 'No active loan' : `${m.active_loans} active ${m.active_loans === 1 ? 'loan' : 'loans'}`}</span>
      </Link>
    </section>
    <div className={styles.updates}>
      <section className={styles.updateCard}>
        <Link href="/savings" className={styles.updateLink}>
          <div className="min-w-0"><h2><Icon name="savings" size={20} />Saved this month</h2><p>{Number(m.savings_this_month) > 0 ? 'Save any amount, any time — there is no target.' : 'Nothing saved yet this month. Nothing is owed.'}</p></div>
          <Money value={m.savings_this_month} className={styles.updateAmount} />
          <Icon name="chevron_right" size={18} />
        </Link>
      </section>
      {m.next_due_on ? <section data-member-payment className={clsx(styles.updateCard, overdue && styles.overdue)}>
        <div className={styles.updateLink}>
          <div className="min-w-0"><h2><Icon name={overdue ? 'warning' : 'calendar_today'} size={20} />{overdue ? 'Payment Overdue' : 'Next Payment'}</h2><p>{overdue ? 'Was due ' : 'Due '}{formatDate(m.next_due_on)}{!overdue && dueIn !== null && dueIn >= 0 ? dueIn === 0 ? ' · today' : ` · in ${dueIn} day${dueIn === 1 ? '' : 's'}` : ''}</p></div>
          <Money value={overdue ? m.overdue_amount : m.next_due_amount} className={styles.updateAmount} />
        </div>
      </section> : null}
    </div>
  </>;
}

export function MemberBalancesFallback() {
  return <div className={styles.balanceGrid}><BalanceCardSkeleton /><BalanceCardSkeleton /><BalanceCardSkeleton /></div>;
}

const ACTIONS = [
  { href: '/savings/deposit', icon: 'savings', label: 'Save Money' },
  { href: '/shares/buy', icon: 'pie_chart', label: 'Buy Shares' },
  { href: '/loans/apply', icon: 'request_quote', label: 'Apply Loan' },
  { href: '/loans/repay', icon: 'payments', label: 'Repay Loan' },
  { href: '/statements', icon: 'receipt_long', label: 'Statement' },
  { href: '/notifications', icon: 'notifications_active', label: 'Alerts' },
] as const;

export function MemberQuickActions({ canApply }: { canApply: boolean }) {
  return <section aria-labelledby="member-actions-title" className={styles.panel}>
    <div className={styles.sectionHeader}><h2 id="member-actions-title"><Icon name="bolt" size={21} />Quick Actions</h2></div>
    <div className={styles.actions}>
      {ACTIONS.filter(a => canApply || a.href !== '/loans/apply').map(a => <Link key={a.href} href={a.href} className={styles.action}><span><Icon name={a.icon} /></span><span>{a.label}</span><Icon name="chevron_right" size={16} /></Link>)}
    </div>
  </section>;
}

export function MemberTransactionSection({ children }: { children: React.ReactNode }) {
  return <section aria-labelledby="member-transactions-title" className={styles.panel}>
    <div className={styles.sectionHeader}><h2 id="member-transactions-title"><Icon name="receipt_long" size={21} />Recent Transactions</h2><Link href="/transactions">View All <Icon name="arrow_forward" size={16} /></Link></div>
    {children}
  </section>;
}

export function MemberTransactions({ rows }: { rows: TransactionFeedRow[] }) {
  if (rows.length === 0) return <EmptyState icon="receipt_long" title="No transactions yet" description="Your savings, share purchases and loan payments will appear here." />;
  return <>
    <div className={styles.mobileTransactions}>{rows.map(t => <TransactionRow key={t.id} txn={t} detailed href={`/transactions/${t.id}`} />)}</div>
    <div className={styles.desktopTransactions}>
      <DataTable scrollLabel="Your recent transactions" scrollHint="Scroll horizontally to view the full amount and status. You can also use the arrow keys." head={<><th>Date</th><th>Transaction / Reference</th><th>Description</th><th className="text-right">Amount</th><th>Status</th></>}>
        {rows.map(t => <tr key={t.id}>
          <td className="whitespace-nowrap">{formatRelativeDay(t.created_at)}</td>
          <td><Link href={`/transactions/${t.id}`} className={styles.transactionLink}><span>{t.expense_category_label ?? TXN_LABELS[t.type]}</span><span>{t.reference}</span></Link></td>
          <td className={styles.description}>{t.description ?? '—'}</td>
          <td className="whitespace-nowrap text-right"><Money value={t.amount} sign={false} className={clsx('font-semibold', t.status !== 'posted' && 'text-on-surface-variant line-through', t.status === 'posted' && (t.direction === 'credit' ? 'text-tertiary' : 'text-on-surface'))} /></td>
          <td><TxnStatusBadge status={t.status} /></td>
        </tr>)}
      </DataTable>
    </div>
  </>;
}

export function PendingMembershipNotice({ children }: { children: React.ReactNode }) {
  return <section className={styles.pending}><Icon name="pending_actions" size={24} /><div><h2>Your membership is pending</h2><p>{children}</p></div></section>;
}
