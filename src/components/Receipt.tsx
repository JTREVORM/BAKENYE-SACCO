import Image from 'next/image';
import { Icon, Money } from '@/components/ui/primitives';
import { TxnStatusBadge } from '@/components/ui/status';
import { ReceiptActions } from './ReceiptActions';
import { formatDateTime, formatDate, TXN_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import { documentName } from '@/lib/print';
import type { ReceiptPayload } from '@/types/db';

/**
 * Transaction receipt.
 *
 * Built in the language of `transaction_receipt_mobile/code.html` — the green
 * success mark, the ticket-style body, the mono-spaced reference that
 * DESIGN.md calls for — and extended with everything rule 17 requires: SACCO
 * name, crest, receipt number, member and member ID, type, amount, method,
 * timestamp and who recorded it.
 *
 * The print stylesheet in `globals.css` strips the app chrome, so "Print" and
 * "Save as PDF" both produce a clean A4 document from this same markup. That
 * is deliberately cheaper than shipping a PDF library to a low-end phone.
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
}: {
  payload: ReceiptPayload;
  footer?: string | null;
}) {
  const t = payload.transaction;
  const reversed = t.status !== 'posted';

  return (
    <div className="mx-auto w-full max-w-md">
      {/* Status header */}
      <div className="flex flex-col items-center py-6 text-center">
        <div
          className={`mb-4 flex h-20 w-20 items-center justify-center rounded-full ${
            reversed ? 'bg-error-container' : 'bg-tertiary-container'
          }`}
        >
          <Icon
            name={reversed ? 'undo' : 'check_circle'}
            size={44}
            className={reversed ? 'text-error' : 'text-white'}
          />
        </div>
        <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
          {t.status === 'posted'
            ? 'Payment Successful'
            : t.status === 'reversed'
              ? 'Transaction Reversed'
              : 'Reversal Entry'}
        </h1>
        <Money
          value={t.amount}
          className="text-display-currency font-display-currency text-primary mt-2 block"
        />
        <p className="text-body-md font-body-md text-on-surface-variant mt-1">
          {TXN_LABELS[t.type]}
        </p>
      </div>

      {/* Ticket */}
      <div className="bg-surface print-block overflow-hidden rounded-xl shadow-sm">
        {/* Letterhead */}
        <div className="border-outline-variant flex items-center gap-3 border-b p-4">
          <Image
            src="/brand/bnd-logo.png"
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <p className="text-button-text font-button-text text-primary leading-tight">
              BAKENYE UNITY AND DEVELOPMENT SACCO
            </p>
            <p className="text-label-md font-label-md text-on-surface-variant normal-case">
              Official transaction receipt
            </p>
          </div>
        </div>

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

        <dl className="divide-outline-variant/70 divide-y px-4">
          <Line label="Receipt number" value={payload.receipt_no} mono />
          <Line label="Transaction reference" value={t.reference} mono />
          <Line label="Member" value={t.member_name ?? '—'} />
          <Line label="Member ID" value={t.member_no ?? '—'} mono />
          <Line label="Transaction type" value={TXN_LABELS[t.type]} />
          <Line label="Amount" value={formatUGX(t.amount)} emphasis />
          <Line label="Payment method" value={PAYMENT_METHOD_LABELS[t.method]} />
          <Line label="Date & time" value={formatDateTime(t.created_at)} />
          <Line label="Value date" value={formatDate(t.occurred_on)} />
          <Line label="Recorded by" value={t.recorded_by_name ?? 'System'} />
          <Line label="Status" value={<TxnStatusBadge status={t.status} />} />
        </dl>

        {/* Share detail */}
        {payload.shares ? (
          <div className="bg-secondary-container/30 border-outline-variant border-t px-4 py-3">
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
          <div className="bg-primary-fixed border-outline-variant border-t px-4 py-3">
            <p className="text-label-md font-label-md text-on-primary-fixed-variant mb-1">
              Loan {payload.loan.loan_no}
            </p>
            <p className="text-body-md font-body-md text-on-primary-fixed">
              Outstanding balance <strong>{formatUGX(payload.loan.outstanding)}</strong>
              {payload.loan.next_due_on
                ? ` · next payment due ${formatDate(payload.loan.next_due_on)}`
                : ' · fully repaid'}
            </p>
          </div>
        ) : null}

        {/* Savings balance after */}
        {['weekly_savings', 'monthly_savings', 'deposit', 'withdrawal'].includes(t.type) ? (
          <div className="bg-surface-container-low border-outline-variant border-t px-4 py-3">
            <p className="text-label-md font-label-md text-on-surface-variant mb-1">
              Savings balance after this transaction
            </p>
            <Money
              value={payload.balance_after}
              className="text-button-text font-button-text text-on-surface"
            />
          </div>
        ) : null}

        {t.description ? (
          <div className="border-outline-variant border-t px-4 py-3">
            <p className="text-label-md font-label-md text-on-surface-variant mb-1">Description</p>
            <p className="text-body-md font-body-md text-on-surface">{t.description}</p>
          </div>
        ) : null}

        <div className="border-outline-variant border-t px-4 py-4 text-center">
          <p className="text-label-md font-label-md text-on-surface-variant normal-case">
            This is a computer-generated receipt and is valid without a signature.
          </p>
          {footer ? (
            <p className="text-label-md font-label-md text-on-surface-variant/70 mt-1 normal-case">
              {footer}
            </p>
          ) : null}
        </div>
      </div>

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
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-body-md font-body-md text-on-surface-variant shrink-0">{label}</dt>
      <dd
        className={[
          'text-body-md font-body-md min-w-0 break-words text-right',
          mono ? 'tabular select-all font-mono' : '',
          emphasis ? 'text-on-surface font-bold' : 'text-on-surface font-semibold',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}
