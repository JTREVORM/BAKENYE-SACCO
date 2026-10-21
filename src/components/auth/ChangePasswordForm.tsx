'use client';

import { useRef, useState } from 'react';
import { changePassword } from '@/app/(auth)/actions';
import { Alert } from '@/components/ui/states';
import { Button, Field, Input } from '@/components/ui/form';
import type { ActionResult } from '@/lib/errors';

/**
 * Change your own password while signed in - members and staff alike.
 *
 * This changes the password and nothing else. A member's name, phone and member
 * number are the SACCO's official record and are changed only by staff; the
 * password is the member's own.
 *
 * Requires the current password, so an unattended unlocked phone cannot be used
 * to take over the account. That check stays on the server: the action
 * re-authenticates against Auth and this component only ever sees its verdict.
 *
 * The verdict is awaited here and held in component state, and the submission
 * is handled in `onSubmit` rather than through the form's own `action`. The
 * action's promise resolves with the result on every attempt, but both
 * `useActionState` and a form action publish their result - and clear their
 * pending state - through an app-router update, and on these profile pages
 * that update commits only intermittently: a refused password showed no error
 * at all in most attempts, and the control could stay on "Saving…" after one
 * that did. Awaiting the call changes nothing about the request itself; the
 * password is still verified on the server, by the same action.
 *
 * The cost is that this form now needs JavaScript, where the form action
 * previously let it submit without it.
 */
export function ChangePasswordForm() {
  const [result, setResult] = useState<ActionResult<null> | null>(null);
  const [busy, setBusy] = useState(false);
  // Answers synchronously, before React has re-rendered the disabled button,
  // so a double submit cannot post the same change twice.
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    inFlight.current = true;
    setBusy(true);
    setResult(null);
    try {
      const outcome = await changePassword(null, new FormData(form));
      setResult(outcome);
      // Once it is saved, neither password is left sitting in the page.
      if (outcome.ok) form.reset();
    } catch {
      // A dropped request leaves the password as it was; the form comes back so
      // it can be submitted again.
      setResult({ ok: false, error: 'Something went wrong. Please try again.' });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const err = result && !result.ok ? result : null;

  return (
    <section className="bg-surface-container-lowest border-surface-container-high shadow-card overflow-hidden rounded-xl border">
      <div className="border-surface-container-high bg-surface-container-low/50 border-b px-4 py-3">
        <h2 className="text-button-text font-button-text text-on-surface">Change password</h2>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-5 p-4" noValidate>
        {result?.ok ? <Alert tone="success">{result.message}</Alert> : null}
        {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

        <Field
          label="Current password"
          htmlFor="current_password"
          required
          error={err?.field === 'current_password' ? err.error : null}
        >
          <Input
            id="current_password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
            invalid={err?.field === 'current_password'}
          />
        </Field>

        <Field
          label="New password"
          htmlFor="new_password"
          required
          hint="At least 8 characters, including a letter and a number."
          error={err?.field === 'password' ? err.error : null}
        >
          <Input
            id="new_password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            invalid={err?.field === 'password'}
          />
        </Field>

        <Field
          label="Confirm new password"
          htmlFor="confirm_password"
          required
          error={err?.field === 'confirm' ? err.error : null}
        >
          <Input
            id="confirm_password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            enterKeyHint="done"
            required
            invalid={err?.field === 'confirm'}
          />
        </Field>

        <Button type="submit" size="lg" block loading={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </section>
  );
}
