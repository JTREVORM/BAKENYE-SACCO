'use client';

import { useRef, useState } from 'react';
import { Field, Select } from '@/components/ui/form';
import { Icon } from '@/components/ui/primitives';
import { formatUGX } from '@/lib/money';
import { formatDate } from '@/lib/format';
import type { FinanceAccountType } from '@/types/treasury';
import type { PaymentMethod } from '@/types/db';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

/**
 * A deposit slip, transfer confirmation or a photo of one.
 *
 * The file travels with the form and is stored in the private finance bucket
 * once the entry it supports has been saved. Files over 5 MB are refused here,
 * before a phone spends minutes uploading something the server would reject.
 */
export function DocumentField({
  label = 'Supporting document',
  hint = 'Deposit slip, transfer confirmation or a photo of it. PDF, JPEG, PNG or WebP, up to 5 MB.',
}: {
  label?: string;
  hint?: string;
}) {
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  return (
    <Field label={label} htmlFor="finance-document" hint={hint} error={error}>
      <label
        htmlFor="finance-document"
        className="flex min-h-touch-target-primary cursor-pointer items-center gap-3 rounded-2xl bg-surface-container px-4 py-3 text-body-md text-on-surface shadow-neu-inset transition-shadow focus-within:ring-2 focus-within:ring-primary/40"
      >
        <Icon name={name ? 'attach_file' : 'upload_file'} size={20} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">{name ?? 'Choose a file (optional)'}</span>
        {name ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              if (input.current) input.current.value = '';
              setName(null);
            }}
            aria-label="Remove the file"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface"
          >
            <Icon name="close" size={18} />
          </button>
        ) : null}
      </label>
      <input
        ref={input}
        id="finance-document"
        name="document"
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && file.size > MAX_BYTES) {
            setError('That file is larger than 5 MB. Choose a smaller one, or a photo of the slip.');
            e.target.value = '';
            setName(null);
            return;
          }
          setError(null);
          setName(file?.name ?? null);
        }}
      />
    </Field>
  );
}

/** Bank money moves by transfer or by cheque; every other account has one method. */
export function BankMethodSelect({
  value,
  onChange,
  id = 'bank-method',
}: {
  value: PaymentMethod;
  onChange: (m: PaymentMethod) => void;
  id?: string;
}) {
  return (
    <Field label="Bank method" htmlFor={id} required>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value as PaymentMethod)}>
        <option value="bank_transfer">Bank transfer / deposit</option>
        <option value="cheque">Cheque</option>
      </Select>
    </Field>
  );
}

/** The method implied by the account money arrives in or leaves from. */
export function methodForAccountType(
  type: FinanceAccountType | undefined,
  bankMethod: PaymentMethod = 'bank_transfer',
): PaymentMethod {
  if (type === 'merchant') return 'mobile_money';
  if (type === 'cash') return 'cash';
  return bankMethod === 'cheque' ? 'cheque' : 'bank_transfer';
}

/** "UGX 150,000 → UGX 250,000" for the confirmation step. */
export function beforeAfter(before: number, after: number): string {
  return `${formatUGX(before)} → ${formatUGX(after)}`;
}

export function dateLine(value: string): string {
  return formatDate(value);
}

/** Who is recording this - shown, never typed, because it comes from the session. */
export function RecordedBy({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant shadow-neu-inset-sm">
      <Icon name="badge" size={18} className="shrink-0" />
      Recorded by <span className="font-semibold text-on-surface">{name}</span>
    </div>
  );
}
