'use client';

import Link from 'next/link';
import { Field, Select } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { ACCOUNT_TYPE_META } from '@/lib/treasury-format';
import { formatUGX } from '@/lib/money';
import type { FinanceAccountType, FinancialAccountBalanceRow } from '@/types/treasury';

export type AccountOption = Pick<
  FinancialAccountBalanceRow,
  | 'id'
  | 'code'
  | 'name'
  | 'account_type'
  | 'balance'
  | 'is_default'
  | 'status'
  | 'provider'
  | 'merchant_code'
  | 'account_identifier'
  | 'bank_name'
  | 'account_number'
>;

/** The account money of this kind lands in when nobody chooses: the default, or the first. */
export function defaultAccountId(
  accounts: AccountOption[],
  type: FinanceAccountType,
  exclude?: string,
): string {
  const options = accounts.filter(
    (a) => a.account_type === type && a.status === 'active' && a.id !== exclude,
  );
  return (options.find((a) => a.is_default) ?? options[0])?.id ?? '';
}

/**
 * Choose one of the SACCO's accounts.
 *
 * Only active accounts of the allowed kinds are offered, each with its live
 * balance. When none exists the control says so and points at the set-up
 * screen, instead of offering an empty list that looks like a bug.
 */
export function AccountSelect({
  id,
  name,
  label,
  accounts,
  types,
  value,
  onChange,
  exclude,
  hint,
  error,
  required = true,
}: {
  id: string;
  name: string;
  label: string;
  accounts: AccountOption[];
  types: FinanceAccountType[];
  value: string;
  onChange: (id: string) => void;
  exclude?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
}) {
  const options = accounts.filter(
    (a) => types.includes(a.account_type) && a.status === 'active' && a.id !== exclude,
  );

  if (options.length === 0) {
    const kinds = types.map((t) => ACCOUNT_TYPE_META[t].noun).join(' or ');
    return (
      <Field label={label} required={required}>
        <input type="hidden" name={name} value="" />
        <Alert tone="warning" title={`No active ${kinds} is set up`}>
          Nothing can be recorded against one until a manager adds it under{' '}
          <Link href="/staff/finance/accounts" className="font-semibold underline">
            Finance → Accounts &amp; Setup
          </Link>
          .
        </Alert>
      </Field>
    );
  }

  return (
    <Field label={label} htmlFor={id} required={required} hint={hint} error={error}>
      <Select
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        invalid={!!error}
        required={required}
      >
        {value === '' ? (
          <option value="" disabled>
            Choose an account…
          </option>
        ) : null}
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {formatUGX(a.balance)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** A small read-only card describing the chosen account. */
export function AccountSummary({ account }: { account: AccountOption | undefined }) {
  if (!account) return null;
  const meta = ACCOUNT_TYPE_META[account.account_type];
  const detail =
    account.account_type === 'merchant'
      ? [account.provider, account.merchant_code ? `Merchant code ${account.merchant_code}` : null]
      : account.account_type === 'bank'
        ? [account.bank_name, account.account_number ? `A/C ${account.account_number}` : null]
        : [account.code];

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface-container-low p-3 shadow-neu-inset-sm">
      <span
        aria-hidden="true"
        className={`h-9 w-1.5 shrink-0 rounded-full ${meta.stripe}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-md font-semibold text-on-surface">
          {meta.label} · {account.name}
        </p>
        <p className="truncate text-label-md font-normal text-on-surface-variant">
          {detail.filter(Boolean).join(' · ') || meta.subtitle}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-label-md font-normal text-on-surface-variant">Balance</p>
        <p className="tabular text-body-md font-bold text-on-surface">{formatUGX(account.balance)}</p>
      </div>
    </div>
  );
}
