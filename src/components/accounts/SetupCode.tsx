'use client';

import { useActionState, useState } from 'react';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { Button, SubmitButton } from '@/components/ui/form';
import { Icon } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import type { ActionResult } from '@/lib/errors';
import type { SetupCodeIssued } from '@/types/access';

/**
 * A setup or reset code, displayed once.
 *
 * Only a hash is stored, so this is the one time anybody can read it. The
 * officer hands it to the account holder, who enters it on "Set up your
 * account" with their member number or phone and chooses their own password.
 * The code is not a password: it works once, and it expires.
 */
export function SetupCodeCard({
  setup,
  who,
  identifier,
}: {
  setup: SetupCodeIssued;
  /** "the member", "Grace" */
  who: string;
  /** What they will type to identify themselves, e.g. their member number. */
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
          <p className="text-on-surface text-button-text font-semibold">
            {setup.purpose === 'setup' ? 'Setup code' : 'Password reset code'} - shown only now
          </p>
          <p className="text-on-surface-variant text-body-md">
            Give it to {who} privately. Valid until {formatDateTime(setup.expires_at)}, and works once.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p
          className="bg-surface text-on-surface tabular select-all rounded-xl px-4 py-2 font-mono text-[24px] font-bold tracking-[0.18em] shadow-neu-sm"
          aria-label={`Code ${setup.code.split('').join(' ')}`}
        >
          {setup.code}
        </p>
        <Button
          variant="outline"
          size="sm"
          icon={copied ? 'check' : 'content_copy'}
          onClick={() => {
            void navigator.clipboard?.writeText(setup.code).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <ol className="text-on-surface-variant text-body-md ml-5 list-decimal space-y-0.5">
        <li>
          Open the SACCO app and choose <strong className="text-on-surface">Set up your account</strong>.
        </li>
        <li>
          Enter {identifier ? <strong className="text-on-surface tabular font-mono">{identifier}</strong> : 'their member number or phone number'} and this code.
        </li>
        <li>Choose a password. Nobody at the SACCO will ever see it.</li>
      </ol>
    </div>
  );
}

/**
 * A button that issues a code through a server action and shows it once in a
 * dialog. Used for "Reset password" and "Create login".
 */
export function IssueCodeButton({
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
  action: (prev: ActionResult<SetupCodeIssued> | null, formData: FormData) => Promise<ActionResult<SetupCodeIssued>>;
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
  const [state, formAction] = useActionState<ActionResult<SetupCodeIssued> | null, FormData>(action, null);
  const err = state && !state.ok ? state : null;

  return (
    <>
      <Button variant={variant} size={size} icon={icon} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            <SetupCodeCard setup={state.data} who={who} identifier={identifier} />
            <Button size="lg" block onClick={() => setOpen(false)}>
              Done - I have given it to them
            </Button>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            {Object.entries(fields).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            {err ? <Alert tone="error">{err.error}</Alert> : null}
            <Alert tone="info">
              You will see a one-time code, never a password. Any earlier code stops working.
            </Alert>
            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Issuing...">
                {confirmLabel}
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
