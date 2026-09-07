import Link from 'next/link';
import { Icon, Money } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { CopyableReference } from './CopyableReference';
import type { IconName } from '@/lib/icons';

/**
 * Member payment guide.
 *
 * A deliberate design decision, and worth stating plainly: members do **not**
 * write to the ledger. Only a cashier, manager or super admin can post a
 * transaction, because a self-service "I paid UGX 50,000" button — with no
 * payment gateway wired up to verify it — would let anyone inflate their own
 * savings balance. That is not a UI problem we can style around; it is why
 * `savings.record`, `shares.sell` and `cash.movement` are staff-only
 * permissions in `rbac.ts` and why the matching RPCs call `assert_role()`.
 *
 * So the member side of "Save Money", "Buy Shares" and "Repay Loan" does the
 * genuinely useful thing instead: it tells them exactly how to pay, how much,
 * and gives them the payment reference to quote so the cashier can match the
 * money to their account. The moment a mobile-money gateway is connected, this
 * screen is where the "Pay now" button goes.
 */
export function PaymentGuide({
  title,
  subtitle,
  icon,
  memberNo,
  memberName,
  suggestedAmount,
  amountLabel,
  reference,
  details,
  footnote,
  backHref,
}: {
  title: string;
  subtitle: string;
  icon: IconName;
  memberNo: string;
  memberName: string;
  suggestedAmount?: number | null;
  amountLabel?: string;
  /** What the member quotes when paying, so the cashier can match it. */
  reference: string;
  details?: { label: string; value: React.ReactNode }[];
  footnote?: string;
  backHref: string;
}) {
  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="text-center">
        <div className="bg-primary-fixed text-primary mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
          <Icon name={icon} size={32} />
        </div>
        <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">{title}</h1>
        <p className="text-body-md font-body-md text-on-surface-variant mt-2">{subtitle}</p>
      </div>

      {suggestedAmount != null && suggestedAmount > 0 ? (
        <div className="bg-primary text-on-primary relative overflow-hidden rounded-xl p-5 text-center">
          <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-xl" />
          <p className="text-label-md font-label-md text-primary-fixed-dim relative z-10">
            {amountLabel ?? 'Amount to pay'}
          </p>
          <Money
            value={suggestedAmount}
            className="text-display-currency font-display-currency relative z-10 mt-1 block"
          />
        </div>
      ) : null}

      <CopyableReference reference={reference} />

      {details && details.length > 0 ? (
        <dl className="bg-surface border-outline-variant divide-outline-variant/70 divide-y rounded-xl border px-4">
          {details.map((d) => (
            <div key={d.label} className="flex items-start justify-between gap-4 py-3">
              <dt className="text-body-md font-body-md text-on-surface-variant shrink-0">
                {d.label}
              </dt>
              <dd className="text-body-md font-body-md text-on-surface min-w-0 text-right font-semibold">
                {d.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* How to pay */}
      <section className="bg-surface border-outline-variant overflow-hidden rounded-xl border">
        <h2 className="text-button-text font-button-text text-on-surface border-outline-variant bg-surface-container-low border-b px-4 py-3">
          How to pay
        </h2>
        <ol className="divide-outline-variant/70 divide-y">
          <Step
            n={1}
            title="Pay at the SACCO office"
            body={`Visit the office and give your member number ${memberNo}. The cashier will record the payment and hand you a receipt immediately.`}
          />
          <Step
            n={2}
            title="Pay by mobile money"
            body={`Send to the SACCO's registered mobile money number and quote the reference above along with your name, ${memberName}. Ask for the confirmation SMS and keep it until the receipt appears in this app.`}
          />
          <Step
            n={3}
            title="Pay by bank transfer"
            body="Use the SACCO's bank account and put your member number in the narration. Transfers are reconciled on the next working day."
          />
        </ol>
      </section>

      <Alert tone="info" title="Your receipt appears here automatically">
        As soon as a cashier records your payment, it shows up in your transactions with a full
        receipt you can print or share. If it has not appeared within one working day, contact the
        SACCO office with your reference.
      </Alert>

      {footnote ? (
        <p className="text-label-md font-label-md text-on-surface-variant text-center normal-case">
          {footnote}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <Link
          href="/transactions"
          className="bg-primary text-on-primary h-touch-target-primary text-button-text font-button-text flex items-center justify-center gap-2 rounded-lg font-semibold"
        >
          <Icon name="receipt_long" size={20} />
          View my transactions
        </Link>
        <Link
          href={backHref}
          className="border-outline-variant text-primary bg-surface h-touch-target-primary text-button-text font-button-text flex items-center justify-center rounded-lg border font-semibold"
        >
          Back
        </Link>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-3 p-4">
      <span className="bg-primary text-on-primary text-label-md font-label-md flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-body-md font-body-md text-on-surface font-semibold">{title}</p>
        <p className="text-body-md font-body-md text-on-surface-variant mt-0.5">{body}</p>
      </div>
    </li>
  );
}
