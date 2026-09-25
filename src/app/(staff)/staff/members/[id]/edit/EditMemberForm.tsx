'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { updateMemberProfile } from '@/app/actions/members';
import { Alert } from '@/components/ui/states';
import { Icon } from '@/components/ui/primitives';
import { Field, Input, PhoneInput, Select, StickyActions, SubmitButton, Textarea } from '@/components/ui/form';
import { formatPhone, toISODate } from '@/lib/format';
import type { ActionResult } from '@/lib/errors';
import type { MemberFinancialsRow } from '@/types/db';

/**
 * Edit a member's official record - staff only.
 *
 * The member number is shown but never editable, and status has its own
 * audited control. There are no categories to set any more: savings are open
 * and every share costs the same, so nothing about a member's tier has to be
 * decided here. Every save needs a reason, and every field that changed is kept
 * on the member's history with its old value, new value, who and why.
 */
export function EditMemberForm({
  member,
  canOverridePhone,
}: {
  member: MemberFinancialsRow;
  canOverridePhone: boolean;
}) {
  const [state, action] = useActionState<ActionResult<{ member_id: string; changed: string[] }> | null, FormData>(
    updateMemberProfile,
    null,
  );
  const err = state && !state.ok ? state : null;
  const fieldError = (f: string) => (err?.field === f ? err.error : null);
  const phoneClash = err?.field === 'phone' && /already the phone number/.test(err.error);
  const SHOWN = ['full_name', 'phone', 'national_id', 'date_of_birth', 'gender', 'joined_on',
    'email', 'next_of_kin_phone', 'reason'];

  return (
    <form action={action} className="mx-auto max-w-2xl" noValidate>
      <input type="hidden" name="member_id" value={member.id} />
      {state?.ok ? (
        <div className="mb-5">
          <Alert tone="success" title="Member record updated">
            {state.message}{' '}
            <Link href={`/staff/members/${member.id}`} className="font-semibold underline">
              Back to the member
            </Link>
          </Alert>
        </div>
      ) : null}
      {err && (!err.field || !SHOWN.includes(err.field)) ? (
        <div className="mb-5">
          <Alert tone="error" title="Not saved">
            {err.error}
          </Alert>
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <Section title="Identity">
          <div className="bg-surface-container flex items-center gap-3 rounded-2xl p-3.5 shadow-neu-inset-sm">
            <Icon name="badge" size={20} className="text-on-surface-variant" />
            <div className="min-w-0">
              <p className="text-label-md text-on-surface-variant font-normal">Member number - permanent</p>
              <p className="text-body-lg text-on-surface tabular font-mono font-semibold">{member.member_no}</p>
            </div>
          </div>
          <Field label="Full name" htmlFor="full_name" required error={fieldError('full_name')}>
            <Input id="full_name" name="full_name" defaultValue={member.full_name} autoCapitalize="words" invalid={!!fieldError('full_name')} />
          </Field>
          <Field
            label="Phone number"
            htmlFor="phone"
            required
            error={fieldError('phone')}
            hint="The member signs in with this number. A change takes effect at once; the old number stops working."
          >
            <PhoneInput id="phone" name="phone" defaultValue={formatPhone(member.phone)} invalid={!!fieldError('phone')} />
          </Field>
          {phoneClash && canOverridePhone ? (
            <label className="bg-warning-container/40 flex cursor-pointer items-start gap-3 rounded-2xl p-4">
              <input type="checkbox" name="allow_shared_phone" className="text-primary focus:ring-primary border-outline mt-0.5 h-5 w-5 shrink-0 rounded" />
              <span className="text-body-md text-on-surface">
                <strong>Allow this member to share the number with another member.</strong> The reason below is recorded with the override.
              </span>
            </label>
          ) : null}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="National ID (NIN)" htmlFor="national_id" error={fieldError('national_id')}>
              <Input id="national_id" name="national_id" defaultValue={member.national_id ?? ''} autoCapitalize="characters" spellCheck={false} />
            </Field>
            <Field label="Date of birth" htmlFor="date_of_birth" error={fieldError('date_of_birth')}>
              <Input id="date_of_birth" name="date_of_birth" type="date" max={toISODate()} defaultValue={member.date_of_birth ?? ''} />
            </Field>
            <Field label="Gender" htmlFor="gender" error={fieldError('gender')}>
              <Select id="gender" name="gender" defaultValue={member.gender ?? ''}>
                <option value="">Not recorded</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Membership date" htmlFor="joined_on" error={fieldError('joined_on')} hint="The date this member joined the SACCO.">
              <Input id="joined_on" name="joined_on" type="date" max={toISODate()} defaultValue={member.joined_on} />
            </Field>
          </div>
        </Section>

        <Section title="Contact & address">
          <Field label="Email address" htmlFor="email" error={fieldError('email')} hint="Optional.">
            <Input id="email" name="email" type="email" inputMode="email" autoCapitalize="none" spellCheck={false} defaultValue={member.email ?? ''} />
          </Field>
          <Field label="Address / location" htmlFor="address">
            <Textarea id="address" name="address" maxLength={300} defaultValue={member.address ?? ''} />
          </Field>
          <Field label="Occupation" htmlFor="occupation">
            <Input id="occupation" name="occupation" maxLength={120} defaultValue={member.occupation ?? ''} />
          </Field>
        </Section>

        <Section title="Next of kin">
          <Field label="Full name" htmlFor="next_of_kin_name">
            <Input id="next_of_kin_name" name="next_of_kin_name" maxLength={120} defaultValue={member.next_of_kin_name ?? ''} />
          </Field>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Relationship" htmlFor="next_of_kin_relation">
              <Input id="next_of_kin_relation" name="next_of_kin_relation" maxLength={60} defaultValue={member.next_of_kin_relation ?? ''} />
            </Field>
            <Field label="Phone number" htmlFor="next_of_kin_phone" error={fieldError('next_of_kin_phone')}>
              <PhoneInput id="next_of_kin_phone" name="next_of_kin_phone" defaultValue={member.next_of_kin_phone ? formatPhone(member.next_of_kin_phone) : ''} />
            </Field>
          </div>
        </Section>

        <Section title="Why is this changing?">
          <Field
            label="Reason"
            htmlFor="reason"
            required
            error={fieldError('reason')}
            hint="Required. Kept on the member's history and in the audit log with each change."
          >
            <Textarea
              id="reason"
              name="reason"
              maxLength={500}
              required
              invalid={!!fieldError('reason')}
              placeholder="e.g. Member changed phone number; identity checked against National ID."
            />
          </Field>
        </Section>
      </div>

      <StickyActions>
        <Link
          href={`/staff/members/${member.id}`}
          className="text-primary bg-surface h-touch-target-primary text-button-text flex flex-1 items-center justify-center rounded-full font-semibold shadow-neu"
        >
          Cancel
        </Link>
        <SubmitButton size="lg" className="flex-[2]" pendingLabel="Saving…">
          Save changes
        </SubmitButton>
      </StickyActions>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface shadow-neu overflow-hidden rounded-2xl">
      <h2 className="text-button-text text-on-surface border-outline-variant/70 border-b px-5 py-3.5">{title}</h2>
      <div className="flex flex-col gap-5 p-5">{children}</div>
    </section>
  );
}
