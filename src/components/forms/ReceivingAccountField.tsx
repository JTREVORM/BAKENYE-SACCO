'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Field, Input, Select } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import {
  PAYING_LABEL,
  RECEIVING_LABEL,
  defaultReceivingAccountId,
  findAccount,
  methodForAccount,
  needsReference,
  receivingAccountLabel,
  referencePrompt,
} from '@/lib/receiving-accounts';
import type { CollectionAccount } from '@/types/access';
import type { PaymentMethod } from '@/types/db';

/**
 * The one control, on every screen, for the account money moves through.
 *
 * It replaces the hard-coded "Payment method" list — Cash, Mobile Money, Bank
 * Transfer, Cheque — that used to be typed into each form separately. The
 * options are the SACCO's active `financial_accounts` rows, so a merchant code,
 * a second merchant code or a bank account added under Finance → Accounts &
 * Setup appears here with no code change, and an account that is suspended or
 * closed stops appearing for new entries while every transaction already posted
 * against it is left exactly as it is.
 *
 * The id posted under `account_id` is what the ledger posts against, so what the
 * person reads here and what Finance reconciles later are the same account. The
 * method still travels alongside it, because the ledger and the receipts are
 * keyed on it — but it is derived from the account by the same rule the database
 * uses, never asked for separately.
 */
export type ReceivingAccountState = {
  accounts: CollectionAccount[];
  accountId: string;
  setAccountId: (id: string) => void;
  bankMethod: PaymentMethod;
  setBankMethod: (m: PaymentMethod) => void;
  reference: string;
  setReference: (r: string) => void;
  account: CollectionAccount | undefined;
  /** The method the chosen account implies; '' while nothing is chosen. */
  method: PaymentMethod | '';
  requiresReference: boolean;
  /** How the choice reads on a confirmation step. */
  label: string;
  /** The one message a form shows before it will post. */
  validate: () => string | null;
};

/**
 * Hold the account choice for one form.
 *
 * The form owns the state so its confirmation step and its own validation can
 * read the same values the field is showing.
 */
export function useReceivingAccount(
  accounts: CollectionAccount[],
  direction: 'in' | 'out' = 'in',
): ReceivingAccountState {
  const [accountId, setAccountId] = useState(() => defaultReceivingAccountId(accounts));
  const [bankMethod, setBankMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');

  const account = useMemo(() => findAccount(accounts, accountId), [accounts, accountId]);
  const method = methodForAccount(account, bankMethod);
  const requiresReference = needsReference(account);

  return {
    accounts,
    accountId,
    setAccountId,
    bankMethod,
    setBankMethod,
    reference,
    setReference,
    account,
    method,
    requiresReference,
    label: account ? receivingAccountLabel(account) : '—',
    validate() {
      if (!accountId || !account) {
        return direction === 'out'
          ? 'Choose the account the money is paid out of.'
          : 'Choose the account the money was received into.';
      }
      if (requiresReference && !reference.trim()) return referencePrompt(account);
      return null;
    },
  };
}

/**
 * The account block: which account, how the bank was reached when it is a bank
 * account, and the provider's reference when the money arrived through someone
 * else's system.
 */
export function ReceivingAccountFields({
  state,
  idPrefix,
  direction = 'in',
  label,
  error,
}: {
  state: ReceivingAccountState;
  idPrefix: string;
  direction?: 'in' | 'out';
  label?: string;
  error?: string | null;
}) {
  const heading = label ?? (direction === 'out' ? PAYING_LABEL : RECEIVING_LABEL);
  const { accounts, account, accountId, requiresReference } = state;

  if (accounts.length === 0) {
    return (
      <Field label={heading} required>
        <input type="hidden" name="account_id" value="" />
        <input type="hidden" name="method" value="" />
        <Alert tone="warning" title="No active account is set up">
          {direction === 'out' ? 'Nothing can be paid out' : 'No money can be received'} until a
          manager adds the cash, merchant or bank account it goes through, under{' '}
          <Link href="/staff/finance/accounts" className="font-semibold underline">
            Finance → Accounts &amp; Setup
          </Link>
          .
        </Alert>
      </Field>
    );
  }

  return (
    <>
      {/* Derived from the account, never asked for separately. The database
          derives it again from the account it is given, so a tampered value
          cannot send money anywhere the chosen account does not reach. */}
      <input type="hidden" name="method" value={state.method} />

      <Field
        label={heading}
        htmlFor={`${idPrefix}-account`}
        required
        hint={
          direction === 'out'
            ? 'The account the money actually leaves. Finance balances follow this choice.'
            : 'The account that actually takes the money. Finance balances follow this choice.'
        }
        error={error}
      >
        <Select
          id={`${idPrefix}-account`}
          name="account_id"
          value={accountId}
          onChange={(e) => state.setAccountId(e.target.value)}
          invalid={!!error}
          required
        >
          {accountId === '' ? (
            <option value="" disabled>
              Choose an account…
            </option>
          ) : null}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {receivingAccountLabel(a)}
            </option>
          ))}
        </Select>
      </Field>

      {/* Bank money moves by transfer or by cheque; every other account has one
          way in and out, so this is the only method question left anywhere. */}
      {account?.account_type === 'bank' ? (
        <Field label="How the bank was used" htmlFor={`${idPrefix}-bank-method`} required>
          <Select
            id={`${idPrefix}-bank-method`}
            value={state.bankMethod}
            onChange={(e) => state.setBankMethod(e.target.value as PaymentMethod)}
          >
            <option value="bank_transfer">Bank transfer / deposit</option>
            <option value="cheque">Cheque</option>
          </Select>
        </Field>
      ) : null}

      <Field
        label={requiresReference ? 'Transaction reference' : 'Receipt reference'}
        htmlFor={`${idPrefix}-ref`}
        required={requiresReference}
        hint={
          requiresReference
            ? `${referencePrompt(account)} The same reference cannot be banked twice.`
            : 'Optional — a voucher or receipt number, if there is one.'
        }
      >
        <Input
          id={`${idPrefix}-ref`}
          name="external_ref"
          value={state.reference}
          onChange={(e) => state.setReference(e.target.value)}
          placeholder={requiresReference ? 'e.g. 1234567890' : 'Optional'}
          maxLength={80}
          autoComplete="off"
          className="tabular"
        />
      </Field>
    </>
  );
}
