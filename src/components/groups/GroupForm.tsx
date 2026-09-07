'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { createGroup, updateGroup } from '@/app/actions/groups';
import { MemberPicker, type PickedMember } from '@/components/forms/MemberPicker';
import { Alert } from '@/components/ui/states';
import {
  Field,
  Input,
  MoneyInput,
  Select,
  StickyActions,
  SubmitButton,
  Textarea,
} from '@/components/ui/form';
import { Icon } from '@/components/ui/primitives';
import { SAVING_DAYS, SAVING_FREQUENCY_LABELS, savingsKindFor } from '@/lib/groups';
import { formatUGX } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { ActionResult } from '@/lib/errors';
import type { GroupOverviewRow, SavingDay, SavingFrequency } from '@/types/db';

type GroupResult = { group_id: string; group_code: string; name: string };

/**
 * Create or edit a group.
 *
 * The saving day is the field this whole module turns on, so it is not a
 * dropdown buried among the others — it is a row of seven day chips, sized for
 * a thumb, that a field officer can set in one tap.
 */
export function GroupForm({
  group,
  officers,
  leader,
  secretary,
}: {
  group?: GroupOverviewRow;
  officers: { id: string; full_name: string; role: string }[];
  leader?: PickedMember | null;
  secretary?: PickedMember | null;
}) {
  const editing = !!group;
  const [state, formAction] = useActionState<ActionResult<GroupResult> | null, FormData>(
    editing ? updateGroup : createGroup,
    null,
  );

  const [day, setDay] = useState<SavingDay>(group?.saving_day ?? 1);
  const [frequency, setFrequency] = useState<SavingFrequency>(
    group?.saving_frequency ?? 'weekly',
  );
  const [weekly, setWeekly] = useState<number | null>(
    group ? Number(group.weekly_target) || null : null,
  );
  const [monthly, setMonthly] = useState<number | null>(
    group ? Number(group.monthly_target) || null : null,
  );

  const kind = savingsKindFor(frequency);
  const fieldError = (name: string) =>
    state && !state.ok && state.field === name ? state.error : null;

  if (state?.ok && !editing) {
    return (
      <div className="animate-slide-up flex flex-col items-center py-10 text-center">
        <div className="bg-tertiary-container mb-5 flex h-20 w-20 items-center justify-center rounded-full">
          <Icon name="check_circle" size={44} className="text-white" />
        </div>
        <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
          Group created
        </h2>
        <p className="text-body-md font-body-md text-on-surface-variant mt-2 max-w-sm">
          {state.message}
        </p>
        <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
          <Link
            href={`/staff/groups/${state.data.group_id}`}
            className="bg-primary text-on-primary h-touch-target-primary text-button-text font-button-text flex items-center justify-center gap-2 rounded-lg font-semibold"
          >
            <Icon name="groups" size={20} />
            Open {state.data.name}
          </Link>
          <Link
            href="/staff/groups"
            className="text-primary bg-surface h-touch-target-primary text-button-text font-button-text flex items-center justify-center rounded-lg font-semibold shadow-neu-sm"
          >
            Back to groups
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      {group ? <input type="hidden" name="group_id" value={group.id} /> : null}

      {state && !state.ok ? (
        <Alert tone="error" title="Group not saved">
          {state.error}
        </Alert>
      ) : null}
      {state?.ok && editing ? <Alert tone="success">{state.message}</Alert> : null}

      <section className="flex flex-col gap-5">
        <Field label="Group name" htmlFor="name" required error={fieldError('name')}>
          <Input
            id="name"
            name="name"
            defaultValue={group?.name ?? ''}
            placeholder="Bakenye Central Group"
            required
            maxLength={120}
            autoComplete="off"
          />
        </Field>

        <Field
          label="Location"
          htmlFor="location"
          hint="Where the group meets — trading centre, parish or village."
          error={fieldError('location')}
        >
          <Input
            id="location"
            name="location"
            defaultValue={group?.location ?? ''}
            placeholder="Bugungumale Trading Centre"
            maxLength={200}
            autoComplete="off"
          />
        </Field>
      </section>

      {/* ------------------------------------------------------ saving day */}
      <section className="bg-surface-container-low rounded-xl p-4 shadow-neu-sm">
        <fieldset>
          <legend className="text-label-md font-label-md text-on-surface-variant mb-1">
            Saving day <span className="text-error">*</span>
          </legend>
          <p className="text-body-md font-body-md text-on-surface-variant mb-3">
            The day this group meets and contributes. Every group sets its own.
          </p>

          <input type="hidden" name="saving_day" value={day} />
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {SAVING_DAYS.map((d) => {
              const selected = day === d.value;
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDay(d.value)}
                  aria-pressed={selected}
                  className={clsx(
                    'h-touch-target-primary text-button-text font-button-text rounded-lg border transition-colors',
                    selected
                      ? 'bg-primary text-on-primary border-primary font-semibold'
                      : 'bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-container-high',
                  )}
                >
                  <span className="sm:hidden">{d.short}</span>
                  <span className="hidden sm:inline">{d.short}</span>
                  <span className="sr-only">{d.label}</span>
                </button>
              );
            })}
          </div>
          {fieldError('saving_day') ? (
            <p className="text-body-md font-body-md text-error mt-2">{fieldError('saving_day')}</p>
          ) : null}
        </fieldset>

        <Field
          label="How often"
          htmlFor="saving_frequency"
          className="mt-5"
          hint={
            frequency === 'biweekly'
              ? 'Collects on the chosen weekday every other week.'
              : frequency === 'monthly'
                ? 'Collects on the first such weekday of each month.'
                : 'Collects on the chosen weekday every week.'
          }
        >
          <Select
            id="saving_frequency"
            name="saving_frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as SavingFrequency)}
          >
            {(Object.keys(SAVING_FREQUENCY_LABELS) as SavingFrequency[]).map((f) => (
              <option key={f} value={f}>
                {SAVING_FREQUENCY_LABELS[f]}
              </option>
            ))}
          </Select>
        </Field>
      </section>

      {/* --------------------------------------------------------- targets */}
      <section className="flex flex-col gap-5">
        <Field
          label="Weekly target per member"
          htmlFor="weekly_target"
          hint={
            kind === 'weekly'
              ? 'Applied to every member without a personal savings plan.'
              : 'Kept for reference; this group collects monthly.'
          }
          error={fieldError('weekly_target')}
        >
          <MoneyInput
            id="weekly_target"
            name="weekly_target"
            value={weekly ?? ''}
            onValueChange={setWeekly}
            enterKeyHint="next"
          />
        </Field>

        <Field
          label="Monthly target per member"
          htmlFor="monthly_target"
          hint={
            kind === 'monthly'
              ? 'Applied to every member without a personal savings plan.'
              : 'Kept for reference; this group collects weekly.'
          }
          error={fieldError('monthly_target')}
        >
          <MoneyInput
            id="monthly_target"
            name="monthly_target"
            value={monthly ?? ''}
            onValueChange={setMonthly}
            enterKeyHint="next"
          />
        </Field>

        {kind === 'weekly' && weekly ? (
          <Alert tone="info">
            A group of 25 members would be expected to bring{' '}
            <strong>{formatUGX(weekly * 25)}</strong> each collection day. Members with their own
            savings plan keep their own target.
          </Alert>
        ) : null}
      </section>

      {/* ------------------------------------------------------- leadership */}
      <section className="flex flex-col gap-5">
        <h2 className="text-button-text font-button-text text-on-surface">Leadership</h2>

        <MemberPicker
          name="leader_member_id"
          label="Group leader"
          required={false}
          initial={leader ?? null}
        />
        <MemberPicker
          name="secretary_member_id"
          label="Group secretary"
          required={false}
          initial={secretary ?? null}
        />

        <Field
          label="Assigned loan officer"
          htmlFor="loan_officer_id"
          hint="The staff member responsible for this group."
        >
          <Select
            id="loan_officer_id"
            name="loan_officer_id"
            defaultValue={group?.loan_officer_id ?? ''}
          >
            <option value="">Not assigned</option>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.full_name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Notes" htmlFor="notes" error={fieldError('notes')}>
          <Textarea
            id="notes"
            name="notes"
            defaultValue={group?.notes ?? ''}
            maxLength={1000}
            placeholder="Anything the office should know about this group."
          />
        </Field>
      </section>

      <StickyActions>
        <Link
          href={group ? `/staff/groups/${group.id}` : '/staff/groups'}
          className="text-primary bg-surface h-touch-target-primary text-button-text font-button-text flex flex-1 items-center justify-center rounded-lg font-semibold shadow-neu-sm"
        >
          Cancel
        </Link>
        <SubmitButton size="lg" className="flex-[2]" pendingLabel="Saving…" icon="check">
          {editing ? 'Save changes' : 'Create group'}
        </SubmitButton>
      </StickyActions>
    </form>
  );
}
