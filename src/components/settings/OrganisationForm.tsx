'use client';

import { useActionState } from 'react';
import { updateOrganisation } from '@/app/actions/settings';
import { Alert } from '@/components/ui/states';
import { Field, Input, SubmitButton, Textarea } from '@/components/ui/form';
import type { ActionResult } from '@/lib/errors';
import type { SaccoSettingsRow } from '@/types/db';

/**
 * The organisation's own details.
 *
 * The registered name is not decoration: it is the letterhead on every receipt
 * and statement that leaves the building, and `sacco_legal_name()` reads it
 * from the same row this form writes. Correcting it used to require a
 * migration; it is now an edit, audited like any other financial change.
 *
 * Document reference prefixes are deliberately absent. The `BND` of a member
 * number and the `SAV`, `RCT`, `LRP` and the rest of a document reference are
 * part of numbers already issued and printed, and making them editable would
 * let one keystroke change the meaning of every document in the archive.
 */
export function OrganisationForm({
  settings,
  canManage,
}: {
  settings: SaccoSettingsRow;
  canManage: boolean;
}) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    updateOrganisation,
    null,
  );

  const err = state && !state.ok ? state : null;
  const fieldError = (name: string) => (err?.field === name ? err.error : null);

  return (
    <form action={action} className="space-y-5">
      <div>
        <h3 className="text-title-md text-on-surface">Organisation</h3>
        <p className="mt-1 text-label-md font-normal leading-relaxed text-on-surface-variant">
          These details head every receipt, statement and report the SACCO prints.
        </p>
      </div>

      {state?.ok ? <Alert tone="success">{state.message}</Alert> : null}
      {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

      <div className="grid grid-cols-1 gap-x-gutter gap-y-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field
            label="Registered name"
            htmlFor="legal_name"
            required
            hint="The full legal name, as it appears on printed documents."
            error={fieldError('legal_name')}
          >
            <Input
              id="legal_name"
              name="legal_name"
              defaultValue={settings.legal_name}
              disabled={!canManage}
              invalid={!!fieldError('legal_name')}
              maxLength={160}
              required
            />
          </Field>
        </div>

        <Field
          label="Short name"
          htmlFor="short_name"
          required
          hint="Used where the full name will not fit."
          error={fieldError('short_name')}
        >
          <Input
            id="short_name"
            name="short_name"
            defaultValue={settings.short_name}
            disabled={!canManage}
            invalid={!!fieldError('short_name')}
            maxLength={40}
            required
          />
        </Field>

        <Field
          label="Registration number"
          htmlFor="registration_no"
          hint="The co-operative registration number, if the SACCO has one."
          error={fieldError('registration_no')}
        >
          <Input
            id="registration_no"
            name="registration_no"
            defaultValue={settings.registration_no ?? ''}
            disabled={!canManage}
            maxLength={60}
          />
        </Field>

        <div className="md:col-span-2">
          <Field label="Motto" htmlFor="motto" error={fieldError('motto')}>
            <Input
              id="motto"
              name="motto"
              defaultValue={settings.motto}
              disabled={!canManage}
              maxLength={160}
            />
          </Field>
        </div>

        <Field
          label="Contact email"
          htmlFor="contact_email"
          error={fieldError('contact_email')}
        >
          <Input
            id="contact_email"
            name="contact_email"
            type="email"
            defaultValue={settings.contact_email ?? ''}
            disabled={!canManage}
            invalid={!!fieldError('contact_email')}
            maxLength={160}
          />
        </Field>

        <Field label="Contact phone" htmlFor="contact_phone" error={fieldError('contact_phone')}>
          <Input
            id="contact_phone"
            name="contact_phone"
            type="tel"
            defaultValue={settings.contact_phone ?? ''}
            disabled={!canManage}
            maxLength={40}
          />
        </Field>

        <div className="md:col-span-2">
          <Field label="Address" htmlFor="address" error={fieldError('address')}>
            <Textarea
              id="address"
              name="address"
              rows={2}
              defaultValue={settings.address ?? ''}
              disabled={!canManage}
              maxLength={300}
            />
          </Field>
        </div>
      </div>

      {canManage ? (
        <div className="border-t border-outline-variant/70 pt-4">
          <SubmitButton pendingLabel="Saving…">Save organisation details</SubmitButton>
        </div>
      ) : (
        <Alert tone="info">
          These details are shown for reference. Changing them needs the settings permission.
        </Alert>
      )}
    </form>
  );
}
