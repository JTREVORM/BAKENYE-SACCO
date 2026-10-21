'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/states';
import { ActionForm } from '@/components/forms/ActionForm';
import { useSubmission } from '@/components/forms/useSubmission';
import { UnresolvedNotice } from '@/components/forms/UnresolvedSubmission';
import { Modal } from '@/components/ui/Modal';
import { Button, SubmitButton } from '@/components/ui/form';
import { Icon } from '@/components/ui/primitives';
import type { ActionResult } from '@/lib/errors';
import type { TemporaryPassword } from '@/types/access';

/**
 * A temporary password, displayed once.
 *
 * It is never stored in readable form, so this is the only time anybody can
 * read it. The officer hands it over; the account holder signs in with it and
 * must choose their own password straight away.
 */
export function TemporaryPasswordCard({
  temporary,
  who,
  identifier,
}: {
  temporary: TemporaryPassword;
  /** "the member", "Grace" */
  who: string;
  /** What they sign in with, e.g. their member number. */
  identifier?: string | null;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="bg-surface-container flex flex-col gap-3 rounded-2xl p-4 text-left shadow-neu-inset-sm">
      <div className="flex items-start gap-3">
        <span className="bg-primary text-on-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
          <Icon name="key" size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-on-surface text-button-text font-semibold">Temporary password - shown only now</p>
          <p className="text-on-surface-variant text-body-md">
            Give it to {who} privately. They must change it the first time they sign in.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p
          className="bg-surface text-on-surface tabular select-all rounded-xl px-4 py-2 font-mono text-[24px] font-bold tracking-[0.14em] shadow-neu-sm"
          aria-label={`Temporary password ${temporary.password.split('').join(' ')}`}
        >
          {temporary.password}
        </p>
        <Button
          variant="outline"
          size="sm"
          icon={copied ? 'check' : 'content_copy'}
          onClick={() => {
            void navigator.clipboard?.writeText(temporary.password).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <p className="text-on-surface-variant text-body-md">
        They sign in with{' '}
        {identifier ? <strong className="text-on-surface tabular font-mono">{identifier}</strong> : 'their member number or phone number'}{' '}
        or their phone number and this password, then choose their own. Nobody at the SACCO will know it.
      </p>
    </div>
  );
}

/**
 * A button that creates a login or resets a password through a server action,
 * and shows the resulting temporary password once in a dialog.
 */
export function IssuePasswordButton({
  action,
  fields,
  label,
  icon = 'key',
  title,
  description,
  confirmLabel,
  who,
  identifier,
  variant = 'outline',
  size = 'md',
}: {
  action: (prev: ActionResult<TemporaryPassword> | null, formData: FormData) => Promise<ActionResult<TemporaryPassword>>;
  fields: Record<string, string>;
  label: string;
  icon?: 'key' | 'person_add' | 'lock_open';
  title: string;
  description: string;
  confirmLabel: string;
  who: string;
  identifier?: string | null;
  variant?: 'outline' | 'primary';
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const submission = useSubmission<TemporaryPassword>(action);
  const state = submission.result;
  const err = state && !state.ok ? state : null;

  return (
    <>
      <Button variant={variant} size={size} icon={icon} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            <TemporaryPasswordCard temporary={state.data} who={who} identifier={identifier} />
            <Button size="lg" block onClick={() => setOpen(false)}>
              Done - I have given it to them
            </Button>
          </div>
        ) : (
          <ActionForm submission={submission} className="flex flex-col gap-4">
            {submission.unresolved ? <UnresolvedNotice noun="reset" /> : null}
            {Object.entries(fields).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            {err ? <Alert tone="error">{err.error}</Alert> : null}
            <Alert tone="info">
              A new temporary password will be generated and shown once. They must change it at their next
              sign-in; until then their account can do nothing else.
            </Alert>
            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Working...">
                {confirmLabel}
              </SubmitButton>
            </div>
          </ActionForm>
        )}
      </Modal>
    </>
  );
}
