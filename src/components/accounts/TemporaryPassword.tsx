'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/states';
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
  const [copyError, setCopyError] = useState(false);

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
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(temporary.password);
              setCopied(true);
              setCopyError(false);
            } catch {
              setCopyError(true);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      {copyError ? <Alert tone="error">Copy was unavailable. Select the password and copy it manually.</Alert> : null}
      <p className="text-on-surface-variant text-body-md">
        They sign in with{' '}
        {identifier ? <strong className="text-on-surface tabular font-mono">{identifier}</strong> : 'their member number'}{' '}
        or their phone number and this password, then choose their own. Nobody at the SACCO will know it.
      </p>
    </div>
  );
}

/**
 * A button that creates a login or resets a password through a server action,
 * and shows the resulting temporary password once in a dialog.
 */
export function IssuePasswordButton(props: Omit<React.ComponentProps<typeof IssuePasswordDialog>, 'onClose'>) {
  const [dialogProps, setDialogProps] = useState<typeof props | null>(null);
  return <>
    <Button variant={props.variant ?? 'outline'} size={props.size ?? 'md'} icon={props.icon ?? 'key'} onClick={() => setDialogProps(props)}>{props.label}</Button>
    {dialogProps ? <IssuePasswordDialog {...dialogProps} onClose={() => setDialogProps(null)} /> : null}
  </>;
}

// Mount state only for the lifetime of this dialog; closing destroys the credential.
function IssuePasswordDialog({
  action,
  fields,
  title,
  description,
  confirmLabel,
  who,
  identifier,
  onClose,
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
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult<TemporaryPassword> | null, FormData>(async (prev, data) => {
    try { return await action(prev, data); }
    catch (error) {
      if (error && typeof error === 'object' && 'digest' in error &&
          typeof error.digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(error.digest)) throw error;
      return { ok: false, error: 'We could not confirm the reset. Ask an administrator to check the account and audit log before issuing another password.' };
    }
  }, null);
  const close = () => {
    if (pending) return;
    onClose();
    if (state?.ok) router.refresh();
  };
  const err = state && !state.ok ? state : null;

  return (
      <Modal open onClose={close} title={title} description={description}>
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            {state.message ? <Alert tone="warning" title="Password issue information">{state.message}</Alert> : null}
            <TemporaryPasswordCard temporary={state.data} who={who} identifier={identifier} />
            <Button size="lg" block onClick={close}>
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
              A new temporary password will be generated and shown once. They must change it at their next
              sign-in; until then their account can do nothing else.
            </Alert>
            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" disabled={pending} onClick={close}>
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Working...">
                {confirmLabel}
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
  );
}
