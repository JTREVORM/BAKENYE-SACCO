'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { createMember, updateMember } from '@/app/actions/members';
import { Alert } from '@/components/ui/states';
import { Icon } from '@/components/ui/primitives';
import {
  Field,
  Input,
  PhoneInput,
  Select,
  StickyActions,
  SubmitButton,
  Textarea,
} from '@/components/ui/form';
import { toISODate } from '@/lib/format';
import type { ActionResult } from '@/lib/errors';
import { savingDayLabel } from '@/lib/groups';
import { formatUGX } from '@/lib/money';
import type { MemberFinancialsRow, SaccoGroupRow } from '@/types/db';

/**
 * Register or edit a member.
 *
 * Single-column throughout, 56px controls, `inputMode` set per field so Android
 * shows the right keyboard — a registration clerk enrolling members at a
 * village meeting is doing this on a phone, standing up.
 *
 * Creating a login is optional. Many members will never open the app; those who
 * do get a one-time password shown to the clerk exactly once, which is why the
 * success screen makes a point of it.
 */
export function MemberForm({
  member,
  groups = [],
}: {
  member?: MemberFinancialsRow;
  /** Empty when the signed-in user may not place members in groups. */
  groups?: SaccoGroupRow[];
}) {
  const editing = !!member;
  const [state, action] = useActionState<
    ActionResult<{ member_id: string; member_no: string; temp_password?: string }> | null,
    FormData
  >(editing ? (updateMember as never) : createMember, null);

  const [createLogin, setCreateLogin] = useState(false);
  const err = state && !state.ok ? state : null;

  /* --------------------------------------------------------------- success */
  if (state?.ok && !editing) {
    const data = state.data;
    return (
      <div className="animate-slide-up mx-auto flex max-w-md flex-col items-center py-8 text-center">
        <div className="bg-tertiary-container mb-5 flex h-20 w-20 items-center justify-center rounded-full">
          <Icon name="check_circle" size={44} className="text-white" />
        </div>
        <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
          Member registered
        </h2>
        <p className="text-body-md font-body-md text-on-surface-variant mt-2">{state.message}</p>

        <div className="bg-surface-container-low mt-6 w-full rounded-xl p-4 text-left shadow-neu-sm">
          <p className="text-label-md font-label-md text-on-surface-variant">Member number</p>
          <p className="text-button-text font-button-text text-on-surface tabular mt-1 select-all font-mono">
            {data.member_no}
          </p>
        </div>

        {data.temp_password ? (
          <div className="mt-4 w-full text-left">
            <Alert tone="warning" title="One-time password — shown only now">
              <p className="mt-1">
                Give this to the member and ask them to change it the first time they sign in.
              </p>
              <p className="text-button-text font-button-text mt-2 select-all font-mono">
                {data.temp_password}
              </p>
            </Alert>
          </div>
        ) : null}

        <div className="mt-8 flex w-full flex-col gap-3">
          <Link
            href={`/staff/members/${data.member_id}`}
            className="bg-primary text-on-primary h-touch-target-primary text-button-text font-button-text flex items-center justify-center rounded-lg font-semibold"
          >
            Open member profile
          </Link>
          <Link
            href="/staff/members/new"
            className="text-primary bg-surface h-touch-target-primary text-button-text font-button-text flex items-center justify-center rounded-lg font-semibold shadow-neu-sm"
          >
            Register another member
          </Link>
          <Link
            href="/staff/members"
            className="text-primary text-button-text font-button-text h-touch-target-min flex items-center justify-center"
          >
            Back to the register
          </Link>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ form */
  return (
    <form action={action} className="mx-auto max-w-xl" noValidate>
      {editing ? <input type="hidden" name="member_id" value={member.id} /> : null}

      {state?.ok && editing ? (
        <div className="mb-5">
          <Alert tone="success">{state.message}</Alert>
        </div>
      ) : null}

      {err && !err.field ? (
        <div className="mb-5">
          <Alert tone="error" title="Could not save">
            {err.error}
          </Alert>
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <Section title="Identity">
          <Field
            label="Full name"
            htmlFor="full_name"
            required
            error={err?.field === 'full_name' ? err.error : null}
            hint="As written on the National ID."
          >
            <Input
              id="full_name"
              name="full_name"
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="next"
              required
              defaultValue={member?.full_name}
              invalid={err?.field === 'full_name'}
              placeholder="e.g. Aisha Namatovu"
            />
          </Field>

          <Field
            label="Phone number"
            htmlFor="phone"
            required
            error={err?.field === 'phone' ? err.error : null}
            hint="Ugandan mobile number. Used for SMS and for signing in."
          >
            <PhoneInput
              id="phone"
              name="phone"
              required
              defaultValue={member?.phone}
              invalid={err?.field === 'phone'}
            />
          </Field>

          <Field
            label="National ID (NIN)"
            htmlFor="national_id"
            error={err?.field === 'national_id' ? err.error : null}
          >
            <Input
              id="national_id"
              name="national_id"
              autoCapitalize="characters"
              spellCheck={false}
              defaultValue={member?.national_id ?? ''}
              invalid={err?.field === 'national_id'}
              placeholder="e.g. CM90012345ABCD"
            />
          </Field>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Date of birth" htmlFor="date_of_birth">
              <Input
                id="date_of_birth"
                name="date_of_birth"
                type="date"
                max={toISODate()}
                defaultValue={member?.date_of_birth ?? ''}
              />
            </Field>

            <Field label="Gender" htmlFor="gender">
              <Select id="gender" name="gender" defaultValue={member?.gender ?? ''}>
                <option value="">Prefer not to say</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </div>
        </Section>

        {groups.length > 0 ? (
          <Section title="Group">
            <Field
              label="Savings group"
              htmlFor="group_id"
              error={err?.field === 'group_id' ? err.error : null}
              hint="The group sets the collection day and the default savings target. A member with no group appears on no collection sheet."
            >
              <Select
                id="group_id"
                name="group_id"
                defaultValue={member?.group_id ?? ''}
                invalid={err?.field === 'group_id'}
              >
                <option value="">No group yet</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} · {savingDayLabel(g.saving_day)}
                    {Number(g.weekly_target) > 0
                      ? ` · ${formatUGX(g.weekly_target)} a week`
                      : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </Section>
        ) : null}

        <Section title="Contact">
          <Field
            label="Email address"
            htmlFor="email"
            error={err?.field === 'email' ? err.error : null}
            hint="Optional, but required if this member needs a login."
          >
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={member?.email ?? ''}
              invalid={err?.field === 'email'}
            />
          </Field>

          <Field label="Residential address" htmlFor="address">
            <Textarea
              id="address"
              name="address"
              maxLength={300}
              defaultValue={member?.address ?? ''}
              placeholder="Village, parish, sub-county, district"
            />
          </Field>

          <Field label="Occupation" htmlFor="occupation">
            <Input
              id="occupation"
              name="occupation"
              maxLength={120}
              defaultValue={member?.occupation ?? ''}
              placeholder="e.g. Trader, Farmer, Teacher"
            />
          </Field>
        </Section>

        <Section title="Next of kin">
          <Field label="Full name" htmlFor="next_of_kin_name">
            <Input
              id="next_of_kin_name"
              name="next_of_kin_name"
              autoCapitalize="words"
              maxLength={120}
              defaultValue={member?.next_of_kin_name ?? ''}
            />
          </Field>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Relationship" htmlFor="next_of_kin_relation">
              <Input
                id="next_of_kin_relation"
                name="next_of_kin_relation"
                maxLength={60}
                defaultValue={member?.next_of_kin_relation ?? ''}
                placeholder="e.g. Spouse"
              />
            </Field>

            <Field
              label="Phone number"
              htmlFor="next_of_kin_phone"
              error={err?.field === 'next_of_kin_phone' ? err.error : null}
            >
              <PhoneInput
                id="next_of_kin_phone"
                name="next_of_kin_phone"
                defaultValue={member?.next_of_kin_phone ?? ''}
                invalid={err?.field === 'next_of_kin_phone'}
              />
            </Field>
          </div>
        </Section>

        {!editing ? (
          <Section title="App access">
            <label className="bg-surface flex cursor-pointer items-start gap-3 rounded-xl p-4 shadow-neu-sm">
              <input
                type="checkbox"
                name="create_login"
                checked={createLogin}
                onChange={(e) => setCreateLogin(e.target.checked)}
                className="text-primary focus:ring-primary border-outline mt-0.5 h-5 w-5 shrink-0 rounded"
              />
              <span className="min-w-0">
                <span className="text-button-text font-button-text text-on-surface block">
                  Create a login for this member
                </span>
                <span className="text-body-md font-body-md text-on-surface-variant mt-0.5 block">
                  They will be able to sign in with their member number and see their own savings,
                  shares and loans. Requires an email address.
                </span>
              </span>
            </label>

            {createLogin ? (
              <Alert tone="info">
                A one-time password will be generated and shown to you once. Write it down or hand
                the phone to the member before leaving this screen.
              </Alert>
            ) : null}
          </Section>
        ) : null}
      </div>

      <StickyActions>
        <Link
          href={editing ? `/staff/members/${member.id}` : '/staff/members'}
          className="text-primary bg-surface h-touch-target-primary text-button-text font-button-text flex flex-1 items-center justify-center rounded-lg font-semibold shadow-neu-sm"
        >
          Cancel
        </Link>
        <SubmitButton size="lg" className="flex-[2]" pendingLabel="Saving…">
          {editing ? 'Save changes' : 'Register member'}
        </SubmitButton>
      </StickyActions>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface shadow-card overflow-hidden rounded-xl">
      <h2 className="text-button-text font-button-text text-on-surface border-outline-variant bg-surface-container-low border-b px-4 py-3">
        {title}
      </h2>
      <div className="flex flex-col gap-5 p-4">{children}</div>
    </section>
  );
}
