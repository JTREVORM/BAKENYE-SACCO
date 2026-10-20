import Link from 'next/link';
import { clsx } from '@/lib/clsx';
import { Icon, Money } from '@/components/ui/primitives';
import { TxnStatusBadge } from '@/components/ui/status';
import { TXN_ICONS, TXN_LABELS, formatRelativeDay } from '@/lib/format';
import type { TransactionFeedRow } from '@/types/db';

/**
 * The mobile transaction card from the Stitch member screens: a 48px type icon,
 * title over timestamp, right-aligned amount with a status pill underneath.
 *
 * Money in is `tertiary` green with a leading `+`; money out is neutral with a
 * `-`. A reversed row is struck through, because a member who sees a cancelled
 * payment still listed at full value will reasonably think the SACCO has lost
 * track of their money.
 */

const TONE_BY_TYPE: Record<string, string> = {
  weekly_savings: 'bg-primary-container text-on-primary-container',
  monthly_savings: 'bg-primary-container text-on-primary-container',
  deposit: 'bg-primary-container text-on-primary-container',
  share_purchase: 'bg-secondary-container text-on-secondary-container',
  loan_repayment: 'bg-error-container text-error',
  loan_disbursement: 'bg-tertiary-container/20 text-tertiary',
  withdrawal: 'bg-surface-container-high text-on-surface-variant',
  fee: 'bg-surface-container-high text-on-surface-variant',
  penalty: 'bg-error-container text-error',
  income: 'bg-tertiary-container/20 text-tertiary',
  expense: 'bg-error-container text-error',
};

export function TransactionRow({
  txn,
  href,
  showMember = false,
  detailed = false,
}: {
  txn: TransactionFeedRow;
  href?: string;
  /** Staff lists show whose transaction it is. */
  showMember?: boolean;
  /** The home dashboard exposes the complete description and reference. */
  detailed?: boolean;
}) {
  const incoming = txn.direction === 'credit';
  const reversed = txn.status !== 'posted';

  const body = (
    <>
      <div
        className={clsx(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
          TONE_BY_TYPE[txn.type] ?? 'bg-surface-container-high text-on-surface-variant',
        )}
      >
        <Icon name={TXN_ICONS[txn.type]} />
      </div>

      <div className="min-w-0 flex-1">
        <h4 className={clsx('text-body-md font-body-md text-on-surface font-semibold', !detailed && 'truncate')}>
          {txn.expense_category_label ?? TXN_LABELS[txn.type]}
        </h4>
        <p className={clsx('text-label-md font-label-md text-on-surface-variant normal-case', !detailed && 'truncate')}>
          {showMember && txn.member_name ? `${txn.member_name} · ` : ''}
          {formatRelativeDay(txn.created_at)}
        </p>
        {detailed && txn.description ? <p className="mt-1 break-words text-body-md text-on-surface-variant">{txn.description}</p> : null}
        <p className={clsx('text-label-md font-label-md text-on-surface-variant/70 tabular normal-case', detailed ? 'break-all' : 'truncate')}>
          {txn.reference}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <Money
          value={txn.amount}
          className={clsx(
            'text-body-md font-body-md font-bold',
            reversed && 'text-on-surface-variant line-through',
            !reversed && (incoming ? 'text-tertiary' : 'text-on-surface'),
          )}
          sign={false}
        />
        <div className="mt-1">
          <TxnStatusBadge status={txn.status} />
        </div>
      </div>
    </>
  );

  const className =
    'bg-surface border-surface-container shadow-card flex items-center gap-3 rounded-xl border p-3 ' +
    'min-h-touch-target-min';

  if (href) {
    return (
      <Link href={href} className={clsx(className, 'hover:bg-surface-container-low transition-colors')}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}
