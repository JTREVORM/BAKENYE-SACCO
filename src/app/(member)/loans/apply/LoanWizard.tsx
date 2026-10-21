'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { applyForLoan } from '@/app/actions/financial';
import { createClient } from '@/lib/supabase/client';
import { MemberPicker, type PickedMember } from '@/components/forms/MemberPicker';
import { Icon, Money, Avatar } from '@/components/ui/primitives';
import { Alert, Skeleton } from '@/components/ui/states';
import { ActionForm } from '@/components/forms/ActionForm';
import { useSubmission } from '@/components/forms/useSubmission';
import { UnresolvedSubmission } from '@/components/forms/UnresolvedSubmission';
import {
  Button,
  Field,
  MoneyInput,
  Select,
  SubmitButton,
  StickyActions,
  Textarea,
} from '@/components/ui/form';
import { formatUGX, toNumber } from '@/lib/money';
import { newIdempotencyKey } from '@/lib/errors';
import { clsx } from '@/lib/clsx';
import { REPAYMENT_FREQUENCY_LABELS, type LoanProductRow, type LoanQuote } from '@/types/db';
import type { IconName } from '@/lib/icons';

/**
 * Loan application wizard.
 *
 * The Stitch export laid this out as six discrete screens
 * (`apply_for_loan_step_1` … `apply_for_loan_review`), each with the
 * "Step N of 6" progress header. Those become six steps of one client-side
 * flow, so a member on a patchy connection does not lose their answers to a
 * page load between every question, and so Back genuinely goes back.
 *
 * The pricing shown on step 4 comes from `quote_loan()` in the database — the
 * same function that recomputes the figures when the application is committed.
 * The member is never quoted one interest amount and charged another.
 */

const PURPOSE_CATEGORIES = [
  'Business Expansion',
  'School Fees',
  'Emergency / Medical',
  'Agricultural Inputs',
  'Home Improvement',
  'Other',
];

/**
 * A glyph for a product card.
 *
 * Products are data, so this cannot be a lookup keyed on the four codes that
 * happened to be seeded — a SACCO that adds a Motorcycle Loan would get a blank
 * circle where every other card has an icon. It matches on words in the
 * product's own name and category, and falls back to the generic payments glyph
 * that every loan can legitimately wear.
 */
const PRODUCT_ICON_WORDS: [RegExp, IconName][] = [
  [/business|enterprise|trade|sme|commercial/i, 'work'],
  [/emergency|medical|health|urgent/i, 'error'],
  [/school|educat|fees|student|tuition/i, 'assignment'],
  [/agri|farm|crop|livestock|harvest/i, 'handshake'],
  [/home|house|build|construct|property|land/i, 'apartment'],
  [/asset|vehicle|motor|equipment|machine/i, 'inventory_2'],
  [/salary|advance|payroll/i, 'wallet'],
  [/welfare|social|group/i, 'groups'],
];

function productIcon(product: LoanProductRow): IconName {
  const haystack = `${product.name} ${product.category ?? ''}`;
  for (const [pattern, icon] of PRODUCT_ICON_WORDS) {
    if (pattern.test(haystack)) return icon;
  }
  return 'payments';
}

type Guarantor = { member: PickedMember; amount: number };

/** What one repayment is called, given how often they fall due. */
const INSTALLMENT_LABELS: Record<string, string> = {
  daily: 'Daily repayment',
  weekly: 'Weekly repayment',
  biweekly: 'Repayment every two weeks',
  monthly: 'Monthly repayment',
};

const STEP_TITLES = [
  'Loan Type',
  'Amount & Purpose',
  'Repayment Period',
  'Guarantors',
  'Documents',
  'Review',
];

export function LoanWizard({
  memberId,
  memberName,
  products,
  savingsBalance,
  shareValue,
}: {
  memberId: string;
  memberName: string;
  products: LoanProductRow[];
  savingsBalance: number;
  shareValue: number;
}) {
  const [step, setStep] = useState(0);
  const [productId, setProductId] = useState<string>(products[0]?.id ?? '');
  const [principal, setPrincipal] = useState<number | null>(null);
  const [purposeCategory, setPurposeCategory] = useState('');
  const [purpose, setPurpose] = useState('');
  const [months, setMonths] = useState<number>(products[0]?.min_period_months ?? 6);
  const [guarantors, setGuarantors] = useState<Guarantor[]>([]);
  const [documents, setDocuments] = useState<{ label: string; name: string }[]>([]);
  const [stepError, setStepError] = useState<string | null>(null);

  const [quote, setQuote] = useState<LoanQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const submission = useSubmission<{ loan_id: string; loan_no: string }>(applyForLoan);
  const state = submission.result;
  const [idemKey] = useState(() => newIdempotencyKey('loan-apply'));

  const product = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );

  // Keep the period inside the chosen product's bounds when the product changes.
  useEffect(() => {
    if (!product) return;
    setMonths((m) => Math.min(Math.max(m, product.min_period_months), product.max_period_months));
  }, [product]);

  /**
   * Live quote. Debounced, and only once the amount and period are both usable
   * — a keystroke-per-request loop would be unkind to a 3G connection.
   */
  useEffect(() => {
    if (!product || !principal || principal <= 0 || !months) {
      setQuote(null);
      return;
    }
    if (principal < product.min_amount || principal > product.max_amount) {
      setQuote(null);
      setQuoteError(
        `${product.name} is available between ${formatUGX(product.min_amount)} and ${formatUGX(
          product.max_amount,
        )}.`,
      );
      return;
    }

    setQuoting(true);
    setQuoteError(null);
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('quote_loan', {
        p_product_id: product.id,
        p_principal: principal,
        p_period_months: months,
      });
      if (error) {
        setQuote(null);
        setQuoteError('We could not price this loan. Adjust the amount or period.');
      } else {
        setQuote(data as LoanQuote);
      }
      setQuoting(false);
    }, 350);

    return () => clearTimeout(timer);
  }, [product, principal, months]);

  const minGuarantors = product?.min_guarantors ?? 0;
  const guaranteedTotal = guarantors.reduce((sum, g) => sum + g.amount, 0);

  function validateStep(index: number): string | null {
    switch (index) {
      case 0:
        return product ? null : 'Choose a loan type to continue.';
      case 1:
        if (!principal || principal <= 0) return 'Enter how much you want to borrow.';
        if (product && principal < product.min_amount)
          return `The minimum for a ${product.name} is ${formatUGX(product.min_amount)}.`;
        if (product && principal > product.max_amount)
          return `The maximum for a ${product.name} is ${formatUGX(product.max_amount)}.`;
        if (!purposeCategory) return 'Choose what the loan is for.';
        if (purpose.trim().length < 5) return 'Describe briefly what the money will be used for.';
        return null;
      case 2:
        if (!months) return 'Choose a repayment period.';
        if (!quote && !quoting) return quoteError ?? 'We could not price this loan yet.';
        return null;
      case 3:
        if (guarantors.length < minGuarantors)
          return `This loan needs at least ${minGuarantors} guarantor${
            minGuarantors === 1 ? '' : 's'
          }.`;
        if (guarantors.some((g) => g.amount <= 0))
          return 'Give each guarantor an amount they are backing.';
        if (quote && guaranteedTotal < toNumber(quote.principal))
          return `Guarantors must cover the full ${formatUGX(
            quote.principal,
          )}. Currently covered: ${formatUGX(guaranteedTotal)}.`;
        return null;
      default:
        return null;
    }
  }

  function next() {
    const message = validateStep(step);
    setStepError(message);
    if (!message) {
      setStep((s) => Math.min(s + 1, STEP_TITLES.length - 1));
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }

  function back() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }

  /* --------------------------------------------------------------- success */
  if (state?.ok) {
    return (
      <div className="animate-slide-up flex flex-col items-center py-10 text-center">
        <div className="bg-tertiary-container mb-5 flex h-20 w-20 items-center justify-center rounded-full">
          <Icon name="check_circle" size={44} className="text-white" />
        </div>
        <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
          Application submitted
        </h2>
        <p className="text-body-md font-body-md text-on-surface-variant mt-2 max-w-sm">
          {state.message} A loan officer will review it and you will be notified of the decision.
        </p>

        <div className="bg-surface-container-low mt-6 w-full max-w-sm rounded-xl p-4 shadow-neu-sm">
          <p className="text-label-md font-label-md text-on-surface-variant">Application number</p>
          <p className="text-button-text font-button-text text-on-surface tabular mt-1 select-all font-mono">
            {state.data.loan_no}
          </p>
        </div>

        <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
          <Link
            href={`/loans/${state.data.loan_id}`}
            className="bg-primary text-on-primary h-touch-target-primary text-button-text font-button-text flex items-center justify-center rounded-lg font-semibold"
          >
            View application
          </Link>
          <Link
            href="/loans"
            className="text-primary bg-surface h-touch-target-primary text-button-text font-button-text flex items-center justify-center rounded-lg font-semibold shadow-neu-sm"
          >
            Back to my loans
          </Link>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ form */
  return (
    <ActionForm submission={submission} noValidate>
      {submission.unresolved ? (
        <UnresolvedSubmission
          busy={submission.busy}
          onRecheck={submission.recheck}
          noun="application"
        />
      ) : null}
      <input type="hidden" name="member_id" value={memberId} />
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="principal" value={principal ?? ''} />
      <input type="hidden" name="period_months" value={months} />
      <input type="hidden" name="purpose" value={purpose} />
      <input type="hidden" name="purpose_category" value={purposeCategory} />
      <input type="hidden" name="idempotency_key" value={idemKey} />
      <input
        type="hidden"
        name="guarantors"
        value={JSON.stringify(guarantors.map((g) => ({ member_id: g.member.id, amount: g.amount })))}
      />

      {/* Progress indicator — Stitch's "Step N of 6" header. */}
      <div className="mb-6">
        <div className="mb-2 flex items-end justify-between gap-3">
          <span className="text-label-md font-label-md text-primary">
            Step {step + 1} of {STEP_TITLES.length}
          </span>
          <span className="text-body-md font-body-md text-on-surface-variant">
            {STEP_TITLES[step]}
          </span>
        </div>
        <div
          className="bg-surface-container-high h-2 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={STEP_TITLES.length}
          aria-label="Application progress"
        >
          <div
            className="bg-primary h-full rounded-full transition-all duration-300"
            style={{ width: `${((step + 1) / STEP_TITLES.length) * 100}%` }}
          />
        </div>
      </div>

      {state && !state.ok ? (
        <div className="mb-4">
          <Alert tone="error" title="Application not submitted">
            {state.error}
          </Alert>
        </div>
      ) : null}

      {stepError ? (
        <div className="mb-4">
          <Alert tone="error">{stepError}</Alert>
        </div>
      ) : null}

      {/* ---------------------------------------------------- step 1: type */}
      {step === 0 ? (
        <section>
          <Header
            title="Select Loan Type"
            subtitle="Choose the financial product that best fits your current needs."
          />
          <div className="mb-8 grid gap-4">
            {products.map((p) => {
              const checked = p.id === productId;
              return (
                <label key={p.id} className="group relative cursor-pointer">
                  <input
                    className="peer sr-only"
                    type="radio"
                    name="product_choice"
                    value={p.id}
                    checked={checked}
                    onChange={() => setProductId(p.id)}
                  />
                  <div
                    className={clsx(
                      'bg-surface-container-lowest shadow-card flex items-start gap-4 rounded-xl border-2 p-5 transition-all hover:shadow-lg',
                      checked ? 'border-primary bg-primary-fixed' : 'border-transparent',
                    )}
                  >
                    <div
                      className={clsx(
                        'flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors',
                        checked
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container text-primary',
                      )}
                    >
                      <Icon name={productIcon(p)} size={24} />
                    </div>
                    <div className="min-w-0 flex-grow">
                      <h3 className="text-button-text font-button-text text-on-background mb-1">
                        {p.name}
                      </h3>
                      <p className="text-body-md font-body-md text-on-surface-variant">
                        {p.description}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant mt-2 normal-case">
                        {formatUGX(p.min_amount)} – {formatUGX(p.max_amount)} ·{' '}
                        {p.interest_rate}% p.a. · {p.min_period_months}–{p.max_period_months} months
                        {' · '}
                        {REPAYMENT_FREQUENCY_LABELS[p.repayment_frequency].toLowerCase()}
                        {p.requires_guarantors && p.min_guarantors > 0
                          ? ` · ${p.min_guarantors} guarantor${p.min_guarantors === 1 ? '' : 's'}`
                          : ''}
                      </p>
                    </div>
                    <div
                      className={clsx(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                        checked ? 'border-primary bg-primary' : 'border-outline-variant',
                      )}
                    >
                      <Icon
                        name="check"
                        size={16}
                        className={clsx('text-on-primary', checked ? 'opacity-100' : 'opacity-0')}
                      />
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------- step 2: amount/purpose */}
      {step === 1 ? (
        <section className="flex flex-col gap-6">
          <Header
            title="How much do you need?"
            subtitle={
              product
                ? `${product.name}: ${formatUGX(product.min_amount)} to ${formatUGX(
                    product.max_amount,
                  )}.`
                : undefined
            }
          />

          <Field label="Loan amount" htmlFor="principal" required>
            <MoneyInput
              id="principal"
              name="principal_display"
              value={principal ?? ''}
              onValueChange={setPrincipal}
              enterKeyHint="next"
              invalid={
                !!principal &&
                !!product &&
                (principal < product.min_amount || principal > product.max_amount)
              }
            />
          </Field>

          {/* Your standing at the SACCO, so the ask is informed. */}
          <div className="bg-surface-container-low grid grid-cols-2 gap-3 rounded-xl p-4 shadow-neu-sm">
            <div>
              <p className="text-label-md font-label-md text-on-surface-variant">Your savings</p>
              <Money value={savingsBalance} className="text-body-lg font-body-lg text-on-surface font-semibold" />
            </div>
            <div>
              <p className="text-label-md font-label-md text-on-surface-variant">Your shares</p>
              <Money value={shareValue} className="text-body-lg font-body-lg text-on-surface font-semibold" />
            </div>
          </div>

          <Field label="Select Purpose" htmlFor="purpose_category" required>
            <Select
              id="purpose_category"
              value={purposeCategory}
              onChange={(e) => setPurposeCategory(e.target.value)}
              required
            >
              <option value="">Choose a purpose…</option>
              {PURPOSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Tell us more"
            htmlFor="purpose_detail"
            required
            hint="A clear explanation helps the loan committee decide faster."
          >
            <Textarea
              id="purpose_detail"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              maxLength={1000}
              placeholder="e.g. Restocking my shop with maize flour and sugar ahead of the school term."
              required
            />
          </Field>
        </section>
      ) : null}

      {/* ------------------------------------------ step 3: period + quote */}
      {step === 2 ? (
        <section className="flex flex-col gap-6">
          <Header title="Repayment Period" subtitle="Choose your terms" />

          <Field label="Repayment period" htmlFor="months" required>
            <div className="flex flex-wrap gap-2">
              {periodChoices(product).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMonths(m)}
                  aria-pressed={months === m}
                  className={clsx(
                    'text-button-text font-button-text h-touch-target-min min-w-[84px] rounded-lg border px-4 transition-colors',
                    months === m
                      ? 'border-primary bg-primary text-on-primary'
                      : 'border-outline-variant bg-surface text-on-surface hover:bg-surface-container-low',
                  )}
                >
                  {m} {m === 1 ? 'month' : 'months'}
                </button>
              ))}
            </div>
          </Field>

          {quoting ? (
            <div className="bg-surface-container-low space-y-3 rounded-xl p-5 shadow-neu-sm">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-48" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : quote ? (
            <QuoteCard quote={quote} />
          ) : quoteError ? (
            <Alert tone="error">{quoteError}</Alert>
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------- step 4: guarantors */}
      {step === 3 ? (
        <section className="flex flex-col gap-6">
          <Header
            title="Guarantors"
            subtitle={
              minGuarantors > 0
                ? `This loan needs at least ${minGuarantors} guarantor${
                    minGuarantors === 1 ? '' : 's'
                  } who together cover the full amount.`
                : 'You may add guarantors to strengthen your application.'
            }
          />

          {quote ? (
            <div className="bg-surface-container-low rounded-xl p-4 shadow-neu-sm">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-body-md font-body-md text-on-surface-variant">
                  Amount to cover
                </span>
                <Money value={quote.principal} className="text-body-lg font-body-lg font-semibold" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-md font-body-md text-on-surface-variant">
                  Covered so far
                </span>
                <Money
                  value={guaranteedTotal}
                  className={clsx(
                    'text-body-lg font-body-lg font-semibold',
                    guaranteedTotal >= toNumber(quote.principal) ? 'text-tertiary' : 'text-error',
                  )}
                />
              </div>
            </div>
          ) : null}

          {guarantors.map((g, i) => (
            <div
              key={g.member.id}
              className="bg-surface flex flex-col gap-3 rounded-xl p-4 shadow-neu-sm"
            >
              <div className="flex items-center gap-3">
                <Avatar name={g.member.full_name} src={g.member.photo_url} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                    {g.member.full_name}
                  </p>
                  <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                    {g.member.member_no} · savings {formatUGX(g.member.savings_balance)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setGuarantors((list) => list.filter((_, j) => j !== i))}
                  aria-label={`Remove ${g.member.full_name} as guarantor`}
                  className="text-error hover:bg-error-container flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                >
                  <Icon name="delete" size={20} />
                </button>
              </div>

              <Field label="Amount guaranteed" htmlFor={`g-amount-${i}`} required>
                <MoneyInput
                  id={`g-amount-${i}`}
                  name={`guarantor_amount_${i}`}
                  value={g.amount || ''}
                  onValueChange={(v) =>
                    setGuarantors((list) =>
                      list.map((item, j) => (j === i ? { ...item, amount: v ?? 0 } : item)),
                    )
                  }
                />
              </Field>
            </div>
          ))}

          <MemberPicker
            name="guarantor_search"
            label="Add a guarantor"
            required={minGuarantors > 0 && guarantors.length < minGuarantors}
            excludeMemberId={memberId}
            onSelect={(m) => {
              if (!m) return;
              if (guarantors.some((g) => g.member.id === m.id)) return;
              // Suggest an even split of what is still uncovered.
              const remaining = quote
                ? Math.max(toNumber(quote.principal) - guaranteedTotal, 0)
                : 0;
              setGuarantors((list) => [...list, { member: m, amount: Math.round(remaining) }]);
            }}
          />
        </section>
      ) : null}

      {/* ------------------------------------------ step 5: documents */}
      {step === 4 ? (
        <section className="flex flex-col gap-6">
          <Header
            title="Supporting Documents"
            subtitle="Optional. Bring the originals to the office when you collect your funds."
          />

          <div className="bg-surface-container shadow-neu-inset rounded-2xl p-6 text-center">
            <Icon name="upload_file" size={32} className="text-on-surface-variant mx-auto" />
            <p className="text-body-md font-body-md text-on-surface mt-3 font-semibold">
              Attach a document
            </p>
            <p className="text-label-md font-label-md text-on-surface-variant mt-1 normal-case">
              Business licence, receipt, school fees structure, medical form.
            </p>

            <label className="bg-primary text-on-primary h-touch-target-min text-button-text font-button-text mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg px-4">
              <Icon name="attach_file" size={20} />
              Choose file
              <input
                type="file"
                className="sr-only"
                accept="image/*,application/pdf"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setDocuments((list) => [
                    ...list,
                    ...files.map((f) => ({ label: f.name, name: f.name })),
                  ]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {documents.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {documents.map((d, i) => (
                <li
                  key={`${d.name}-${i}`}
                  className="bg-surface flex items-center gap-3 rounded-lg p-3 shadow-neu-sm"
                >
                  <Icon name="description" className="text-on-surface-variant shrink-0" />
                  <span className="text-body-md font-body-md text-on-surface min-w-0 flex-1 truncate">
                    {d.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDocuments((list) => list.filter((_, j) => j !== i))}
                    aria-label={`Remove ${d.label}`}
                    className="text-error hover:bg-error-container flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                  >
                    <Icon name="close" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <Alert tone="info">
            Documents are noted with your application. A loan officer will collect the originals
            before the funds are released.
          </Alert>
        </section>
      ) : null}

      {/* ---------------------------------------------- step 6: review */}
      {step === 5 ? (
        <section className="flex flex-col gap-5">
          <div className="text-center">
            <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-background">
              Review Application
            </h2>
            <p className="text-body-lg font-body-lg text-on-surface-variant mt-1">
              Almost there! Check everything before you submit.
            </p>
          </div>

          {quote ? <QuoteCard quote={quote} emphasised /> : null}

          <div className="bg-surface overflow-hidden rounded-xl shadow-neu-sm">
            <h3 className="text-button-text font-button-text text-on-surface border-outline-variant bg-surface-container-low border-b px-4 py-3">
              Loan Details
            </h3>
            <dl className="divide-outline-variant/70 divide-y px-4">
              <ReviewLine label="Applicant" value={memberName} />
              <ReviewLine label="Loan type" value={product?.name ?? '—'} />
              <ReviewLine label="Amount requested" value={formatUGX(principal)} />
              <ReviewLine label="Repayment period" value={`${months} months`} />
              <ReviewLine label="Purpose" value={purposeCategory} />
              <ReviewLine label="Details" value={purpose} />
              <ReviewLine
                label="First payment"
                value="One month after the loan is paid out"
              />
            </dl>
          </div>

          <div className="bg-surface overflow-hidden rounded-xl shadow-neu-sm">
            <h3 className="text-button-text font-button-text text-on-surface border-outline-variant bg-surface-container-low border-b px-4 py-3">
              Guarantors ({guarantors.length})
            </h3>
            {guarantors.length === 0 ? (
              <p className="text-body-md font-body-md text-on-surface-variant p-4">
                No guarantors added.
              </p>
            ) : (
              <ul className="divide-outline-variant/70 divide-y">
                {guarantors.map((g) => (
                  <li key={g.member.id} className="flex items-center gap-3 p-4">
                    <Avatar name={g.member.full_name} src={g.member.photo_url} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="text-body-md font-body-md text-on-surface truncate font-semibold">
                        {g.member.full_name}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant tabular normal-case">
                        {g.member.member_no}
                      </p>
                    </div>
                    <Money value={g.amount} className="text-body-md font-body-md font-semibold" />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {documents.length > 0 ? (
            <div className="bg-surface overflow-hidden rounded-xl shadow-neu-sm">
              <h3 className="text-button-text font-button-text text-on-surface border-outline-variant bg-surface-container-low border-b px-4 py-3">
                Documents ({documents.length})
              </h3>
              <ul className="divide-outline-variant/70 divide-y">
                {documents.map((d, i) => (
                  <li
                    key={`${d.name}-${i}`}
                    className="text-body-md font-body-md text-on-surface flex items-center gap-2 p-4"
                  >
                    <Icon name="description" size={20} className="text-on-surface-variant" />
                    <span className="truncate">{d.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Alert tone="warning" title="Before you submit">
            By submitting you confirm the information is true and that you accept the interest and
            repayment terms shown above. Your guarantors will be asked to confirm.
          </Alert>
        </section>
      ) : null}

      {/* Actions */}
      <StickyActions>
        {step > 0 ? (
          <Button variant="outline" size="lg" className="flex-1" icon="arrow_back" onClick={back}>
            Back
          </Button>
        ) : (
          <Link
            href="/loans"
            className="text-primary bg-surface h-touch-target-primary text-button-text font-button-text flex flex-1 items-center justify-center rounded-lg font-semibold shadow-neu-sm"
          >
            Cancel
          </Link>
        )}

        {step < STEP_TITLES.length - 1 ? (
          <Button size="lg" className="flex-[2]" iconEnd="arrow_forward" onClick={next}>
            Continue
          </Button>
        ) : (
          <SubmitButton size="lg" className="flex-[2]" pendingLabel="Submitting…" icon="check">
            Submit application
          </SubmitButton>
        )}
      </StickyActions>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------------ */

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-2">
      <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-background mb-2">
        {title}
      </h2>
      {subtitle ? (
        <p className="text-body-lg font-body-lg text-on-surface-variant">{subtitle}</p>
      ) : null}
    </div>
  );
}

function ReviewLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-body-md font-body-md text-on-surface-variant shrink-0">{label}</dt>
      <dd className="text-body-md font-body-md text-on-surface min-w-0 text-right font-semibold">
        {value || '—'}
      </dd>
    </div>
  );
}

/** The pricing panel — the figure the member is agreeing to. */
function QuoteCard({ quote, emphasised = false }: { quote: LoanQuote; emphasised?: boolean }) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-xl p-5',
        emphasised ? 'bg-primary text-on-primary' : 'bg-primary-fixed text-on-primary-fixed',
      )}
    >
      {emphasised ? (
        <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/10 blur-xl" />
      ) : null}

      <p
        className={clsx(
          'text-label-md font-label-md relative z-10',
          emphasised ? 'text-primary-fixed-dim' : 'text-on-primary-fixed-variant',
        )}
      >
        {INSTALLMENT_LABELS[quote.repayment_frequency] ?? 'Each repayment'}
      </p>
      <Money
        value={quote.installment_amount}
        className="text-display-currency font-display-currency relative z-10 mt-1 block"
      />
      <p
        className={clsx(
          'text-body-md font-body-md relative z-10 mt-1',
          emphasised ? 'text-primary-fixed-dim' : 'text-on-primary-fixed-variant',
        )}
      >
        {quote.installment_count} payment{quote.installment_count === 1 ? '' : 's'} over{' '}
        {quote.period_months} month{quote.period_months === 1 ? '' : 's'}
      </p>

      <dl
        className={clsx(
          'relative z-10 mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-4',
          emphasised ? 'border-white/20' : 'border-on-primary-fixed/10',
        )}
      >
        <QuoteLine label="Principal" value={formatUGX(quote.principal)} emphasised={emphasised} />
        <QuoteLine
          label={`Interest (${quote.interest_rate}% p.a.)`}
          value={formatUGX(quote.interest_amount)}
          emphasised={emphasised}
        />
        {toNumber(quote.processing_fee) > 0 ? (
          <QuoteLine
            label="Processing fee"
            value={formatUGX(quote.processing_fee)}
            emphasised={emphasised}
          />
        ) : null}
        {toNumber(quote.insurance_fee) > 0 ? (
          <QuoteLine
            label="Insurance fee"
            value={formatUGX(quote.insurance_fee)}
            emphasised={emphasised}
          />
        ) : null}
        {toNumber(quote.application_fee) > 0 ? (
          <QuoteLine
            label="Application fee"
            value={formatUGX(quote.application_fee)}
            emphasised={emphasised}
          />
        ) : null}
        <QuoteLine
          label="You receive"
          value={formatUGX(quote.net_disbursed)}
          emphasised={emphasised}
        />
        <div className="col-span-2 mt-1">
          <QuoteLine
            label="Total you will repay"
            value={formatUGX(quote.total_payable)}
            emphasised={emphasised}
            strong
          />
        </div>
      </dl>
    </div>
  );
}

function QuoteLine({
  label,
  value,
  emphasised,
  strong,
}: {
  label: string;
  value: string;
  emphasised: boolean;
  strong?: boolean;
}) {
  return (
    <div>
      <dt
        className={clsx(
          'text-label-md font-label-md normal-case',
          emphasised ? 'text-primary-fixed-dim' : 'text-on-primary-fixed-variant',
        )}
      >
        {label}
      </dt>
      <dd
        className={clsx(
          'tabular',
          strong ? 'text-button-text font-button-text font-bold' : 'text-body-md font-body-md font-semibold',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Sensible period options inside the product's own bounds. */
function periodChoices(product: LoanProductRow | null): number[] {
  if (!product) return [3, 6, 12];
  const candidates = [1, 2, 3, 6, 9, 12, 18, 24, 36];
  const inRange = candidates.filter(
    (m) => m >= product.min_period_months && m <= product.max_period_months,
  );
  // Always offer the exact bounds, even when they are not round numbers.
  const set = new Set([product.min_period_months, ...inRange, product.max_period_months]);
  return [...set].sort((a, b) => a - b);
}
