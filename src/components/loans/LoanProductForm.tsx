'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveLoanProduct } from '@/app/actions/loan-products';
import { Icon } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Input, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { formatUGX } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { ActionResult } from '@/lib/errors';
import {
  INTEREST_METHOD_LABELS,
  PENALTY_BASIS_LABELS,
  REPAYMENT_FREQUENCY_LABELS,
  type LoanProductRow,
} from '@/types/db';

/**
 * Create or edit a loan product.
 *
 * A product is a price list, so this form is the place a SACCO decides what
 * borrowing costs. It is grouped the way a manager thinks about the decision —
 * what the product is, what it costs, how long it runs, what happens when a
 * payment is late, and who is allowed to take it — rather than in the order the
 * columns happen to sit in the table.
 *
 * Two things the form does beyond collecting values:
 *
 *  - It prices a worked example live, from the same arithmetic the database
 *    uses. A rate of 18% reducing over 12 months is not a number most people
 *    can convert into an installment in their head, and a product configured by
 *    someone who could not see the consequence is how a SACCO ends up lending
 *    at a rate it did not intend.
 *
 *  - Editing an existing product confirms first, in a dialog that says plainly
 *    what the change does and does not touch. Loans already written carry their
 *    own snapshotted terms, so an edit reaches future applications only — but
 *    that is exactly the kind of reassurance that has to be stated, not assumed.
 */
export function LoanProductForm({
  product,
  canManage,
  defaults,
}: {
  product?: LoanProductRow | null;
  canManage: boolean;
  /**
   * Starting values for a new product from Settings -> Loans
   * (loans.default_grace_period_days, loans.default_late_penalty_pct).
   */
  defaults?: { gracePeriodDays: number; latePenaltyPct: number };
}) {
  const router = useRouter();
  const [state, action] = useActionState<
    ActionResult<{ id: string; name: string; created: boolean }> | null,
    FormData
  >(saveLoanProduct, null);

  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  const editing = !!product;

  // Held in state only for the worked example. Everything else is uncontrolled,
  // so the browser keeps its own values and the form stays cheap to type in.
  const [rate, setRate] = useState(product ? Number(product.interest_rate) : 12);
  const [method, setMethod] = useState(product?.interest_method ?? 'flat');
  const [frequency, setFrequency] = useState(product?.repayment_frequency ?? 'monthly');
  const [maxAmount, setMaxAmount] = useState(product ? Number(product.max_amount) : 5_000_000);
  const [maxTerm, setMaxTerm] = useState(product ? Number(product.max_period_months) : 12);
  const [processingPct, setProcessingPct] = useState(
    product ? Number(product.processing_fee_pct) : 1,
  );
  const [insurancePct, setInsurancePct] = useState(
    product ? Number(product.insurance_fee_pct) : 0,
  );
  const [applicationFee, setApplicationFee] = useState(
    product ? Number(product.application_fee) : 0,
  );
  const [requiresGuarantors, setRequiresGuarantors] = useState(
    product ? product.requires_guarantors : true,
  );

  const example = useMemo(
    () => priceExample({ rate, method, frequency, principal: maxAmount, months: maxTerm }),
    [rate, method, frequency, maxAmount, maxTerm],
  );
  const fees = useMemo(
    () => ({
      processing: round2((maxAmount * processingPct) / 100),
      insurance: round2((maxAmount * insurancePct) / 100),
      application: round2(applicationFee),
    }),
    [maxAmount, processingPct, insurancePct, applicationFee],
  );
  const totalFees = fees.processing + fees.insurance + fees.application;

  const err = state && !state.ok ? state : null;
  const fieldError = (name: string) => (err?.field === name ? err.error : null);
  const invalid = (name: string) => err?.field === name;

  // On success, go back to the list — the saved product is in it. In an effect
  // rather than in the render body: navigating while rendering is a side effect
  // React is entitled to run twice.
  const saved = state?.ok ? state.data.id : null;
  useEffect(() => {
    if (saved) router.push('/staff/loans/products');
  }, [saved, router]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (editing && !confirming) {
      event.preventDefault();
      setConfirming(true);
    }
  }

  const d = product;

  return (
    <>
      <form ref={formRef} action={action} onSubmit={onSubmit} className="space-y-gutter">
        {product ? <input type="hidden" name="product_id" value={product.id} /> : null}

        {/* Field errors are also shown against the field itself; the banner is
            here because this form is long enough that the offending field may
            be off-screen when the server answers. */}
        {err ? <Alert tone="error">{err.error}</Alert> : null}
        {state?.ok ? <Alert tone="success">{state.message}</Alert> : null}

        {/* ---------------------------------------------------------------- */}
        <Section
          title="What this product is"
          icon="category"
          description="The name members see when they choose a loan, and the code that identifies it on reports."
        >
          <Field label="Product name" htmlFor="name" required error={fieldError('name')}>
            <Input
              id="name"
              name="name"
              defaultValue={d?.name ?? ''}
              placeholder="Business Loan"
              disabled={!canManage}
              invalid={invalid('name')}
              maxLength={80}
              required
            />
          </Field>

          <Field
            label="Product code"
            htmlFor="code"
            required
            hint="2–10 capital letters or digits, for example BIZ."
            error={fieldError('code')}
          >
            <Input
              id="code"
              name="code"
              defaultValue={d?.code ?? ''}
              placeholder="BIZ"
              disabled={!canManage}
              invalid={invalid('code')}
              maxLength={10}
              className="uppercase"
              required
            />
          </Field>

          <Field
            label="Category"
            htmlFor="category"
            hint="Optional grouping, for example Commercial or Welfare."
            error={fieldError('category')}
          >
            <Input
              id="category"
              name="category"
              defaultValue={d?.category ?? ''}
              placeholder="Commercial"
              disabled={!canManage}
              maxLength={60}
            />
          </Field>

          <Field
            label="Position in the list"
            htmlFor="sort_order"
            hint="Lower numbers appear first when a member chooses a product."
            error={fieldError('sort_order')}
          >
            <Input
              id="sort_order"
              name="sort_order"
              type="number"
              min={0}
              step={1}
              className="tabular"
              defaultValue={String(d?.sort_order ?? 100)}
              disabled={!canManage}
            />
          </Field>

          <div className="md:col-span-2">
            <Field
              label="Description"
              htmlFor="description"
              hint="One or two sentences, shown to members choosing a loan."
              error={fieldError('description')}
            >
              <Textarea
                id="description"
                name="description"
                rows={2}
                defaultValue={d?.description ?? ''}
                disabled={!canManage}
                maxLength={400}
              />
            </Field>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Interest"
          icon="percent"
          description="Flat interest is charged on the original amount for the whole term. Reducing balance is charged only on what is still owed, so the same rate costs a member less."
        >
          <Field
            label="Interest rate"
            htmlFor="interest_rate"
            required
            hint="Per year."
            error={fieldError('interest_rate')}
          >
            <div className="relative">
              <Input
                id="interest_rate"
                name="interest_rate"
                type="number"
                min={0}
                max={100}
                step="any"
                className="tabular pr-12"
                value={String(rate)}
                disabled={!canManage}
                invalid={invalid('interest_rate')}
                onChange={(e) => setRate(e.target.value === '' ? 0 : Number(e.target.value))}
                required
              />
              <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-label-md font-semibold text-on-surface-variant">
                %
              </span>
            </div>
          </Field>

          <Field
            label="How interest is calculated"
            htmlFor="interest_method"
            required
            error={fieldError('interest_method')}
          >
            <Select
              id="interest_method"
              name="interest_method"
              value={method}
              disabled={!canManage}
              onChange={(e) => setMethod(e.target.value as typeof method)}
            >
              {Object.entries(INTEREST_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Amount and term"
          icon="payments"
          description="The range a member may borrow, and how long they have to repay it."
        >
          <Field
            label="Smallest amount"
            htmlFor="min_amount"
            required
            error={fieldError('min_amount')}
          >
            <MoneyField
              id="min_amount"
              name="min_amount"
              defaultValue={d ? Number(d.min_amount) : 100_000}
              disabled={!canManage}
              invalid={invalid('min_amount')}
            />
          </Field>

          <Field
            label="Largest amount"
            htmlFor="max_amount"
            required
            error={fieldError('max_amount')}
          >
            <MoneyField
              id="max_amount"
              name="max_amount"
              value={maxAmount}
              onChange={setMaxAmount}
              disabled={!canManage}
              invalid={invalid('max_amount')}
            />
          </Field>

          <Field
            label="Shortest term"
            htmlFor="min_period_months"
            required
            hint="In months."
            error={fieldError('min_period_months')}
          >
            <Input
              id="min_period_months"
              name="min_period_months"
              type="number"
              min={1}
              step={1}
              className="tabular"
              defaultValue={String(d?.min_period_months ?? 1)}
              disabled={!canManage}
              invalid={invalid('min_period_months')}
              required
            />
          </Field>

          <Field
            label="Longest term"
            htmlFor="max_period_months"
            required
            hint="In months."
            error={fieldError('max_period_months')}
          >
            <Input
              id="max_period_months"
              name="max_period_months"
              type="number"
              min={1}
              step={1}
              className="tabular"
              value={String(maxTerm)}
              disabled={!canManage}
              invalid={invalid('max_period_months')}
              onChange={(e) => setMaxTerm(e.target.value === '' ? 1 : Number(e.target.value))}
              required
            />
          </Field>

          <Field
            label="Repayment frequency"
            htmlFor="repayment_frequency"
            required
            hint="How often an installment falls due. The term is still agreed in months."
            error={fieldError('repayment_frequency')}
          >
            <Select
              id="repayment_frequency"
              name="repayment_frequency"
              value={frequency}
              disabled={!canManage}
              onChange={(e) => setFrequency(e.target.value as typeof frequency)}
            >
              {Object.entries(REPAYMENT_FREQUENCY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Fees"
          icon="request_quote"
          description="Taken at disbursement and booked as SACCO income. Percentage fees are charged on the amount borrowed."
        >
          <Field
            label="Processing fee"
            htmlFor="processing_fee_pct"
            error={fieldError('processing_fee_pct')}
          >
            <PercentField
              id="processing_fee_pct"
              name="processing_fee_pct"
              value={processingPct}
              onChange={setProcessingPct}
              disabled={!canManage}
              invalid={invalid('processing_fee_pct')}
            />
          </Field>

          <Field
            label="Insurance fee"
            htmlFor="insurance_fee_pct"
            error={fieldError('insurance_fee_pct')}
          >
            <PercentField
              id="insurance_fee_pct"
              name="insurance_fee_pct"
              value={insurancePct}
              onChange={setInsurancePct}
              disabled={!canManage}
              invalid={invalid('insurance_fee_pct')}
            />
          </Field>

          <Field
            label="Application fee"
            htmlFor="application_fee"
            hint="A flat amount, not a percentage."
            error={fieldError('application_fee')}
          >
            <MoneyField
              id="application_fee"
              name="application_fee"
              value={applicationFee}
              onChange={setApplicationFee}
              disabled={!canManage}
              invalid={invalid('application_fee')}
            />
          </Field>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Late payment"
          icon="schedule"
          description="What happens when an installment is not paid on time."
        >
          <Field
            label="Grace period"
            htmlFor="grace_period_days"
            hint="Days after the due date before a payment counts as late."
            error={fieldError('grace_period_days')}
          >
            <div className="relative">
              <Input
                id="grace_period_days"
                name="grace_period_days"
                type="number"
                min={0}
                step={1}
                className="tabular pr-16"
                defaultValue={String(d?.grace_period_days ?? defaults?.gracePeriodDays ?? 0)}
                disabled={!canManage}
                invalid={invalid('grace_period_days')}
              />
              <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-label-md font-semibold text-on-surface-variant">
                days
              </span>
            </div>
          </Field>

          <Field
            label="Late penalty"
            htmlFor="late_penalty_pct"
            error={fieldError('late_penalty_pct')}
          >
            <PercentField
              id="late_penalty_pct"
              name="late_penalty_pct"
              defaultValue={d ? Number(d.late_penalty_pct) : (defaults?.latePenaltyPct ?? 0)}
              disabled={!canManage}
              invalid={invalid('late_penalty_pct')}
            />
          </Field>

          <Field
            label="Charged on"
            htmlFor="penalty_basis"
            error={fieldError('penalty_basis')}
          >
            <Select
              id="penalty_basis"
              name="penalty_basis"
              defaultValue={d?.penalty_basis ?? 'overdue'}
              disabled={!canManage}
            >
              {Object.entries(PENALTY_BASIS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Who may borrow this"
          icon="rule"
          description="Leave a requirement at zero to switch it off. These are checked when a member applies, together with the SACCO-wide rules in Settings."
        >
          <Field
            label="Minimum savings balance"
            htmlFor="min_savings_balance"
            error={fieldError('min_savings_balance')}
          >
            <MoneyField
              id="min_savings_balance"
              name="min_savings_balance"
              defaultValue={d ? Number(d.min_savings_balance) : 0}
              disabled={!canManage}
              invalid={invalid('min_savings_balance')}
            />
          </Field>

          <Field
            label="Borrowing limit"
            htmlFor="min_savings_multiple"
            hint="A multiple of the member's savings. Zero uses the SACCO-wide limit instead."
            error={fieldError('min_savings_multiple')}
          >
            <div className="relative">
              <Input
                id="min_savings_multiple"
                name="min_savings_multiple"
                type="number"
                min={0}
                step="any"
                className="tabular pr-24"
                defaultValue={String(d?.min_savings_multiple ?? 0)}
                disabled={!canManage}
                invalid={invalid('min_savings_multiple')}
              />
              <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-label-md font-semibold text-on-surface-variant">
                × savings
              </span>
            </div>
          </Field>

          <Field
            label="Minimum membership"
            htmlFor="min_membership_months"
            hint="How long someone must have been a member."
            error={fieldError('min_membership_months')}
          >
            <div className="relative">
              <Input
                id="min_membership_months"
                name="min_membership_months"
                type="number"
                min={0}
                step={1}
                className="tabular pr-20"
                defaultValue={String(d?.min_membership_months ?? 0)}
                disabled={!canManage}
                invalid={invalid('min_membership_months')}
              />
              <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-label-md font-semibold text-on-surface-variant">
                months
              </span>
            </div>
          </Field>

          <Field
            label="Shares required"
            htmlFor="required_shares"
            error={fieldError('required_shares')}
          >
            <Input
              id="required_shares"
              name="required_shares"
              type="number"
              min={0}
              step={1}
              className="tabular"
              defaultValue={String(d?.required_shares ?? 0)}
              disabled={!canManage}
              invalid={invalid('required_shares')}
            />
          </Field>

          <div className="md:col-span-2">
            <Toggle
              name="requires_guarantors"
              label="Guarantors are required"
              description="When off, this product may be taken without anyone standing surety for it."
              checked={requiresGuarantors}
              onChange={setRequiresGuarantors}
              disabled={!canManage}
            />
          </div>

          {requiresGuarantors ? (
            <Field
              label="Guarantors needed"
              htmlFor="min_guarantors"
              required
              error={fieldError('min_guarantors')}
            >
              <Input
                id="min_guarantors"
                name="min_guarantors"
                type="number"
                min={1}
                step={1}
                className="tabular"
                defaultValue={String(d?.min_guarantors ?? 2)}
                disabled={!canManage}
                invalid={invalid('min_guarantors')}
              />
            </Field>
          ) : (
            <input type="hidden" name="min_guarantors" value="0" />
          )}

          <div className="md:col-span-2">
            <Toggle
              name="requires_collateral"
              label="Collateral is required"
              description="Security must be recorded before this loan is approved."
              defaultChecked={d?.requires_collateral ?? false}
              disabled={!canManage}
            />
          </div>

          <div className="md:col-span-2">
            <Field
              label="Collateral notes"
              htmlFor="collateral_notes"
              hint="What is accepted as security, and how it is valued."
              error={fieldError('collateral_notes')}
            >
              <Textarea
                id="collateral_notes"
                name="collateral_notes"
                rows={2}
                defaultValue={d?.collateral_notes ?? ''}
                disabled={!canManage}
                maxLength={400}
              />
            </Field>
          </div>

          <div className="md:col-span-2">
            <Field
              label="Eligibility notes"
              htmlFor="eligibility_notes"
              hint="Anything a loan officer should weigh that the rules above cannot express."
              error={fieldError('eligibility_notes')}
            >
              <Textarea
                id="eligibility_notes"
                name="eligibility_notes"
                rows={2}
                defaultValue={d?.eligibility_notes ?? ''}
                disabled={!canManage}
                maxLength={600}
              />
            </Field>
          </div>

          <div className="md:col-span-2">
            <Field
              label="Instructions for applicants"
              htmlFor="instructions"
              hint="Shown to the member when they choose this product."
              error={fieldError('instructions')}
            >
              <Textarea
                id="instructions"
                name="instructions"
                rows={2}
                defaultValue={d?.instructions ?? ''}
                disabled={!canManage}
                maxLength={600}
              />
            </Field>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          title="Availability"
          icon="toggle_on"
          description="A retired product disappears from the application form. Loans already written under it carry on unchanged."
        >
          <div className="md:col-span-2">
            <Toggle
              name="is_active"
              label="Offer this product to members"
              description="New applications may choose it."
              defaultChecked={d?.is_active ?? true}
              disabled={!canManage}
            />
          </div>

          <div className="md:col-span-2">
            <Field
              label="Reason for this change"
              htmlFor="reason"
              hint="Optional, and recorded in the audit log beside the change."
            >
              <Input
                id="reason"
                name="reason"
                placeholder="Approved at the September committee"
                disabled={!canManage}
                maxLength={200}
              />
            </Field>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <WorkedExample
          principal={maxAmount}
          months={maxTerm}
          rate={rate}
          method={method}
          frequency={frequency}
          interest={example.interest}
          installment={example.installment}
          installments={example.count}
          fees={fees}
          totalFees={totalFees}
        />

        {canManage ? (
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Saving…">
              {editing ? 'Save changes' : 'Create product'}
            </SubmitButton>
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        ) : (
          <Alert tone="info">
            You can see how this product is configured. Changing it needs the settings
            permission.
          </Alert>
        )}
      </form>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Update ${product?.name ?? 'this product'}?`}
      >
        <div className="space-y-4">
          <Alert tone="info" title="What this changes">
            New applications will be quoted on the terms you have just set. Loans that have
            already been approved or disbursed keep the interest rate, fees, term and penalty
            they were agreed on — those were recorded on each loan when it was written and are
            not read from this product again.
          </Alert>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Go back
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirming(false);
                formRef.current?.requestSubmit();
              }}
            >
              Yes, save these terms
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------------ */

function Section({
  title,
  icon,
  description,
  children,
}: {
  title: string;
  icon: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-surface p-5 shadow-card md:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon name={icon} size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-title-md text-on-surface">{title}</h2>
          {description ? (
            <p className="mt-1 text-label-md font-normal leading-relaxed text-on-surface-variant">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-x-gutter gap-y-5 md:grid-cols-2">{children}</div>
    </section>
  );
}

function MoneyField({
  id,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  name: string;
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-body-lg font-semibold text-on-surface-variant">
        UGX
      </span>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        className="tabular pl-16"
        {...(value !== undefined
          ? { value: String(value), onChange: (e) => onChange?.(e.target.value === '' ? 0 : Number(e.target.value)) }
          : { defaultValue: String(defaultValue ?? 0) })}
        disabled={disabled}
        invalid={invalid}
      />
    </div>
  );
}

function PercentField({
  id,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  name: string;
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="decimal"
        min={0}
        max={100}
        step="any"
        className="tabular pr-12"
        {...(value !== undefined
          ? { value: String(value), onChange: (e) => onChange?.(e.target.value === '' ? 0 : Number(e.target.value)) }
          : { defaultValue: String(defaultValue ?? 0) })}
        disabled={disabled}
        invalid={invalid}
      />
      <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-label-md font-semibold text-on-surface-variant">
        %
      </span>
    </div>
  );
}

function Toggle({
  name,
  label,
  description,
  checked,
  defaultChecked,
  onChange,
  disabled,
}: {
  name: string;
  label: string;
  description?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-surface-container p-3.5 shadow-neu-inset-sm">
      <input
        name={name}
        type="checkbox"
        disabled={disabled}
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-0 bg-surface text-primary shadow-neu-sm focus:ring-2 focus:ring-primary/40"
        {...(checked !== undefined
          ? { checked, onChange: (e) => onChange?.(e.target.checked) }
          : { defaultChecked })}
      />
      <span className="min-w-0">
        <span className="block text-body-md font-semibold text-on-surface">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-label-md font-normal leading-relaxed text-on-surface-variant">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * The consequence of the numbers above, at the largest amount over the longest
 * term — the worst case for the member and the one worth seeing before saving.
 *
 * This mirrors `quote_loan()`. It is a preview, not an authority: the database
 * recomputes every figure when a member actually applies, and that computation
 * is the one that binds.
 */
function WorkedExample({
  principal,
  months,
  rate,
  method,
  frequency,
  interest,
  installment,
  installments,
  fees,
  totalFees,
}: {
  principal: number;
  months: number;
  rate: number;
  method: string;
  frequency: string;
  interest: number;
  installment: number;
  installments: number;
  fees: { processing: number; insurance: number; application: number };
  totalFees: number;
}) {
  const valid = principal > 0 && months > 0;

  return (
    <section className="rounded-3xl bg-surface-container p-5 shadow-neu-inset md:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon name="calculate" size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-title-md text-on-surface">What this would cost</h2>
          <p className="mt-1 text-label-md font-normal leading-relaxed text-on-surface-variant">
            A member borrowing the largest amount over the longest term. Recalculated by the
            database when anyone actually applies.
          </p>
        </div>
      </div>

      {!valid ? (
        <p className="text-body-md text-on-surface-variant">
          Enter an amount and a term to see the figures.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-gutter gap-y-3 lg:grid-cols-4">
          <Fact label="Borrowed" value={formatUGX(principal)} />
          <Fact
            label="Interest"
            value={formatUGX(interest)}
            note={`${rate}% ${method === 'flat' ? 'flat' : 'reducing'}`}
          />
          <Fact label="Total repayable" value={formatUGX(principal + interest)} emphasis />
          <Fact
            label="Each installment"
            value={formatUGX(installment)}
            note={`${installments} × ${frequencyWord(frequency)}`}
          />
          <Fact label="Processing fee" value={formatUGX(fees.processing)} />
          <Fact label="Insurance fee" value={formatUGX(fees.insurance)} />
          <Fact label="Application fee" value={formatUGX(fees.application)} />
          <Fact
            label="Received on disbursement"
            value={formatUGX(principal - totalFees)}
            note={totalFees > 0 ? `after ${formatUGX(totalFees)} in fees` : 'no fees'}
            emphasis
          />
        </dl>
      )}
    </section>
  );
}

function Fact({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-normal text-on-surface-variant">{label}</dt>
      <dd
        className={clsx(
          'tabular truncate',
          emphasis ? 'text-title-md text-on-surface' : 'text-body-lg font-semibold text-on-surface',
        )}
      >
        {value}
      </dd>
      {note ? (
        <p className="truncate text-label-md font-normal text-on-surface-variant">{note}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function installmentsFor(months: number, frequency: string): number {
  const perMonth =
    frequency === 'daily' ? 365 / 12 : frequency === 'weekly' ? 52 / 12 : frequency === 'biweekly' ? 26 / 12 : 1;
  return Math.max(1, Math.round(months * perMonth));
}

function periodsPerYear(frequency: string): number {
  return frequency === 'daily' ? 365 : frequency === 'weekly' ? 52 : frequency === 'biweekly' ? 26 : 12;
}

function frequencyWord(frequency: string): string {
  return frequency === 'daily'
    ? 'daily'
    : frequency === 'weekly'
      ? 'weekly'
      : frequency === 'biweekly'
        ? 'every two weeks'
        : 'monthly';
}

/** The same arithmetic as `quote_loan()`, for the preview only. */
function priceExample({
  rate,
  method,
  frequency,
  principal,
  months,
}: {
  rate: number;
  method: string;
  frequency: string;
  principal: number;
  months: number;
}): { interest: number; installment: number; count: number } {
  const count = installmentsFor(months, frequency);
  if (!Number.isFinite(principal) || principal <= 0 || months <= 0) {
    return { interest: 0, installment: 0, count };
  }

  if (method === 'flat') {
    const interest = round2((principal * (rate / 100) * months) / 12);
    return { interest, installment: round2((principal + interest) / count), count };
  }

  const r = rate / 100 / periodsPerYear(frequency);
  if (r === 0) return { interest: 0, installment: round2(principal / count), count };

  const installment = round2((principal * r) / (1 - Math.pow(1 + r, -count)));
  return { interest: round2(installment * count - principal), installment, count };
}
