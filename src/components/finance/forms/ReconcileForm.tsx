'use client';

import { useState } from 'react';
import { recordReconciliation } from '@/app/actions/treasury';
import { FinancialForm, type FinancialSummaryLine } from '@/components/forms/FinancialForm';
import { Field, Input, MoneyInput, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { formatUGX } from '@/lib/money';
import { toISODate } from '@/lib/format';
import { ACCOUNT_TYPE_META } from '@/lib/treasury-format';
import { AccountSelect, AccountSummary, type AccountOption } from '../AccountSelect';
import { DocumentField, RecordedBy, dateLine } from './fields';

/**
 * Compare what the system says an account holds with what is actually there:
 * the merchant wallet balance, the bank statement, the counted cash.
 *
 * A difference is recorded with its reason. It is never "fixed" by moving the
 * system balance - if money is genuinely missing or extra, that is a separate,
 * visible entry somebody has to own.
 */
export function ReconcileForm({
  accounts,
  initialAccountId,
  recorderName,
  doneHref,
}: {
  accounts: AccountOption[];
  initialAccountId?: string;
  recorderName: string;
  doneHref: string;
}) {
  const usable = accounts.filter((a) => a.status !== 'closed');
  const [accountId, setAccountId] = useState(initialAccountId ?? usable[0]?.id ?? '');
  const [date, setDate] = useState(toISODate());
  const [actual, setActual] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [statementRef, setStatementRef] = useState('');
  const [notes, setNotes] = useState('');

  const account = usable.find((a) => a.id === accountId);
  const today = date === toISODate();
  const system = Number(account?.balance ?? 0);
  const variance = actual !== null && today ? actual - system : null;
  const actualLabel =
    account?.account_type === 'cash'
      ? 'Physical cash count'
      : account?.account_type === 'bank'
        ? 'Bank statement balance'
        : 'Actual merchant balance';

  function summary(): FinancialSummaryLine[] {
    return [
      { label: 'Account', value: account ? `${account.name} (${ACCOUNT_TYPE_META[account.account_type].label})` : '—' },
      { label: 'As at', value: dateLine(date) },
      { label: 'System balance', value: today ? formatUGX(system) : 'Calculated as at the end of that day' },
      { label: actualLabel, value: formatUGX(actual), emphasis: true },
      ...(variance !== null
        ? [{ label: 'Variance', value: variance === 0 ? 'None - reconciled' : formatUGX(variance), emphasis: variance !== 0 }]
        : []),
      ...(reason.trim() ? [{ label: 'Reason', value: reason.trim() }] : []),
      { label: 'Reconciled by', value: recorderName },
    ];
  }

  return (
    <FinancialForm
      submissionKind="request"
      action={recordReconciliation}
      idempotencyPrefix="reconcile"
      submitLabel="Record reconciliation"
      pendingLabel="Recording…"
      successTitle={(r) => (r.outcome === 'reconciled' ? 'Account reconciled' : 'Variance recorded')}
      referenceLabel="Reconciliation number"
      confirmTitle={actualLabel}
      confirmPrompt="A variance is recorded with its reason. The system balance is not changed."
      amount={() => actual}
      summary={summary}
      doneHref={doneHref}
      doneLabel="Back to reconciliation"
      canConfirm={!!accountId && actual !== null}
      validate={() => {
        if (!accountId) return 'Choose the account.';
        if (actual === null) return `Enter the ${actualLabel.toLowerCase()}.`;
        if (variance !== null && variance !== 0 && reason.trim().length < 5)
          return `The actual balance differs by ${formatUGX(variance)}. Explain the variance.`;
        return null;
      }}
    >
      <div className="flex flex-col gap-5">
        <AccountSelect id="reconcile-account" name="account_id" label="Account" accounts={usable}
          types={['merchant', 'bank', 'cash']} value={accountId} onChange={setAccountId} />
        <AccountSummary account={account} />

        <Field label="As at" htmlFor="reconcile-date" required
          hint="The system balance is taken at the end of this day.">
          <Input id="reconcile-date" name="reconciliation_date" type="date" value={date} max={toISODate()}
            onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label={actualLabel} htmlFor="reconcile-actual" required>
          <MoneyInput id="reconcile-actual" name="actual_balance" value={actual ?? ''} onValueChange={setActual} />
        </Field>

        {variance !== null ? (
          variance === 0 ? (
            <Alert tone="success" title="Matches the system">
              The actual balance equals the system balance of {formatUGX(system)}.
            </Alert>
          ) : (
            <Alert tone="warning" title={`Variance of ${formatUGX(variance)}`}>
              The system says {formatUGX(system)}. The difference is recorded with the reason you give
              below; the system balance is not adjusted.
            </Alert>
          )
        ) : null}

        <Field label="Reason for any variance" htmlFor="reconcile-reason"
          required={variance !== null && variance !== 0}>
          <Textarea id="reconcile-reason" name="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            maxLength={1000} placeholder="e.g. Bank charges not yet recorded" />
        </Field>

        <Field label="Statement reference" htmlFor="reconcile-statement">
          <Input id="reconcile-statement" name="statement_reference" value={statementRef}
            onChange={(e) => setStatementRef(e.target.value)} maxLength={120} />
        </Field>

        <DocumentField label="Statement or count sheet" hint="PDF, JPEG, PNG or WebP, up to 5 MB." />

        <Field label="Notes" htmlFor="reconcile-notes">
          <Textarea id="reconcile-notes" name="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>

        <RecordedBy name={recorderName} />
      </div>
    </FinancialForm>
  );
}
