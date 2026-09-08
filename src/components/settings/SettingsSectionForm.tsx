'use client';

import { useActionState, useMemo, useRef, useState } from 'react';
import { updateSettings } from '@/app/actions/settings';
import { Icon } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Input, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { clsx } from '@/lib/clsx';
import type { ActionResult } from '@/lib/errors';
import type { SettingValue, SystemSettingRow } from '@/types/db';

/**
 * One category of settings, rendered from the registry.
 *
 * The form is generated from the rows themselves — their declared type decides
 * the control, their unit decides the affix, their bounds decide the `min` and
 * `max`, and their help text is printed under the field. Nothing about the
 * share of the SACCO's rules that this screen can edit is written here, which
 * is the point: adding a setting to the database adds a field to this screen,
 * and no TypeScript changes at all.
 *
 * Two behaviours are worth naming.
 *
 *  - Only what changed is sent. The form tracks its own dirty fields and the
 *    server action drops anything matching what is already stored, so pressing
 *    Save without editing writes nothing and audits nothing.
 *
 *  - A change to a setting the registry marks critical is confirmed first, in a
 *    dialog that names the old value and the new one. Raising a fee is not a
 *    thing to do by mis-clicking, and "you are changing the registration fee
 *    from UGX 20,000 to UGX 50,000" is a sentence that stops the wrong hand.
 */
export function SettingsSectionForm({
  rows,
  canManage,
  title,
  description,
}: {
  rows: SystemSettingRow[];
  canManage: boolean;
  title: string;
  description?: string;
}) {
  const [state, action] = useActionState<ActionResult<{ changed: string[] }> | null, FormData>(
    updateSettings,
    null,
  );

  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<Record<string, SettingValue>>(() => initialDraft(rows));
  const [confirming, setConfirming] = useState(false);

  // What the administrator has actually altered, against what is stored.
  const changed = useMemo(
    () => rows.filter((row) => hasChanged(row.value, draft[row.key])),
    [rows, draft],
  );
  const criticalChanges = changed.filter((row) => row.is_critical);

  const err = state && !state.ok ? state : null;

  function set(key: string, value: SettingValue) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  /**
   * Submitting goes through the confirmation dialog when a critical value has
   * moved. The dialog's own button then submits the real form, so there is one
   * submit path and one set of form values, not two that can diverge.
   */
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (criticalChanges.length > 0 && !confirming) {
      event.preventDefault();
      setConfirming(true);
    }
  }

  return (
    <>
      <form ref={formRef} action={action} onSubmit={onSubmit} className="space-y-5">
        <div>
          <h3 className="text-title-md text-on-surface">{title}</h3>
          {description ? (
            <p className="mt-1 text-label-md font-normal leading-relaxed text-on-surface-variant">
              {description}
            </p>
          ) : null}
        </div>

        {state?.ok ? <Alert tone="success">{state.message}</Alert> : null}
        {err ? <Alert tone="error">{err.error}</Alert> : null}

        <div className="grid grid-cols-1 gap-x-gutter gap-y-5 md:grid-cols-2">
          {rows.map((row) => (
            <SettingField
              key={row.key}
              row={row}
              value={draft[row.key]}
              onChange={(v) => set(row.key, v)}
              disabled={!canManage}
              invalid={err?.field === row.key}
              error={err?.field === row.key ? err.error : null}
            />
          ))}
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-outline-variant/70 pt-4">
            <SubmitButton disabled={changed.length === 0} pendingLabel="Saving…">
              {changed.length === 0
                ? 'No changes'
                : `Save ${changed.length} change${changed.length === 1 ? '' : 's'}`}
            </SubmitButton>

            {changed.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDraft(initialDraft(rows))}
              >
                Discard
              </Button>
            ) : null}

            {criticalChanges.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-label-md font-semibold text-warning">
                <Icon name="warning" size={16} />
                {criticalChanges.length} of these affects money
              </span>
            ) : null}
          </div>
        ) : (
          <Alert tone="info">
            These values are shown for reference. Changing them needs the settings permission.
          </Alert>
        )}
      </form>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Confirm these changes"
        description="These settings decide what members are charged. Existing records are not affected."
      >
        <div className="space-y-4">
          <ul className="space-y-2.5">
            {changed.map((row) => (
              <li
                key={row.key}
                className="rounded-2xl bg-surface-container p-3.5 shadow-neu-inset-sm"
              >
                <p className="text-body-md font-semibold text-on-surface">
                  {row.label}
                  {row.is_critical ? (
                    <span className="ml-2 align-middle text-label-md font-semibold text-warning">
                      affects money
                    </span>
                  ) : null}
                </p>
                <p className="tabular mt-1 flex flex-wrap items-center gap-2 text-body-md">
                  <span className="text-on-surface-variant line-through">
                    {display(row, row.value)}
                  </span>
                  <Icon name="arrow_forward" size={14} className="text-on-surface-variant" />
                  <span className="font-semibold text-on-surface">
                    {display(row, draft[row.key])}
                  </span>
                </p>
              </li>
            ))}
          </ul>

          <Alert tone="info">
            This changes what happens from now on. Transactions, loans and share purchases already
            recorded keep the figures they were made at.
          </Alert>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Go back
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirming(false);
                // `requestSubmit` runs the submit handler, which now lets it
                // through because `confirming` has been cleared.
                formRef.current?.requestSubmit();
              }}
            >
              Yes, save these changes
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * One field, chosen by the setting's declared type.
 *
 * Booleans and multi-selects post a `:present` marker alongside the value. A
 * checkbox that is off posts nothing at all, which is indistinguishable from a
 * field the form never rendered — and the difference matters, because one means
 * "set this to false" and the other means "leave this alone".
 */
function SettingField({
  row,
  value,
  onChange,
  disabled,
  invalid,
  error,
}: {
  row: SystemSettingRow;
  value: SettingValue;
  onChange: (value: SettingValue) => void;
  disabled: boolean;
  invalid: boolean;
  error: string | null;
}) {
  const name = `setting:${row.key}`;
  const id = `field-${row.key.replace(/\./g, '-')}`;
  const dirty = hasChanged(row.value, value);

  const hint = [
    row.description,
    row.min_value !== null || row.max_value !== null
      ? boundsHint(row)
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const label = (
    <span className="inline-flex items-center gap-2">
      {row.label}
      {dirty ? (
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" aria-label="Changed" />
      ) : null}
    </span>
  );

  if (row.value_type === 'boolean') {
    const on = value === true;
    return (
      <div className={clsx('md:col-span-2', dirty && 'rounded-2xl')}>
        <input type="hidden" name={`${name}:present`} value="1" />
        <label
          htmlFor={id}
          className="flex cursor-pointer items-start gap-3 rounded-2xl bg-surface-container p-3.5 shadow-neu-inset-sm"
        >
          <input
            id={id}
            name={name}
            type="checkbox"
            checked={on}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-0 bg-surface text-primary shadow-neu-sm focus:ring-2 focus:ring-primary/40"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-body-md font-semibold text-on-surface">
              {row.label}
              {dirty ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
              {row.is_critical ? (
                <Icon name="warning" size={14} className="text-warning" />
              ) : null}
            </span>
            {row.description ? (
              <span className="mt-0.5 block text-label-md font-normal leading-relaxed text-on-surface-variant">
                {row.description}
              </span>
            ) : null}
          </span>
        </label>
        {error ? (
          <p className="mt-1.5 flex items-start gap-1 text-body-md text-error">
            <Icon name="error" size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (row.value_type === 'multiselect') {
    const chosen = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="md:col-span-2">
        <input type="hidden" name={`${name}:present`} value="1" />
        <Field label={row.label} hint={hint || undefined} error={error}>
          <div className="flex flex-wrap gap-2">
            {(row.options ?? []).map((option) => {
              const on = chosen.includes(option.value);
              return (
                <label
                  key={option.value}
                  className={clsx(
                    'inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-label-md font-semibold transition-shadow',
                    on
                      ? 'bg-primary text-on-primary shadow-card'
                      : 'bg-surface text-on-surface-variant shadow-neu-sm hover:shadow-card',
                    disabled && 'pointer-events-none opacity-60',
                  )}
                >
                  <input
                    type="checkbox"
                    name={name}
                    value={option.value}
                    checked={on}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...chosen, option.value]
                          : chosen.filter((v) => v !== option.value),
                      )
                    }
                    className="sr-only"
                  />
                  {on ? <Icon name="check" size={14} /> : null}
                  {option.label}
                </label>
              );
            })}
          </div>
        </Field>
      </div>
    );
  }

  if (row.value_type === 'select') {
    return (
      <Field label={row.label} htmlFor={id} hint={hint || undefined} error={error}>
        <Select
          id={id}
          name={name}
          value={String(value ?? '')}
          disabled={disabled}
          invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        >
          {(row.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  if (row.value_type === 'text') {
    const long = String(value ?? '').length > 60;
    return (
      <div className={clsx(long && 'md:col-span-2')}>
        <Field label={row.label} htmlFor={id} hint={hint || undefined} error={error}>
          {long ? (
            <Textarea
              id={id}
              name={name}
              rows={2}
              value={String(value ?? '')}
              disabled={disabled}
              invalid={invalid}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <Input
              id={id}
              name={name}
              value={String(value ?? '')}
              disabled={disabled}
              invalid={invalid}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </Field>
      </div>
    );
  }

  // money, number, integer, percent
  return (
    <Field
      label={row.label}
      htmlFor={id}
      hint={hint || undefined}
      error={error}
    >
      <div className="relative">
        {row.value_type === 'money' ? (
          <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-body-lg font-semibold text-on-surface-variant">
            UGX
          </span>
        ) : null}
        <Input
          id={id}
          name={name}
          type="number"
          inputMode={row.value_type === 'integer' ? 'numeric' : 'decimal'}
          step={row.value_type === 'integer' ? 1 : 'any'}
          min={row.min_value ?? undefined}
          max={row.max_value ?? undefined}
          value={value === undefined || value === null ? '' : String(value)}
          disabled={disabled}
          invalid={invalid}
          onChange={(e) =>
            onChange(e.target.value === '' ? 0 : Number(e.target.value))
          }
          className={clsx(
            'tabular',
            row.value_type === 'money' && 'pl-16',
            (row.value_type === 'percent' || row.unit) && 'pr-16',
          )}
        />
        {row.value_type === 'percent' || (row.unit && row.value_type !== 'money') ? (
          <span className="pointer-events-none absolute right-5 top-1/2 max-w-[5.5rem] -translate-y-1/2 truncate text-label-md font-semibold text-on-surface-variant">
            {row.value_type === 'percent' ? '%' : row.unit}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

/* ------------------------------------------------------------------------ */

function initialDraft(rows: SystemSettingRow[]): Record<string, SettingValue> {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function hasChanged(current: SettingValue, next: SettingValue | undefined): boolean {
  if (next === undefined) return false;
  if (Array.isArray(current) || Array.isArray(next)) {
    const a = (Array.isArray(current) ? current : []).map(String).slice().sort();
    const b = (Array.isArray(next) ? next : []).map(String).slice().sort();
    return a.length !== b.length || a.some((v, i) => v !== b[i]);
  }
  return current !== next;
}

function boundsHint(row: SystemSettingRow): string {
  const unit = row.value_type === 'percent' ? '%' : row.unit ? ` ${row.unit}` : '';
  const fmt = (n: number) =>
    `${row.value_type === 'money' ? 'UGX ' : ''}${n.toLocaleString('en-UG')}${
      row.value_type === 'money' ? '' : unit
    }`;

  if (row.min_value !== null && row.max_value !== null) {
    return `Between ${fmt(row.min_value)} and ${fmt(row.max_value)}.`;
  }
  if (row.min_value !== null) return `At least ${fmt(row.min_value)}.`;
  if (row.max_value !== null) return `At most ${fmt(row.max_value)}.`;
  return '';
}

/** The same rendering the audit log uses, so the two read alike. */
function display(row: SystemSettingRow, value: SettingValue | undefined): string {
  if (value === undefined || value === null) return '—';
  switch (row.value_type) {
    case 'boolean':
      return value ? 'On' : 'Off';
    case 'money':
      return `UGX ${Number(value).toLocaleString('en-UG')}`;
    case 'percent':
      return `${Number(value)}%`;
    case 'integer':
    case 'number':
      return `${Number(value).toLocaleString('en-UG')}${row.unit ? ` ${row.unit}` : ''}`;
    case 'select':
      return row.options?.find((o) => o.value === String(value))?.label ?? String(value);
    case 'multiselect': {
      const chosen = Array.isArray(value) ? value.map(String) : [];
      if (chosen.length === 0) return 'None';
      return chosen.map((v) => row.options?.find((o) => o.value === v)?.label ?? v).join(', ');
    }
    default:
      return String(value);
  }
}
