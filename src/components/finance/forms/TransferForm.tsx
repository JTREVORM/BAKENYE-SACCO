'use client';

import { useState } from 'react';
import { createTransfer } from '@/app/actions/treasury';
import { FinancialForm, type FinancialSummaryLine } from '@/components/forms/FinancialForm';
import { Field, Input, MoneyInput, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { formatUGX } from '@/lib/money';
import { toISODate } from '@/lib/format';
import { TRANSFER_KIND_META } from '@/lib/treasury-format';
import { AccountSelect, AccountSummary, defaultAccountId, type AccountOption } from '../AccountSelect';
import { DocumentField, RecordedBy, beforeAfter, dateLine } from './fields';
import type { TransferKind } from '@/types/treasury';

/**
 * Move money between two of the SACCO's own accounts: merchant to bank, cash
 * to bank, bank to cash, bank to bank.
 *
 * One form for all four, because they are one operation - one ledger row that
 * credits the source and debits the destination in the same statement. It is
 * neither income nor expense, and total SACCO funds do not change; the
 * confirmation step says so, with both balances before and after.
 */
export function TransferForm({
  kind,
  accounts,
  recorderName,
  approvalNote,
  doneHref,
}: {
  kind: TransferKind;
  accounts: AccountOption[];
  recorderName: string;
  /** What happens after "confirm" for this user under the current settings. */
  approvalNote: string;
  doneHref: string;
}) {
  const meta = TRANSFER_KIND_META[kind];

  const [sourceId, setSourceId] = useState(() => defaultAccountId(accounts, meta.from));
  const [destinationId, setDestinationId] = useState(() =>
    defaultAccountId(accounts, meta.to, defaultAccountId(accounts, meta.from)),
  );
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(toISODate());
  const [sourceRef, setSourceRef] = useState('');
  const [destinationRef, setDestinationRef] = useState('');
  const [description, setDescription] = useState(meta.defaultDescription);
  const [purpose, setPurpose] = useState('');
  const [handledBy, setHandledBy] = useState(recorderName);
  const [notes, setNotes] = useState('');

  const source = accounts.find((a) => a.id === sourceId);
  const destination = accounts.find((a) => a.id === destinationId);
  const sourceBalance = Number(source?.balance ?? 0);
  const destinationBalance = Number(destination?.balance ?? 0);
  const exceeds = !!amount && !!source && amount > sourceBalance;

  function chooseSource(id: string) {
    setSourceId(id);
    if (id === destinationId) setDestinationId(defaultAccountId(accounts, meta.to, id));
  }

  function summary(): FinancialSummaryLine[] {
    return [
      { label: 'Transfer', value: meta.label },
      { label: 'Amount', value: formatUGX(amount), emphasis: true },
      { label: `From: ${source?.name ?? '—'}`, value: beforeAfter(sourceBalance, sourceBalance - (amount ?? 0)) },
      { label: `To: ${destination?.name ?? '—'}`, value: beforeAfter(destinationBalance, destinationBalance + (amount ?? 0)) },
      { label: 'Total SACCO funds', value: 'Unchanged - money moves between SACCO accounts' },
      { label: 'Date', value: dateLine(date) },
      ...(sourceRef.trim() ? [{ label: meta.sourceRefLabel, value: sourceRef.trim() }] : []),
      ...(destinationRef.trim() ? [{ label: meta.destinationRefLabel, value: destinationRef.trim() }] : []),
      ...(purpose.trim() ? [{ label: 'Purpose', value: purpose.trim() }] : []),
      ...(handledBy.trim() ? [{ label: meta.handledByLabel, value: handledBy.trim() }] : []),
      { label: 'Recorded by', value: recorderName },
      { label: 'Approval', value: approvalNote },
    ];
  }

  return (
    <FinancialForm
      submissionKind="request"
      action={createTransfer}
      idempotencyPrefix={`transfer-${kind}`}
      submitLabel={meta.title}
      draftLabel="Save as draft - do not submit yet"
      pendingLabel="Recording…"
      successTitle={(r) =>
        r.status === 'completed'
          ? 'Transfer completed'
          : r.status === 'draft'
            ? 'Draft saved'
            : 'Submitted for approval'
      }
      referenceLabel="Transfer number"
      confirmTitle={meta.title}
      confirmPrompt="Check both accounts and the references. Once completed, a transfer can only be corrected by a reversal."
      amount={() => amount}
      summary={summary}
      doneHref={doneHref}
      doneLabel="Back to transfers"
      receiptHref={(r) => (r.transaction_id ? `/staff/transactions/${r.transaction_id}` : null)}
      canConfirm={!!sourceId && !!destinationId && !!amount && !exceeds}
      validate={() => {
        if (!sourceId || !destinationId) return 'Choose both accounts.';
        if (sourceId === destinationId) return 'Choose two different accounts.';
        if (!amount || amount <= 0) return 'Enter the amount.';
        if (exceeds) return `${source?.name} holds ${formatUGX(sourceBalance)}. It cannot send ${formatUGX(amount)}.`;
        if (meta.sourceRefRequired && !sourceRef.trim()) return `Enter the ${meta.sourceRefLabel.toLowerCase()}.`;
        if (meta.destinationRefRequired && !destinationRef.trim()) return `Enter the ${meta.destinationRefLabel.toLowerCase()}.`;
        if (date > toISODate()) return 'A transfer cannot be dated in the future.';
        return null;
      }}
    >
      <div className="flex flex-col gap-5">
        <AccountSelect
          id="transfer-source"
          name="source_account_id"
          label="From (source account)"
          accounts={accounts}
          types={[meta.from]}
          value={sourceId}
          onChange={chooseSource}
        />
        <AccountSummary account={source} />

        <AccountSelect
          id="transfer-destination"
          name="destination_account_id"
          label="To (destination account)"
          accounts={accounts}
          types={[meta.to]}
          value={destinationId}
          onChange={setDestinationId}
          exclude={meta.from === meta.to ? sourceId : undefined}
        />
        <AccountSummary account={destination} />

        <Field
          label="Amount"
          htmlFor="transfer-amount"
          required
          error={exceeds ? `More than the ${formatUGX(sourceBalance)} in ${source?.name}.` : null}
          hint={source ? `${source.name} holds ${formatUGX(sourceBalance)}.` : undefined}
        >
          <MoneyInput id="transfer-amount" name="amount" value={amount ?? ''} onValueChange={setAmount} required invalid={exceeds} />
        </Field>

        <Field label="Date" htmlFor="transfer-date" required>
          <Input id="transfer-date" name="transfer_date" type="date" value={date} max={toISODate()}
            onChange={(e) => setDate(e.target.value)} required />
        </Field>

        <Field label={meta.sourceRefLabel} htmlFor="transfer-source-ref" required={meta.sourceRefRequired}
          hint="Recorded as typed. The same reference cannot be used twice on an account.">
          <Input id="transfer-source-ref" name="source_reference" value={sourceRef}
            onChange={(e) => setSourceRef(e.target.value)} maxLength={80} autoComplete="off" className="tabular" />
        </Field>

        <Field label={meta.destinationRefLabel} htmlFor="transfer-destination-ref" required={meta.destinationRefRequired}>
          <Input id="transfer-destination-ref" name="destination_reference" value={destinationRef}
            onChange={(e) => setDestinationRef(e.target.value)} maxLength={80} autoComplete="off" className="tabular" />
        </Field>

        {meta.showPurpose ? (
          <Field label="Purpose" htmlFor="transfer-purpose" hint="What the cash is for. The withdrawal itself is not an expense - record the spending separately.">
            <Input id="transfer-purpose" name="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={300} />
          </Field>
        ) : null}

        <Field label="Description" htmlFor="transfer-description" required>
          <Textarea id="transfer-description" name="description" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>

        <Field label={meta.handledByLabel} htmlFor="transfer-handled-by" hint="The person who physically made the deposit or withdrawal.">
          <Input id="transfer-handled-by" name="handled_by" value={handledBy} onChange={(e) => setHandledBy(e.target.value)} maxLength={120} />
        </Field>

        <DocumentField />

        <Field label="Notes" htmlFor="transfer-notes">
          <Textarea id="transfer-notes" name="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>

        <RecordedBy name={recorderName} />

        <Alert tone="info">
          Internal transfer - not income, not an expense, and not member savings. Total SACCO
          funds stay the same. {approvalNote}
        </Alert>
      </div>
    </FinancialForm>
  );
}
