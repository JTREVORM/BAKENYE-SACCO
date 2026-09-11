'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { registerMember, type RegistrationOutcome } from '@/app/actions/members';
import { Alert } from '@/components/ui/states';
import { TemporaryPasswordCard } from '@/components/accounts/TemporaryPassword';
import { Badge, Icon } from '@/components/ui/primitives';
import {
  Button,
  Field,
  Input,
  MoneyInput,
  PhoneInput,
  Select,
  SubmitButton,
  Textarea,
} from '@/components/ui/form';
import { formatDate, formatPhone, normaliseUgandanMobile, toISODate } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import { SAVINGS_FREQUENCY_ADVERB, categoryTier, qualificationWindow } from '@/lib/categories';
import { clsx } from '@/lib/clsx';
import { newIdempotencyKey, type ActionResult } from '@/lib/errors';
import type { SavingsCategoryRow, ShareCategoryRow } from '@/types/db';
import type { CollectionAccount, RegistrationFee } from '@/types/access';

export type RegistrationRules = {
  requireNationalId: boolean;
  requireDateOfBirth: boolean;
  requireGender: boolean;
  requireNextOfKin: boolean;
  requireCategories: boolean;
  activationRequiresFees: boolean;
  minAge: number;
};

type Values = {
  full_name: string;
  phone: string;
  email: string;
  national_id: string;
  date_of_birth: string;
  gender: string;
  address: string;
  occupation: string;
  next_of_kin_name: string;
  next_of_kin_relation: string;
  next_of_kin_phone: string;
  joined_on: string;
  share_category_id: string;
  savings_category_id: string;
  pay_now: 'yes' | 'no';
  channel: 'cash' | 'merchant' | 'bank' | '';
  account_id: string;
  bank_method: 'bank_transfer' | 'cheque';
  reference: string;
  paid_on: string;
  amount_received: number | null;
  allow_shared_phone: boolean;
  override_reason: string;
};

const STEPS = [
  { title: 'Member Information', short: 'Member', icon: 'person' },
  { title: 'Membership & Categories', short: 'Categories', icon: 'workspace_premium' },
  { title: 'Registration Fees', short: 'Fees', icon: 'receipt' },
  { title: 'Payment', short: 'Payment', icon: 'payments' },
  { title: 'Confirmation', short: 'Confirm', icon: 'task_alt' },
] as const;

/** Which step owns each field, so a server error lands the officer on it. */
const FIELD_STEP: Record<string, number> = {
  full_name: 0, phone: 0, email: 0, national_id: 0, date_of_birth: 0, gender: 0, address: 0,
  occupation: 0, next_of_kin_name: 0, next_of_kin_relation: 0, next_of_kin_phone: 0,
  joined_on: 0, override_reason: 0,
  share_category_id: 1, savings_category_id: 1,
  fees: 2,
  account_id: 3, method: 3, reference: 3, paid_on: 3, amount_received: 3,
};

const CHANNELS = [
  { id: 'cash', label: 'Cash', icon: 'payments', type: 'cash', hint: 'Counted at the office. Goes into Cash at Hand.' },
  { id: 'merchant', label: 'Merchant / Mobile Money', icon: 'smartphone', type: 'merchant', hint: 'Paid to the SACCO merchant code. Goes into Cash at Merchant.' },
  { id: 'bank', label: 'Bank', icon: 'account_balance', type: 'bank', hint: 'Deposited or transferred to the bank. Goes into Cash at Bank.' },
] as const;

/**
 * Register a member in five steps: who they are, their categories, the fees,
 * the payment, and a last look before anything is saved.
 *
 * Nothing is written until the final "Register member". Then one call does the
 * whole registration in one database transaction - member, categories, fee
 * charges, the payment into the chosen account, receipt, audit - so a failure
 * at any point leaves nothing half-made. Every figure on these screens comes
 * from Settings: the fees, the category amounts, the share price.
 */
export function RegistrationWizard({
  shareCategories,
  savingsCategories,
  fees,
  accounts,
  rules,
  canOverridePhone,
}: {
  shareCategories: ShareCategoryRow[];
  savingsCategories: SavingsCategoryRow[];
  fees: RegistrationFee[];
  accounts: CollectionAccount[];
  rules: RegistrationRules;
  canOverridePhone: boolean;
}) {
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [optional, setOptional] = useState<Set<string>>(new Set());
  const registrationKey = useRef<string>('');
  if (!registrationKey.current) registrationKey.current = newIdempotencyKey('register');

  const [v, setV] = useState<Values>(() => ({
    full_name: '', phone: '', email: '', national_id: '', date_of_birth: '', gender: '',
    address: '', occupation: '', next_of_kin_name: '', next_of_kin_relation: '',
    next_of_kin_phone: '', joined_on: toISODate(),
    share_category_id: '', savings_category_id: '',
    pay_now: 'yes', channel: '', account_id: '', bank_method: 'bank_transfer',
    reference: '', paid_on: toISODate(), amount_received: null,
    allow_shared_phone: false, override_reason: '',
  }));

  const [state, action] = useActionState<ActionResult<RegistrationOutcome> | null, FormData>(
    registerMember,
    null,
  );

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key as string]) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  };

  const mandatory = fees.filter((f) => f.is_mandatory);
  const charged = fees.filter((f) => f.is_mandatory || optional.has(f.id));
  const total = charged.reduce((sum, f) => sum + Number(f.amount), 0);
  const mandatoryTotal = mandatory.reduce((sum, f) => sum + Number(f.amount), 0);
  const payNow = v.pay_now === 'yes' && total > 0;

  const channelAccounts = useMemo(
    () => accounts.filter((a) => CHANNELS.find((c) => c.id === v.channel)?.type === a.account_type),
    [accounts, v.channel],
  );

  // Choosing a channel picks its default account; the officer can change it.
  useEffect(() => {
    if (!v.channel) return;
    if (channelAccounts.some((a) => a.id === v.account_id)) return;
    const pick = channelAccounts.find((a) => a.is_default) ?? channelAccounts[0];
    set('account_id', pick?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.channel, channelAccounts]);

  // A server-side refusal names its field; take the officer to it.
  const serverError = state && !state.ok ? state : null;
  const [phoneClash, setPhoneClash] = useState(false);
  useEffect(() => {
    if (!serverError) return;
    const field = serverError.field;
    if (field && FIELD_STEP[field] !== undefined) {
      setErrors({ [field]: serverError.error });
      setStep(FIELD_STEP[field]);
      if (field === 'phone' && /already the phone number/.test(serverError.error)) setPhoneClash(true);
    }
  }, [serverError]);

  if (state?.ok) return <Success result={state.data} />;

  /* ------------------------------------------------------------ validation */
  function validate(s: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (s === 0) {
      const name = v.full_name.trim().replace(/\s+/g, ' ');
      if (name.length < 3 || name.split(' ').length < 2) e.full_name = 'Enter the member’s full name - at least a first and a last name.';
      if (!v.phone.trim()) e.phone = 'Enter the member’s phone number. It is how they sign in.';
      else if (!normaliseUgandanMobile(v.phone)) e.phone = 'Enter a valid Ugandan mobile number, e.g. 0772 123 456.';
      if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) e.email = 'Enter a valid email address, or leave it blank.';
      if (rules.requireNationalId && !v.national_id.trim()) e.national_id = 'Enter the member’s National ID number.';
      if (rules.requireDateOfBirth && !v.date_of_birth) e.date_of_birth = 'Enter the member’s date of birth.';
      if (v.date_of_birth) {
        const dob = new Date(`${v.date_of_birth}T12:00:00`);
        const limit = new Date();
        limit.setFullYear(limit.getFullYear() - rules.minAge);
        if (dob > new Date()) e.date_of_birth = 'A date of birth cannot be in the future.';
        else if (rules.minAge > 0 && dob > limit) e.date_of_birth = `Members must be at least ${rules.minAge} years old to join.`;
      }
      if (rules.requireGender && !v.gender) e.gender = 'Choose the member’s gender.';
      if (rules.requireNextOfKin) {
        if (!v.next_of_kin_name.trim()) e.next_of_kin_name = 'Enter the next of kin’s name.';
        if (!v.next_of_kin_relation.trim()) e.next_of_kin_relation = 'Enter the relationship.';
        if (!v.next_of_kin_phone.trim()) e.next_of_kin_phone = 'Enter the next of kin’s phone number.';
      }
      if (v.next_of_kin_phone.trim() && !normaliseUgandanMobile(v.next_of_kin_phone)) e.next_of_kin_phone = 'Enter a valid Ugandan mobile number.';
      if (v.joined_on && v.joined_on > toISODate()) e.joined_on = 'The membership date cannot be in the future.';
      if (v.allow_shared_phone && v.override_reason.trim().length < 5) e.override_reason = 'Give a reason for letting two members share this number.';
    }
    if (s === 1 && rules.requireCategories) {
      if (!v.share_category_id) e.share_category_id = 'Choose the member’s share category.';
      if (!v.savings_category_id) e.savings_category_id = 'Choose the member’s savings category.';
    }
    if (s === 3 && payNow) {
      if (!v.channel) e.method = 'Choose how the member paid.';
      else if (!v.account_id) e.account_id = 'No account of this kind is set up. Choose another way, or record the payment later.';
      if ((v.channel === 'merchant' || v.channel === 'bank') && !v.reference.trim()) {
        e.reference = v.channel === 'merchant'
          ? 'Enter the mobile money transaction reference from the confirmation message.'
          : 'Enter the bank transfer or deposit slip reference.';
      }
      if (v.amount_received === null) e.amount_received = `Enter the amount received: ${formatUGX(total)}.`;
      else if (v.amount_received !== total) e.amount_received = `The amount received must equal the total due, ${formatUGX(total)}.`;
      if (v.paid_on > toISODate()) e.paid_on = 'A payment cannot be dated in the future.';
    }
    return e;
  }

  function next() {
    const e = validate(step);
    setErrors(e);
    if (Object.keys(e).length === 0) {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
      window.scrollTo?.({ top: 0, behavior: 'smooth' });
    }
  }

  function back() {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  }

  const share = shareCategories.find((c) => c.id === v.share_category_id);
  const savings = savingsCategories.find((c) => c.id === v.savings_category_id);
  const account = accounts.find((a) => a.id === v.account_id);
  const willBePending = rules.activationRequiresFees && mandatoryTotal > 0 && !payNow;

  return (
    <div className="mx-auto max-w-3xl">
      <Stepper step={step} onJump={(i) => i < step && setStep(i)} />

      <form action={action} className="mt-6" noValidate>
        {/* Everything the wizard collected, posted in one go at the end. */}
        <input type="hidden" name="registration_key" value={registrationKey.current} />
        {(
          ['full_name', 'phone', 'email', 'national_id', 'date_of_birth', 'gender', 'address', 'occupation',
           'next_of_kin_name', 'next_of_kin_relation', 'next_of_kin_phone', 'joined_on',
           'share_category_id', 'savings_category_id', 'reference', 'paid_on', 'override_reason'] as const
        ).map((k) => (
          <input key={k} type="hidden" name={k} value={v[k]} />
        ))}
        <input type="hidden" name="optional_fee_ids" value={[...optional].join(',')} />
        <input type="hidden" name="expected_total" value={total} />
        <input type="hidden" name="pay_now" value={payNow ? 'yes' : 'no'} />
        <input type="hidden" name="account_id" value={payNow ? v.account_id : ''} />
        <input
          type="hidden"
          name="method"
          value={!payNow ? '' : v.channel === 'cash' ? 'cash' : v.channel === 'merchant' ? 'mobile_money' : v.channel === 'bank' ? v.bank_method : ''}
        />
        <input type="hidden" name="amount_received" value={payNow && v.amount_received !== null ? v.amount_received : ''} />
        <input type="hidden" name="allow_shared_phone" value={v.allow_shared_phone ? 'on' : 'off'} />

        {serverError && (!serverError.field || FIELD_STEP[serverError.field] === undefined) ? (
          <div className="mb-5">
            <Alert tone="error" title="The member was not registered">
              {serverError.error}
            </Alert>
          </div>
        ) : null}

        {/* ------------------------------------------------ 1. Member */}
        {step === 0 ? (
          <div className="flex flex-col gap-6">
            <Section title="Personal information" icon="person">
              <Field label="Full name" htmlFor="full_name" required error={errors.full_name} hint="As written on the National ID.">
                <Input id="full_name" value={v.full_name} onChange={(e) => set('full_name', e.target.value)} autoComplete="off" autoCapitalize="words" invalid={!!errors.full_name} placeholder="e.g. John Bakenye" />
              </Field>
              <Field label="Phone number" htmlFor="phone" required error={errors.phone} hint="The member can sign in with this number or their member number, and a password they choose. 07XXXXXXXX or +2567XXXXXXXX.">
                <PhoneInput id="phone" value={v.phone} onChange={(e) => { set('phone', e.target.value); setPhoneClash(false); set('allow_shared_phone', false); }} invalid={!!errors.phone} />
              </Field>

              {phoneClash && canOverridePhone ? (
                <div className="bg-warning-container/40 flex flex-col gap-3 rounded-2xl p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={v.allow_shared_phone} onChange={(e) => set('allow_shared_phone', e.target.checked)} className="text-primary focus:ring-primary border-outline mt-0.5 h-5 w-5 shrink-0 rounded" />
                    <span className="text-body-md text-on-surface">
                      <strong>Allow two members to share this number.</strong> Only where SACCO policy allows it -
                      for example a spouse without a phone. The override and its reason are recorded.
                    </span>
                  </label>
                  {v.allow_shared_phone ? (
                    <Field label="Reason for the override" htmlFor="override_reason" required error={errors.override_reason}>
                      <Textarea id="override_reason" value={v.override_reason} onChange={(e) => set('override_reason', e.target.value)} maxLength={500} />
                    </Field>
                  ) : null}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Email address" htmlFor="email" error={errors.email} hint="Optional. Members do not need one.">
                  <Input id="email" type="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={v.email} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} />
                </Field>
                <Field label="National ID (NIN)" htmlFor="national_id" required={rules.requireNationalId} error={errors.national_id}>
                  <Input id="national_id" autoCapitalize="characters" spellCheck={false} value={v.national_id} onChange={(e) => set('national_id', e.target.value)} invalid={!!errors.national_id} placeholder="e.g. CM90012345ABCD" />
                </Field>
                <Field label="Date of birth" htmlFor="date_of_birth" required={rules.requireDateOfBirth} error={errors.date_of_birth}>
                  <Input id="date_of_birth" type="date" max={toISODate()} value={v.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} invalid={!!errors.date_of_birth} />
                </Field>
                <Field label="Gender" htmlFor="gender" required={rules.requireGender} error={errors.gender}>
                  <Select id="gender" value={v.gender} onChange={(e) => set('gender', e.target.value)} invalid={!!errors.gender}>
                    <option value="">{rules.requireGender ? 'Choose…' : 'Prefer not to say'}</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
              </div>
            </Section>

            <Section title="Address & work" icon="location_on">
              <Field label="Address / location" htmlFor="address">
                <Textarea id="address" maxLength={300} value={v.address} onChange={(e) => set('address', e.target.value)} placeholder="Village, parish, sub-county, district" />
              </Field>
              <Field label="Occupation" htmlFor="occupation">
                <Input id="occupation" maxLength={120} value={v.occupation} onChange={(e) => set('occupation', e.target.value)} placeholder="e.g. Trader, Farmer, Fisherman" />
              </Field>
            </Section>

            <Section title="Next of kin" icon="handshake" note={rules.requireNextOfKin ? 'Required by SACCO policy.' : 'Optional.'}>
              <Field label="Full name" htmlFor="next_of_kin_name" required={rules.requireNextOfKin} error={errors.next_of_kin_name}>
                <Input id="next_of_kin_name" autoCapitalize="words" maxLength={120} value={v.next_of_kin_name} onChange={(e) => set('next_of_kin_name', e.target.value)} invalid={!!errors.next_of_kin_name} />
              </Field>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Relationship" htmlFor="next_of_kin_relation" required={rules.requireNextOfKin} error={errors.next_of_kin_relation}>
                  <Input id="next_of_kin_relation" maxLength={60} value={v.next_of_kin_relation} onChange={(e) => set('next_of_kin_relation', e.target.value)} placeholder="e.g. Spouse" invalid={!!errors.next_of_kin_relation} />
                </Field>
                <Field label="Phone number" htmlFor="next_of_kin_phone" required={rules.requireNextOfKin} error={errors.next_of_kin_phone}>
                  <PhoneInput id="next_of_kin_phone" value={v.next_of_kin_phone} onChange={(e) => set('next_of_kin_phone', e.target.value)} invalid={!!errors.next_of_kin_phone} />
                </Field>
              </div>
            </Section>

            <Section title="Membership" icon="badge">
              <Field label="Membership date" htmlFor="joined_on" error={errors.joined_on} hint="Today, unless the member joined earlier. Share category deadlines count from this date.">
                <Input id="joined_on" type="date" max={toISODate()} value={v.joined_on} onChange={(e) => set('joined_on', e.target.value)} invalid={!!errors.joined_on} />
              </Field>
              <p className="text-body-md text-on-surface-variant">
                The member number is issued automatically when you finish, in the form BND-M-0000123.
              </p>
            </Section>
          </div>
        ) : null}

        {/* ------------------------------------------------ 2. Categories */}
        {step === 1 ? (
          <div className="flex flex-col gap-6">
            <Alert tone="info" title="Two separate choices">
              The share category is how many shares the member will own. The savings category is how much they save and how often. A member may, for example, hold Gold shares and save at the Diamond rate.
            </Alert>

            <Section title="Share category" icon="pie_chart" note={rules.requireCategories ? 'Required.' : 'Optional.'} error={errors.share_category_id}>
              {shareCategories.length === 0 ? (
                <p className="text-body-md text-on-surface-variant">No share categories are active. A manager can set them up under Categories.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Share category">
                  {shareCategories.map((c) => (
                    <ChoiceCard
                      key={c.id}
                      name="share-cat"
                      checked={v.share_category_id === c.id}
                      onSelect={() => set('share_category_id', c.id)}
                      icon={categoryTier(c.code).icon}
                      title={c.name}
                      value={c.required_amount !== null ? formatUGX(c.required_amount) : 'Share price not set'}
                      lines={[
                        `${c.required_shares} ${c.required_shares === 1 ? 'share' : 'shares'}${c.share_price ? ` × ${formatUGX(c.share_price)}` : ''}`,
                        qualificationWindow(c.qualification_months),
                      ]}
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section title="Savings category" icon="savings" note={rules.requireCategories ? 'Required.' : 'Optional.'} error={errors.savings_category_id}>
              {savingsCategories.length === 0 ? (
                <p className="text-body-md text-on-surface-variant">No savings categories are active. A manager can set them up under Categories.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Savings category">
                  {savingsCategories.map((c) => (
                    <ChoiceCard
                      key={c.id}
                      name="savings-cat"
                      checked={v.savings_category_id === c.id}
                      onSelect={() => set('savings_category_id', c.id)}
                      icon={categoryTier(c.code).icon}
                      title={c.name}
                      value={formatUGX(c.amount)}
                      lines={[`Saved ${SAVINGS_FREQUENCY_ADVERB[c.frequency]}`, c.description ?? '']}
                    />
                  ))}
                </div>
              )}
            </Section>
          </div>
        ) : null}

        {/* ------------------------------------------------ 3. Fees */}
        {step === 2 ? (
          <Section title="Registration fees" icon="receipt" error={errors.fees}>
            {fees.length === 0 ? (
              <Alert tone="info" title="No registration fees are set up">
                Nothing will be charged. Fees are created under{' '}
                <Link href="/staff/settings?section=fees" className="text-primary font-semibold underline">Settings → Fees</Link>.
              </Alert>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {fees.map((f) => {
                    const on = f.is_mandatory || optional.has(f.id);
                    return (
                      <li key={f.id}>
                        <label className={clsx('flex items-center gap-3 rounded-2xl p-3.5 transition-shadow', f.is_mandatory ? 'bg-surface-container shadow-neu-inset-sm' : 'bg-surface cursor-pointer shadow-neu-sm hover:shadow-card')}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={f.is_mandatory}
                            onChange={(e) =>
                              setOptional((prev) => {
                                const n = new Set(prev);
                                if (e.target.checked) n.add(f.id);
                                else n.delete(f.id);
                                return n;
                              })
                            }
                            className="text-primary focus:ring-primary border-outline h-5 w-5 shrink-0 rounded disabled:opacity-70"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="text-body-lg text-on-surface block font-semibold">{f.name}</span>
                            <span className="text-label-md text-on-surface-variant block font-normal">
                              {f.is_mandatory ? 'Mandatory' : 'Optional - tick if the member is taking it'}
                              {f.description ? ` · ${f.description}` : ''}
                            </span>
                          </span>
                          <span className="text-body-lg text-on-surface tabular shrink-0 font-semibold">{formatUGX(f.amount)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>

                <div className="bg-ink mt-4 flex items-center justify-between gap-4 rounded-2xl px-5 py-4 text-white shadow-neu-dark">
                  <span className="text-body-lg font-semibold">Total amount due</span>
                  <span className="text-display-currency tabular font-bold">{formatUGX(total)}</span>
                </div>
              </>
            )}
          </Section>
        ) : null}

        {/* ------------------------------------------------ 4. Payment */}
        {step === 3 ? (
          <div className="flex flex-col gap-6">
            {total === 0 ? (
              <Alert tone="info" title="Nothing to pay">
                No registration fee applies, so there is no payment to record. Continue to confirm the registration.
              </Alert>
            ) : (
              <>
                <Section title="When is the member paying?" icon="schedule">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="When is the member paying">
                    <ChoiceCard name="pay-now" checked={v.pay_now === 'yes'} onSelect={() => set('pay_now', 'yes')} icon="task_alt" title="Paying now" value={formatUGX(total)} lines={['Record the payment with the registration.']} />
                    <ChoiceCard
                      name="pay-now"
                      checked={v.pay_now === 'no'}
                      onSelect={() => set('pay_now', 'no')}
                      icon="pending_actions"
                      title="Paying later"
                      value="Owed"
                      lines={[
                        rules.activationRequiresFees && mandatoryTotal > 0
                          ? 'The member stays Pending until the mandatory fees are paid.'
                          : 'The fees are recorded as owed.',
                      ]}
                    />
                  </div>
                </Section>

                {payNow ? (
                  <Section title="Payment" icon="payments">
                    <Field label="How did the member pay?" htmlFor="channel-cash" required error={errors.method}>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Payment method">
                        {CHANNELS.map((c) => {
                          const available = accounts.some((a) => a.account_type === c.type);
                          return (
                            <ChoiceCard
                              key={c.id}
                              id={`channel-${c.id}`}
                              name="channel"
                              checked={v.channel === c.id}
                              onSelect={() => set('channel', c.id)}
                              icon={c.icon}
                              title={c.label}
                              value={available ? '' : 'Not set up'}
                              lines={[c.hint]}
                              disabled={!available}
                            />
                          );
                        })}
                      </div>
                    </Field>
                    {!accounts.length ? (
                      <Alert tone="warning">
                        No receiving accounts are set up. A manager adds them under Finance → Accounts &amp; Setup. Until then, choose “Paying later”.
                      </Alert>
                    ) : null}

                    {v.channel ? (
                      <>
                        {channelAccounts.length > 1 ? (
                          <Field label="Received into" htmlFor="account_id" required error={errors.account_id}>
                            <Select id="account_id" value={v.account_id} onChange={(e) => set('account_id', e.target.value)} invalid={!!errors.account_id}>
                              {channelAccounts.map((a) => (
                                <option key={a.id} value={a.id}>{accountLabel(a)}</option>
                              ))}
                            </Select>
                          </Field>
                        ) : account ? (
                          <p className="text-body-md text-on-surface-variant">
                            Received into <strong className="text-on-surface">{accountLabel(account)}</strong>.
                          </p>
                        ) : errors.account_id ? (
                          <Alert tone="error">{errors.account_id}</Alert>
                        ) : null}

                        {v.channel === 'bank' ? (
                          <Field label="Bank payment type" htmlFor="bank_method">
                            <Select id="bank_method" value={v.bank_method} onChange={(e) => set('bank_method', e.target.value as Values['bank_method'])}>
                              <option value="bank_transfer">Bank transfer / deposit</option>
                              <option value="cheque">Cheque</option>
                            </Select>
                          </Field>
                        ) : null}

                        {v.channel !== 'cash' ? (
                          <Field
                            label={v.channel === 'merchant' ? 'Mobile money transaction reference' : 'Bank reference or deposit slip number'}
                            htmlFor="reference"
                            required
                            error={errors.reference}
                            hint={v.channel === 'merchant' ? 'From the confirmation SMS. Recorded as typed - the system does not contact the provider.' : 'From the deposit slip or transfer confirmation.'}
                          >
                            <Input id="reference" value={v.reference} onChange={(e) => set('reference', e.target.value)} autoCapitalize="characters" spellCheck={false} className="tabular" invalid={!!errors.reference} placeholder={v.channel === 'merchant' ? 'e.g. MP240911.1234.A56789' : 'e.g. SLIP-004512'} />
                          </Field>
                        ) : null}

                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                          <Field label="Amount received" htmlFor="amount_received" required error={errors.amount_received} hint={`Total due: ${formatUGX(total)}.`}>
                            <MoneyInput id="amount_received" name="_amount_received_display" defaultValue={v.amount_received ?? undefined} onValueChange={(n) => set('amount_received', n)} invalid={!!errors.amount_received} />
                          </Field>
                          <Field label="Date paid" htmlFor="paid_on" error={errors.paid_on}>
                            <Input id="paid_on" type="date" max={toISODate()} value={v.paid_on} onChange={(e) => set('paid_on', e.target.value)} invalid={!!errors.paid_on} />
                          </Field>
                        </div>
                      </>
                    ) : null}
                  </Section>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {/* ------------------------------------------------ 5. Confirm */}
        {step === 4 ? (
          <div className="flex flex-col gap-6">
            <Section title="Check before registering" icon="fact_check">
              <dl className="divide-outline-variant/70 divide-y">
                <Row label="Full name" value={v.full_name.trim().replace(/\s+/g, ' ')} onEdit={() => setStep(0)} />
                <Row label="Phone" value={formatPhone(normaliseUgandanMobile(v.phone) ?? v.phone)} onEdit={() => setStep(0)} />
                {v.email ? <Row label="Email" value={v.email} onEdit={() => setStep(0)} /> : null}
                {v.national_id ? <Row label="National ID" value={v.national_id.toUpperCase()} onEdit={() => setStep(0)} /> : null}
                <Row label="Membership date" value={formatDate(v.joined_on)} onEdit={() => setStep(0)} />
                <Row label="Share category" value={share ? `${share.name} · ${share.required_shares} ${share.required_shares === 1 ? 'share' : 'shares'}` : 'Not chosen'} onEdit={() => setStep(1)} />
                <Row label="Savings category" value={savings ? `${savings.name} · ${formatUGX(savings.amount)} ${SAVINGS_FREQUENCY_ADVERB[savings.frequency]}` : 'Not chosen'} onEdit={() => setStep(1)} />
              </dl>
            </Section>

            <Section title="Registration fees" icon="receipt">
              {charged.length === 0 ? (
                <p className="text-body-md text-on-surface-variant">No fees are charged.</p>
              ) : (
                <div className="font-mono text-[14px]">
                  {charged.map((f) => (
                    <div key={f.id} className="flex justify-between gap-4 py-1">
                      <span className="text-on-surface">{f.name}</span>
                      <span className="tabular text-on-surface">{formatUGX(f.amount)}</span>
                    </div>
                  ))}
                  <div className="border-on-surface/40 mt-2 flex justify-between gap-4 border-t border-dashed pt-2 font-bold">
                    <span>TOTAL</span>
                    <span className="tabular">{formatUGX(total)}</span>
                  </div>
                </div>
              )}
              {total > 0 ? (
                <p className="text-body-md text-on-surface mt-3">
                  {payNow ? (
                    <>
                      Paid by <strong>{CHANNELS.find((c) => c.id === v.channel)?.label}</strong>
                      {account ? <> into <strong>{account.name}</strong></> : null}
                      {v.reference ? <>, ref <span className="font-mono">{v.reference}</span></> : null}.
                    </>
                  ) : (
                    <>Not paid now - the fees are recorded as owed.</>
                  )}
                </p>
              ) : null}
            </Section>

            {willBePending ? (
              <Alert tone="warning" title="The member will be Pending">
                Mandatory fees of {formatUGX(mandatoryTotal)} are unpaid. The member becomes active once they are paid or waived.
              </Alert>
            ) : (
              <Alert tone="success" title="The member will be active straight away" />
            )}
          </div>
        ) : null}

        {/* ------------------------------------------------ Navigation */}
        <div className="sticky-actions z-30 mt-8 flex gap-3">
          {step > 0 ? (
            <Button variant="outline" size="lg" className="flex-1" icon="arrow_back" onClick={back}>
              Back
            </Button>
          ) : (
            <Link
              href="/staff/members"
              className="text-primary bg-surface h-touch-target-primary text-button-text flex flex-1 items-center justify-center rounded-full font-semibold shadow-neu"
            >
              Cancel
            </Link>
          )}
          {step < STEPS.length - 1 ? (
            <Button size="lg" className="flex-[2]" iconEnd="arrow_forward" onClick={next}>
              Continue
            </Button>
          ) : (
            <SubmitButton size="lg" className="flex-[2]" pendingLabel="Registering…">
              Register member
            </SubmitButton>
          )}
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function accountLabel(a: CollectionAccount): string {
  const detail =
    a.account_type === 'merchant'
      ? [a.provider, a.merchant_code].filter(Boolean).join(' · ')
      : a.account_type === 'bank'
        ? [a.bank_name, a.account_number].filter(Boolean).join(' · ')
        : '';
  return detail ? `${a.name} (${detail})` : a.name;
}

function Stepper({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <nav aria-label="Registration steps">
      <p className="text-label-md text-on-surface-variant mb-2 font-semibold sm:hidden">
        Step {step + 1} of {STEPS.length} · {STEPS[step].title}
      </p>
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li key={s.title} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => onJump(i)}
                disabled={!done}
                aria-current={current ? 'step' : undefined}
                className={clsx(
                  'flex min-w-0 items-center gap-2 rounded-full transition-colors',
                  done && 'cursor-pointer',
                  !done && 'cursor-default',
                )}
              >
                <span
                  className={clsx(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold',
                    current && 'bg-ink text-white shadow-neu-dark',
                    done && 'bg-tertiary-container text-white',
                    !current && !done && 'bg-surface text-on-surface-variant shadow-neu-sm',
                  )}
                >
                  {done ? <Icon name="check" size={18} /> : i + 1}
                </span>
                <span
                  className={clsx(
                    'hidden truncate text-[13px] font-semibold lg:inline',
                    current ? 'text-on-surface' : 'text-on-surface-variant',
                  )}
                >
                  {s.short}
                </span>
              </button>
              {i < STEPS.length - 1 ? (
                <span className={clsx('h-0.5 min-w-2 flex-1 rounded-full', i < step ? 'bg-tertiary' : 'bg-outline-variant')} />
              ) : null}
            </li>
          );
        })}
      </ol>
      <h2 className="text-title-md text-on-surface mt-4 hidden sm:block">
        {STEPS[step].title}
      </h2>
    </nav>
  );
}

function Section({
  title,
  icon,
  note,
  error,
  children,
}: {
  title: string;
  icon: string;
  note?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface shadow-neu overflow-hidden rounded-2xl">
      <header className="border-outline-variant/70 flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <h3 className="text-button-text text-on-surface flex items-center gap-2.5">
          <span className="bg-surface text-primary flex h-8 w-8 items-center justify-center rounded-xl shadow-neu-sm">
            <Icon name={icon} size={17} />
          </span>
          {title}
        </h3>
        {note ? <span className="text-label-md text-on-surface-variant font-normal">{note}</span> : null}
      </header>
      <div className="flex flex-col gap-5 p-5">
        {error ? (
          <p className="text-body-md text-error flex items-start gap-1.5" role="alert">
            <Icon name="error" size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : null}
        {children}
      </div>
    </section>
  );
}

function ChoiceCard({
  id,
  name,
  checked,
  onSelect,
  icon,
  title,
  value,
  lines,
  disabled,
}: {
  id?: string;
  name: string;
  checked: boolean;
  onSelect: () => void;
  icon: string;
  title: string;
  value: string;
  lines: string[];
  disabled?: boolean;
}) {
  return (
    <label
      className={clsx(
        'flex h-full cursor-pointer flex-col gap-2 rounded-2xl p-4 transition-[box-shadow,background-color]',
        checked ? 'bg-primary-fixed shadow-neu-inset ring-2 ring-primary/40' : 'bg-surface shadow-neu hover:shadow-card-hover',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className={clsx('flex h-9 w-9 items-center justify-center rounded-full', checked ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant')}>
          <Icon name={icon} size={18} />
        </span>
        <input
          id={id}
          type="radio"
          name={`_${name}`}
          checked={checked}
          disabled={disabled}
          onChange={onSelect}
          className="text-primary focus:ring-primary border-outline h-5 w-5"
        />
      </span>
      <span className="text-body-lg text-on-surface font-semibold">{title}</span>
      {value ? <span className="text-title-md text-primary tabular font-bold">{value}</span> : null}
      {lines.filter(Boolean).map((l) => (
        <span key={l} className="text-label-md text-on-surface-variant font-normal">
          {l}
        </span>
      ))}
    </label>
  );
}

function Row({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <dt className="text-label-md text-on-surface-variant font-normal">{label}</dt>
        <dd className="text-body-md text-on-surface break-words font-semibold">{value}</dd>
      </div>
      <button type="button" onClick={onEdit} className="text-primary text-label-md h-touch-target-min shrink-0 rounded-full px-3 font-semibold hover:bg-surface-container">
        Change
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function Success({ result }: { result: RegistrationOutcome }) {
  const paid = result.payment;
  return (
    <div className="animate-slide-up mx-auto flex max-w-lg flex-col items-center py-6 text-center">
      <div className="bg-tertiary-container mb-5 flex h-20 w-20 items-center justify-center rounded-full shadow-neu">
        <Icon name="check_circle" size={44} className="text-white" />
      </div>
      <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">Member Successfully Registered</h2>
      <p className="text-body-md text-on-surface-variant mt-2">{result.full_name}</p>

      <div className="bg-surface mt-6 w-full rounded-3xl p-5 text-left shadow-neu">
        <dl className="flex flex-col gap-4">
          <div>
            <dt className="text-label-md text-on-surface-variant font-normal">Member Number</dt>
            <dd className="text-headline-lg-mobile text-on-surface tabular select-all font-mono font-bold">{result.member_no}</dd>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-label-md text-on-surface-variant font-normal">Amount Paid</dt>
              <dd className="text-body-lg text-on-surface tabular font-semibold">{formatUGX(result.amount_paid)}</dd>
            </div>
            <div>
              <dt className="text-label-md text-on-surface-variant font-normal">Status</dt>
              <dd className="mt-0.5">
                <Badge tone={result.status === 'active' ? 'success' : 'info'} dot>
                  {result.status === 'active' ? 'Active' : 'Pending'}
                </Badge>
              </dd>
            </div>
          </div>
          {paid?.receipt_no ? (
            <div>
              <dt className="text-label-md text-on-surface-variant font-normal">Receipt</dt>
              <dd className="text-body-lg text-on-surface tabular select-all font-mono font-semibold">{paid.receipt_no}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-label-md text-on-surface-variant font-normal">Signs in with</dt>
            <dd className="text-body-md text-on-surface">
              Member number <span className="font-mono">{result.member_no}</span> or phone{' '}
              <span className="tabular">{formatPhone(result.phone)}</span>, and the temporary password below
            </dd>
          </div>
        </dl>
      </div>

      {result.total_due > result.amount_paid ? (
        <div className="mt-4 w-full text-left">
          <Alert tone="warning" title={`${formatUGX(result.total_due - result.amount_paid)} in fees is still owed`}>
            {result.status === 'pending'
              ? 'The member becomes active once the mandatory fees are paid or waived. Record the payment from their profile.'
              : 'Record the payment from their profile when it comes in.'}
          </Alert>
        </div>
      ) : null}
      {result.temporary ? (
        <div className="mt-4 w-full">
          <TemporaryPasswordCard temporary={result.temporary} who="the member" identifier={result.member_no} />
        </div>
      ) : null}
      {result.login_note ? (
        <div className="mt-4 w-full text-left">
          <Alert tone="info">{result.login_note}</Alert>
        </div>
      ) : null}

      <div className="mt-7 flex w-full flex-col gap-3">
        {paid ? (
          <Link
            href={`/staff/transactions/${paid.transaction_id}`}
            className="bg-ink h-touch-target-primary text-button-text flex items-center justify-center gap-2 rounded-full font-semibold text-white shadow-neu-dark"
          >
            <Icon name="receipt_long" size={20} />
            View &amp; print receipt
          </Link>
        ) : null}
        <Link
          href={`/staff/members/${result.member_id}`}
          className="text-primary bg-surface h-touch-target-primary text-button-text flex items-center justify-center rounded-full font-semibold shadow-neu"
        >
          Open member profile
        </Link>
        <a
          href="/staff/members/new"
          className="text-primary text-button-text h-touch-target-min flex items-center justify-center"
        >
          Register another member
        </a>
      </div>
    </div>
  );
}
