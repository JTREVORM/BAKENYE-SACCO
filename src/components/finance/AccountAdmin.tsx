'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveFinancialAccount, setFinancialAccountStatus } from '@/app/actions/treasury';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Input, MoneyInput, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { toISODate } from '@/lib/format';
import { ACCOUNT_TYPE_META } from '@/lib/treasury-format';
import type { ActionResult } from '@/lib/errors';
import type { FinanceAccountStatus, FinanceAccountType, FinancialAccountBalanceRow } from '@/types/treasury';

/**
 * Create or edit a merchant, bank or cash account.
 *
 * Nothing about a real account is assumed: the provider, merchant code, bank,
 * branch and account number are typed by the manager setting it up. The
 * opening balance is editable only until the first entry posts against the
 * account - after that the balance is whatever the ledger says.
 */
export function AccountFormButton({
  account,
  defaultType = 'bank',
  label,
  variant = 'primary',
}: {
  account?: FinancialAccountBalanceRow;
  defaultType?: FinanceAccountType;
  label: string;
  variant?: 'primary' | 'outline' | 'ghost';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FinanceAccountType>(account?.account_type ?? defaultType);
  const [state, action] = useActionState<ActionResult<{ id: string; name: string }> | null, FormData>(
    saveFinancialAccount,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const err = state && !state.ok ? state : null;
  const locked = (account?.entry_count ?? 0) > 0;
  const fieldError = (f: string) => (err?.field === f ? err.error : null);

  return (
    <>
      <Button variant={variant} size="sm" icon={account ? 'edit' : 'add'} onClick={() => setOpen(true)}>
        {label}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={account ? `Edit ${account.name}` : 'Set up an account'}
        description={account ? `${account.code} · ${ACCOUNT_TYPE_META[account.account_type].label}` : 'A real place the SACCO holds money.'}
        size="lg"
      >
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success">{state.message}</Alert>
            <Button size="lg" block onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-5" noValidate>
            {account ? <input type="hidden" name="id" value={account.id} /> : null}
            {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

            {account ? (
              <input type="hidden" name="account_type" value={type} />
            ) : (
              <Field label="Kind of account" htmlFor="acct-type" required>
                <Select id="acct-type" name="account_type" value={type} onChange={(e) => setType(e.target.value as FinanceAccountType)}>
                  <option value="merchant">Cash at Merchant - merchant code / mobile money</option>
                  <option value="bank">Cash at Bank - a bank account</option>
                  <option value="cash">Cash at Hand - physical cash</option>
                </Select>
              </Field>
            )}

            <Field label="Account name" htmlFor="acct-name" required error={fieldError('name')}
              hint={type === 'merchant' ? 'e.g. Bakenye SACCO Merchant' : type === 'bank' ? 'e.g. Bakenye SACCO Main Account' : 'e.g. Cash at Hand'}>
              <Input id="acct-name" name="name" defaultValue={account?.name} maxLength={120} required />
            </Field>

            {type === 'merchant' ? (
              <>
                <Field label="Provider" htmlFor="acct-provider" required error={fieldError('provider')}>
                  <Input id="acct-provider" name="provider" defaultValue={account?.provider ?? ''} maxLength={120}
                    list="acct-provider-options" placeholder="e.g. MTN Mobile Money" />
                  <datalist id="acct-provider-options">
                    <option value="MTN Mobile Money" />
                    <option value="Airtel Money" />
                  </datalist>
                </Field>
                <Field label="Merchant code" htmlFor="acct-merchant-code" hint="As issued by the provider. Visible only to finance staff.">
                  <Input id="acct-merchant-code" name="merchant_code" defaultValue={account?.merchant_code ?? ''} maxLength={60} className="tabular" />
                </Field>
                <Field label="Phone or account identifier" htmlFor="acct-identifier">
                  <Input id="acct-identifier" name="account_identifier" defaultValue={account?.account_identifier ?? ''} maxLength={60} className="tabular" />
                </Field>
              </>
            ) : null}

            {type === 'bank' ? (
              <>
                <Field label="Bank" htmlFor="acct-bank" required error={fieldError('bank_name')}>
                  <Input id="acct-bank" name="bank_name" defaultValue={account?.bank_name ?? ''} maxLength={120} />
                </Field>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Field label="Account number" htmlFor="acct-number" required error={fieldError('account_number')}>
                    <Input id="acct-number" name="account_number" defaultValue={account?.account_number ?? ''} maxLength={60} className="tabular" />
                  </Field>
                  <Field label="Branch" htmlFor="acct-branch">
                    <Input id="acct-branch" name="branch" defaultValue={account?.branch ?? ''} maxLength={120} />
                  </Field>
                </div>
              </>
            ) : null}

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Opening balance" htmlFor="acct-opening"
                hint={locked ? 'Fixed - money has already moved through this account.' : 'The balance on the opening date.'}
                error={fieldError('opening_balance')}>
                <MoneyInput id="acct-opening" name="opening_balance" defaultValue={account ? Number(account.opening_balance) : 0} disabled={locked} />
              </Field>
              <Field label="Opening date" htmlFor="acct-opening-date" required>
                <Input id="acct-opening-date" name="opening_date" type="date" defaultValue={account?.opening_date ?? toISODate()} max={toISODate()} />
              </Field>
            </div>

            <label className="flex items-start gap-3 rounded-2xl bg-surface-container-low p-3.5 shadow-neu-inset-sm">
              <input type="checkbox" name="is_default" defaultChecked={account?.is_default ?? false}
                className="mt-0.5 h-5 w-5 rounded border-outline text-primary focus:ring-primary" />
              <span className="text-body-md text-on-surface">
                <span className="font-semibold">Default {ACCOUNT_TYPE_META[type].noun}</span>
                <span className="block text-label-md font-normal text-on-surface-variant">
                  Where {type === 'merchant' ? 'mobile money' : type === 'bank' ? 'bank transfers and cheques' : 'cash'} lands
                  when a screen does not ask which account.
                </span>
              </span>
            </label>

            <Field label="Description" htmlFor="acct-description">
              <Textarea id="acct-description" name="description" rows={2} defaultValue={account?.description ?? ''} maxLength={500} />
            </Field>

            {account ? (
              <Field label="Reason for the change" htmlFor="acct-reason" hint="Recorded in the audit log.">
                <Input id="acct-reason" name="reason" maxLength={500} />
              </Field>
            ) : null}

            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Saving…">
                {account ? 'Save changes' : 'Create account'}
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

/** Activate, deactivate or close an account - always with a reason. */
export function AccountStatusButton({ account }: { account: FinancialAccountBalanceRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult<{ id: string; status: string }> | null, FormData>(
    setFinancialAccountStatus,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const err = state && !state.ok ? state : null;
  const next: FinanceAccountStatus[] = (['active', 'inactive', 'closed'] as const).filter((s) => s !== account.status);

  return (
    <>
      <Button variant="ghost" size="sm" icon="toggle_on" onClick={() => setOpen(true)}>
        Status
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Change the status of ${account.name}`}
        description="An inactive account takes no new entries. A closed account must hold nothing.">
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success">{state.message}</Alert>
            <Button size="lg" block onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-5" noValidate>
            <input type="hidden" name="id" value={account.id} />
            {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}
            <Field label="New status" htmlFor="acct-status" required>
              <Select id="acct-status" name="status" defaultValue={next[0]}>
                {next.map((s) => (
                  <option key={s} value={s}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason" htmlFor="acct-status-reason" required error={err?.field === 'reason' ? err.error : null}>
              <Textarea id="acct-status-reason" name="reason" rows={2} maxLength={500} required />
            </Field>
            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Saving…">
                Change status
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
