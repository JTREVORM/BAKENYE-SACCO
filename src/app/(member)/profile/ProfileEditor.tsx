'use client';

import { useActionState, useState } from 'react';
import { updateMember } from '@/app/actions/members';
import { Icon } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { Button, Field, Input, PhoneInput, SubmitButton, Textarea } from '@/components/ui/form';
import { formatPhone, initials } from '@/lib/format';
import type { ActionResult } from '@/lib/errors';
import type { MemberFinancialsRow } from '@/types/db';

/**
 * Personal Information + Next of Kin.
 *
 * Read-only by default — matching the Stitch list layout exactly — and swapping
 * to a single form when the member taps any edit pencil.
 *
 * Only contact details are editable here. Name, National ID and member number
 * are identity fields on a financial record; changing them is a staff action
 * with an audit trail, and the RLS policy on `members` enforces that whatever
 * this component does.
 */
export function ProfileEditor({ member }: { member: MemberFinancialsRow }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState<ActionResult<{ member_id: string }> | null, FormData>(
    updateMember,
    null,
  );

  const err = state && !state.ok ? state : null;

  if (!editing) {
    return (
      <>
        <section className="bg-surface-container-lowest border-surface-container-high shadow-card overflow-hidden rounded-xl border">
          <div className="border-surface-container-high bg-surface-container-low/50 flex items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="text-button-text font-button-text text-on-surface">
              Personal Information
            </h2>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-primary hover:bg-surface-container-low -mr-2 flex h-11 w-11 items-center justify-center rounded-full transition-colors"
              aria-label="Edit personal information"
            >
              <Icon name="edit" size={20} />
            </button>
          </div>

          {state?.ok ? (
            <div className="p-4">
              <Alert tone="success">{state.message}</Alert>
            </div>
          ) : null}

          <div className="divide-surface-container-high divide-y">
            <Row label="Phone Number" value={formatPhone(member.phone)} onEdit={() => setEditing(true)} />
            <Row label="Email Address" value={member.email ?? 'Not provided'} onEdit={() => setEditing(true)} />
            <Row
              label="Residential Address"
              value={member.address ?? 'Not provided'}
              onEdit={() => setEditing(true)}
            />
            <Row
              label="Occupation"
              value={member.occupation ?? 'Not provided'}
              onEdit={() => setEditing(true)}
            />
            <Row label="National ID" value={member.national_id ?? 'Not provided'} locked />
          </div>
        </section>

        <section className="bg-surface-container-lowest border-surface-container-high shadow-card overflow-hidden rounded-xl border">
          <div className="border-surface-container-high bg-surface-container-low/50 border-b px-4 py-3">
            <h2 className="text-button-text font-button-text text-on-surface">Next of Kin</h2>
          </div>
          <div className="p-4">
            {member.next_of_kin_name ? (
              <div className="bg-surface-container flex items-center gap-4 rounded-lg p-3">
                <div className="bg-primary-container text-on-primary-container flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                  <span className="text-headline-lg-mobile font-headline-lg-mobile">
                    {initials(member.next_of_kin_name)[0]}
                  </span>
                </div>
                <div className="flex min-w-0 flex-grow flex-col">
                  <span className="text-button-text font-button-text text-on-surface truncate">
                    {member.next_of_kin_name}
                  </span>
                  <span className="text-body-md font-body-md text-on-surface-variant mt-0.5 truncate">
                    {member.next_of_kin_relation ?? 'Next of kin'}
                    {member.next_of_kin_phone ? ` • ${formatPhone(member.next_of_kin_phone)}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-primary hover:bg-surface-container-low flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors"
                  aria-label="Edit next of kin"
                >
                  <Icon name="edit" size={20} />
                </button>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-body-md font-body-md text-on-surface-variant">
                  No next of kin recorded.
                </p>
                <Button variant="outline" className="mt-3" icon="add" onClick={() => setEditing(true)}>
                  Add next of kin
                </Button>
              </div>
            )}
          </div>
        </section>
      </>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="member_id" value={member.id} />
      {/* Sent unchanged so the schema validates; the server ignores identity
          fields for a member editing their own record. */}
      <input type="hidden" name="full_name" value={member.full_name} />
      <input type="hidden" name="national_id" value={member.national_id ?? ''} />

      <section className="bg-surface-container-lowest border-surface-container-high shadow-card overflow-hidden rounded-xl border">
        <div className="border-surface-container-high bg-surface-container-low/50 border-b px-4 py-3">
          <h2 className="text-button-text font-button-text text-on-surface">
            Edit your details
          </h2>
        </div>

        <div className="flex flex-col gap-5 p-4">
          {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

          <Field
            label="Phone Number"
            htmlFor="phone"
            required
            error={err?.field === 'phone' ? err.error : null}
          >
            <PhoneInput
              id="phone"
              name="phone"
              defaultValue={member.phone}
              required
              invalid={err?.field === 'phone'}
            />
          </Field>

          <Field
            label="Email Address"
            htmlFor="email"
            error={err?.field === 'email' ? err.error : null}
            hint="Used for password resets and statements."
          >
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={member.email ?? ''}
              invalid={err?.field === 'email'}
            />
          </Field>

          <Field label="Residential Address" htmlFor="address">
            <Textarea id="address" name="address" defaultValue={member.address ?? ''} maxLength={300} />
          </Field>

          <Field label="Occupation" htmlFor="occupation">
            <Input id="occupation" name="occupation" defaultValue={member.occupation ?? ''} maxLength={120} />
          </Field>
        </div>
      </section>

      <section className="bg-surface-container-lowest border-surface-container-high shadow-card overflow-hidden rounded-xl border">
        <div className="border-surface-container-high bg-surface-container-low/50 border-b px-4 py-3">
          <h2 className="text-button-text font-button-text text-on-surface">Next of Kin</h2>
        </div>
        <div className="flex flex-col gap-5 p-4">
          <Field label="Full name" htmlFor="next_of_kin_name">
            <Input
              id="next_of_kin_name"
              name="next_of_kin_name"
              defaultValue={member.next_of_kin_name ?? ''}
              maxLength={120}
            />
          </Field>
          <Field label="Relationship" htmlFor="next_of_kin_relation">
            <Input
              id="next_of_kin_relation"
              name="next_of_kin_relation"
              defaultValue={member.next_of_kin_relation ?? ''}
              placeholder="e.g. Spouse, Son, Sister"
              maxLength={60}
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
              defaultValue={member.next_of_kin_phone ?? ''}
              invalid={err?.field === 'next_of_kin_phone'}
            />
          </Field>
        </div>
      </section>

      <div className="flex gap-3">
        <Button
          variant="outline"
          size="lg"
          className="flex-1"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
        <SubmitButton size="lg" className="flex-[2]" pendingLabel="Saving…">
          Save changes
        </SubmitButton>
      </div>
    </form>
  );
}

function Row({
  label,
  value,
  onEdit,
  locked,
}: {
  label: string;
  value: string;
  onEdit?: () => void;
  locked?: boolean;
}) {
  return (
    <div className="min-h-touch-target-min flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-label-md font-label-md text-on-surface-variant">{label}</span>
        <span className="text-body-md font-body-md text-on-surface mt-0.5 break-words">{value}</span>
      </div>
      {locked ? (
        <span
          className="text-on-surface-variant/60 flex h-11 w-11 shrink-0 items-center justify-center"
          title="Contact the SACCO office to change this"
        >
          <Icon name="lock" size={18} />
        </span>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${label.toLowerCase()}`}
          className="text-primary hover:bg-surface-container-low flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors"
        >
          <Icon name="edit" size={20} />
        </button>
      )}
    </div>
  );
}
