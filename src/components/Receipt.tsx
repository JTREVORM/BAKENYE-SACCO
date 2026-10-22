import Image from 'next/image';
import styles from './Receipt.module.css';
import { Money } from '@/components/ui/primitives';
import { TxnStatusBadge } from '@/components/ui/status';
import { ReceiptActions } from './ReceiptActions';
import { formatDateTime, formatDate, TXN_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import { documentName } from '@/lib/print';
import type { ReceiptPayload } from '@/types/db';

/** Shared staff/member receipt; data, numbering and issuing rules stay upstream.
 * Print and PDF use this same semantic document and the existing browser actions.
 */
export function Receipt({
  payload,
  /**
   * The SACCO's own sign-off, from `system.receipt_footer`.
   *
   * Optional so the design preview can render a receipt without a database. The
   * Runyoro line that used to be hard-coded here was a second motto nobody
   * could edit; whatever the SACCO sets in Settings is printed instead.
   */
  footer,
  /** `system.receipt_show_balance`: print the member's savings balance after the payment. */
  showBalance = true,
}: {
  payload: ReceiptPayload;
  footer?: string | null;
  showBalance?: boolean;
}) {
  const t = payload.transaction;
  const reversed = t.status === 'reversed' || t.status === 'reversal';
  const heading = receiptHeading(t.status, t.type);
  const feeLines = payload.fee_lines ?? [];

  return (
    <div className={styles.receipt} data-receipt>
      <article className={styles.document} aria-label="Official transaction receipt">
        {/* Letterhead */}
        <header className={styles.letterhead}>
          <Image
            src="/brand/bnd-logo.png"
            alt=""
            width={72}
            height={72}
            className={styles.logo}
          />
          <div className="min-w-0">
            <p className={styles.institution}>
              {(payload.sacco_name || 'Bakenye Unity and Development SACCO').toUpperCase()}
            </p>
            <p className={styles.documentTitle}>
              {payload.receipt_title ? payload.receipt_title.toUpperCase() : 'Official transaction receipt'}
            </p>
          </div>
        </header>
        <section className={styles.summary} aria-label="Transaction summary">
          <div className={styles.status}>
            <span className={styles.statusMark} data-status={t.status} aria-hidden="true">{reversed ? '↶' : t.status === 'posted' ? '✓' : '·'}</span>
            <h1>{heading}</h1>
          </div>
          <Money value={t.amount} className={styles.amount} />
          <div className={styles.summaryMeta}>
            <p>{TXN_LABELS[t.type]}</p>
            <p>{formatDate(t.occurred_on)}</p>
          </div>
        </section>

        {reversed ? (
          <div className="bg-error-container text-on-error-container border-outline-variant border-b p-3">
            <p className="text-button-text font-button-text">
              {t.status === 'reversed'
                ? 'This transaction has been reversed'
                : 'This entry reverses an earlier transaction'}
            </p>
            {t.reversal_reason ? (
              <p className="text-body-md font-body-md mt-1">Reason: {t.reversal_reason}</p>
            ) : null}
          </div>
        ) : null}

        <h2 className={styles.sectionTitle}>Transaction details</h2>
        <dl className={styles.details}>
          <Line label="Receipt number" value={payload.receipt_no} mono />
          <Line label="Transaction reference" value={t.reference} mono />
          <Line label="Member" value={t.member_name ?? '—'} />
          <Line label="Member number" value={t.member_no ?? '—'} mono />
          <Line label="Transaction type" value={TXN_LABELS[t.type]} />
          {t.expense_category_label ? <Line label="Expense category" value={t.expense_category_label} /> : null}
          <Line label="Amount" value={formatUGX(t.amount)} emphasis />
          <Line label="Payment method" value={PAYMENT_METHOD_LABELS[t.method]} />
          {payload.external_ref ? (
            <Line label="Provider / bank reference" value={payload.external_ref} mono />
          ) : null}
          {/* Staff only: the payload carries the accounts to finance roles and
              to nobody else, so a member's receipt never names a wallet. */}
          {payload.source_account && payload.destination_account ? (
            <Line
              label="Moved"
              value={`${payload.source_account.name} → ${payload.destination_account.name}`}
            />
          ) : payload.destination_account ? (
            <Line label="Received into" value={payload.destination_account.name} />
          ) : payload.source_account ? (
            <Line label="Paid from" value={payload.source_account.name} />
          ) : null}
          {payload.transfer?.source_reference ? (
            <Line label="Source reference" value={payload.transfer.source_reference} mono />
          ) : null}
          {payload.transfer?.destination_reference ? (
            <Line label="Destination reference" value={payload.transfer.destination_reference} mono />
          ) : null}
          {payload.transfer?.handled_by ? (
            <Line label="Handled by" value={payload.transfer.handled_by} />
          ) : null}
          {payload.payment ? <Line label="Payee" value={payload.payment.payee} /> : null}
          <Line label="Date & time" value={formatDateTime(t.created_at)} />
          <Line label="Value date" value={formatDate(t.occurred_on)} />
          <Line label={feeLines.length > 0 ? 'Received by' : 'Recorded by'} value={t.recorded_by_name ?? 'System'} />
          <Line label="Status" value={<TxnStatusBadge status={t.status} />} />
        </dl>

        {/* What a fee payment paid for, line by line. */}
        {feeLines.length > 0 ? (
          <div className={styles.detailSection}>
            <p className="text-label-md font-label-md text-on-surface-variant mb-2">
              {payload.receipt_title ?? 'Fees paid'}
            </p>
            <div className="font-mono text-[14px]">
              {feeLines.map((l, i) => (
                <div key={`${l.description}-${i}`} className={styles.feeLine}>
                  <span className="text-on-surface">{l.description}</span>
                  <span className="tabular text-on-surface">{formatUGX(l.amount)}</span>
                </div>
              ))}
              <div className="border-on-surface/40 mt-2 flex justify-between gap-4 border-t border-dashed pt-2 font-bold">
                <span>TOTAL</span>
                <span className="tabular">{formatUGX(t.amount)}</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* Share detail */}
        {payload.shares ? (
          <div className={styles.detailSection}>
            <p className="text-label-md font-label-md text-on-secondary-container mb-1">
              Share purchase
            </p>
            <p className="text-body-md font-body-md text-on-surface">
              {payload.shares.quantity} {payload.shares.quantity === 1 ? 'share' : 'shares'} ×{' '}
              {formatUGX(payload.shares.unit_price)} ={' '}
              <strong>{formatUGX(payload.shares.total_value)}</strong>
            </p>
          </div>
        ) : null}

        {/* Loan detail */}
        {payload.loan ? (
          <div className={styles.detailSection}>
            <p className="text-label-md font-label-md text-on-primary-fixed-variant mb-1">
              Loan {payload.loan.loan_no}
            </p>
            <p className="text-body-md font-body-md text-on-primary-fixed">
              Current outstanding balance <strong>{formatUGX(payload.loan.outstanding)}</strong>
              {payload.loan.next_due_on
                ? ` · next payment due ${formatDate(payload.loan.next_due_on)}`
                : ''}
            </p>
          </div>
        ) : null}

        {/* Savings balance after */}
        {showBalance && payload.balance_after != null && !reversed && ['weekly_savings', 'monthly_savings', 'deposit', 'withdrawal'].includes(t.type) ? (
          <div className={styles.balance}>
            <p className={styles.balanceLabel}>
              Savings balance after this transaction
            </p>
            <Money
              value={payload.balance_after}
              className={styles.balanceAmount}
            />
          </div>
        ) : null}

        {t.description ? (
          <div className={styles.detailSection}>
            <p className="text-label-md font-label-md text-on-surface-variant mb-1">Description</p>
            <p className="text-body-md font-body-md text-on-surface">{t.description}</p>
          </div>
        ) : null}

        <footer className={styles.footer}>
          <p className={styles.sectionTitle}>Issued electronically</p>
          <p className="text-label-md font-label-md text-on-surface-variant normal-case">
            This is a computer-generated receipt and is valid without a signature.
          </p>
          {footer ? (
            <p className="text-label-md font-label-md text-on-surface-variant mt-1 normal-case">
              {footer}
            </p>
          ) : null}
          <p className={styles.footerReference}>{payload.receipt_no} · {t.reference}</p>
        </footer>
      </article>

      <ReceiptActions
        reference={t.reference}
        receiptNo={payload.receipt_no}
        amount={formatUGX(t.amount)}
        type={TXN_LABELS[t.type]}
        documentTitle={documentName('Receipt', `${payload.receipt_no} ${t.member_name ?? ''}`)}
      />
    </div>
  );
}

function Line({
  label,
  value,
  mono,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className={styles.line}>
      <dt className={styles.label}>{label}</dt>
      <dd
        className={[
          styles.field,
          mono ? 'tabular select-all font-mono' : '',
          emphasis ? 'text-on-surface font-bold' : 'text-on-surface font-semibold',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}

/** The heading describes the recorded category, never implies approval of a draft. */
function receiptHeading(status: ReceiptPayload['transaction']['status'], type: ReceiptPayload['transaction']['type']) {
  if (status === 'reversed') return 'Transaction reversed';
  if (status === 'reversal') return 'Reversal entry';
  if (status !== 'posted') return 'Transaction record';
  switch (type) {
    case 'loan_disbursement': return 'Loan disbursed';
    case 'withdrawal': return 'Withdrawal completed';
    case 'transfer': return 'Transfer completed';
    case 'payment': return 'Payment issued';
    case 'expense': return 'Expense paid';
    default: return 'Payment successful';
  }
}
