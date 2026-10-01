/**
 * The one source of truth for "where did this money go?" in the browser.
 *
 * Every screen that takes money used to ask "Payment method" and offer the same
 * four typed-in options — Cash, Mobile Money, Bank Transfer, Cheque. A method is
 * not a destination: it cannot say which merchant wallet took the money when the
 * SACCO runs an Airtel code today and an MTN code next month, and it cannot say
 * which bank account when there are two.
 *
 * So the question is now "Payment received into", and the options are the
 * SACCO's own active accounts, read from `collection_accounts()` by
 * `getCollectionAccounts()` (src/lib/access-queries.ts). Nothing in this file
 * names a provider or a bank: an Airtel code, an MTN code, a second Airtel code
 * or a Centenary account all appear because a manager created the row under
 * Finance → Accounts & Setup, and all disappear from new receipts the moment the
 * row stops being active. No application code changes for any of that.
 *
 * The method still travels to the database, because the ledger, the receipts and
 * forty-odd reports are keyed on it — but it is *derived* from the chosen
 * account rather than chosen separately, by the same rule the database uses
 * (`method_for_account_type`, 0027).
 */
import type { CollectionAccount } from '@/types/access';
import type { FinanceAccountType } from '@/types/treasury';
import type { PaymentMethod } from '@/types/db';

/** What the field is called wherever money is received. */
export const RECEIVING_LABEL = 'Payment received into';

/** What the field is called wherever money is paid out. */
export const PAYING_LABEL = 'Paid out of';

/**
 * The fields an account must carry to be named. Deliberately structural, so the
 * counter's `CollectionAccount` (no balance) and the finance screens'
 * `FinancialAccountBalanceRow` (with one) are named by the same function and an
 * account reads the same wherever it appears.
 */
export type NameableAccount = {
  name: string;
  account_type: FinanceAccountType;
  provider?: string | null;
  merchant_code?: string | null;
  account_identifier?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
};

/**
 * What one account is called in the selector.
 *
 *   Cash at Hand
 *   Airtel Merchant — 123456
 *   MTN Merchant — MTN Collections
 *   Centenary Bank — ••••4321
 *
 * A merchant account leads with its provider so "Airtel" and "MTN" read as the
 * SACCO's own two codes rather than one generic "Mobile Money"; a bank account
 * leads with the bank. The second half is whatever identifies that account to
 * the person at the counter: the merchant code, the wallet number, or the last
 * four digits of the account number. A full account number is never printed on a
 * counter screen.
 */
export function receivingAccountLabel(a: NameableAccount): string {
  if (a.account_type === 'merchant') {
    const head = a.provider?.trim() ? `${a.provider.trim()} Merchant` : a.name;
    const tail = a.merchant_code?.trim() || a.account_identifier?.trim() || a.name;
    return head === tail ? head : `${head} — ${tail}`;
  }
  if (a.account_type === 'bank') {
    const head = a.bank_name?.trim() || a.name;
    const tail = a.account_number?.trim() ? maskAccountNumber(a.account_number) : a.name;
    return head === tail ? head : `${head} — ${tail}`;
  }
  return a.name;
}

/** The last four digits only — the rest is not a counter's business. */
export function maskAccountNumber(number: string): string {
  const digits = number.replace(/\s+/g, '');
  return digits.length <= 4 ? digits : `••••${digits.slice(-4)}`;
}

/**
 * The payment method the chosen account implies.
 *
 * The same mapping as `method_for_account_type()` in 0027. A bank account can be
 * reached by transfer or by cheque, so that one stays a question.
 */
export function methodForAccount(
  a: Pick<NameableAccount, 'account_type'> | undefined,
  bankMethod: PaymentMethod = 'bank_transfer',
): PaymentMethod | '' {
  if (!a) return '';
  if (a.account_type === 'cash') return 'cash';
  if (a.account_type === 'merchant') return 'mobile_money';
  return bankMethod === 'cheque' ? 'cheque' : 'bank_transfer';
}

/**
 * Money that arrived through a merchant code or a bank happened somewhere else,
 * so there is a reference from that transfer to reconcile against later. Cash
 * counted in hand has none. `record_member_collection()` enforces the same rule.
 */
export function needsReference(a: Pick<NameableAccount, 'account_type'> | undefined): boolean {
  return a?.account_type === 'merchant' || a?.account_type === 'bank';
}

/** What to ask for, in the words of the account the money came through. */
export function referencePrompt(a: Pick<NameableAccount, 'account_type'> | undefined): string {
  if (a?.account_type === 'merchant') {
    return 'Enter the mobile money transaction reference from the confirmation message.';
  }
  if (a?.account_type === 'bank') return 'Enter the bank transfer or deposit slip reference.';
  return 'Optional — a receipt or voucher number.';
}

/**
 * The account a form opens on: the one a manager marked as the default,
 * otherwise cash (the usual answer at a counter), otherwise the first.
 *
 * Returns '' when the SACCO has no active account at all, which the field turns
 * into a warning pointing at the set-up screen rather than an empty list.
 */
export function defaultReceivingAccountId(
  accounts: CollectionAccount[],
  types?: FinanceAccountType[],
): string {
  const options = types ? accounts.filter((a) => types.includes(a.account_type)) : accounts;
  return (
    options.find((a) => a.is_default) ??
    options.find((a) => a.account_type === 'cash') ??
    options[0]
  )?.id ?? '';
}

/** The chosen account, by id. */
export function findAccount(
  accounts: CollectionAccount[],
  id: string,
): CollectionAccount | undefined {
  return accounts.find((a) => a.id === id);
}
