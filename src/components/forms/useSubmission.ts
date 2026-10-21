'use client';

import { useCallback, useRef, useState } from 'react';
import type { ActionResult } from '@/lib/errors';

/**
 * Running one server action and knowing, afterwards, what it did.
 *
 * Certification found money being posted to the ledger while the screen said
 * nothing at all. The cause was never the action: its promise resolves with the
 * result every time. `useActionState` publishes that result through an
 * app-router tree update, and on these pages the update commits only
 * intermittently, so the outcome could simply never arrive on screen. The same
 * update clears `useFormStatus`, so a control could also stay on "Processing…"
 * after a result that had already been decided.
 *
 * So the call is awaited here and the outcome is held in component state. The
 * request is unchanged - same action, same server, same posting rules.
 *
 * There are three ends to a submission, and a money form must tell them apart:
 *
 *   - `result.ok`      the server carried it out, and said so
 *   - `!result.ok`     the server refused it, and said why
 *   - `unresolved`     the answer never came back
 *
 * The third is not a failure. The request may have been carried out in full;
 * only the answer was lost. So the submission keeps its identity - the same
 * `FormData`, carrying the same idempotency key - and `recheck()` sends exactly
 * that again. Every posting function in this database returns the original row
 * for a key it has already seen, so the re-send either reports the posting that
 * happened or performs the one that never did. Precisely one ledger row either
 * way; nothing here retries on its own.
 */
export type Submission<T> = {
  /** The server's answer, once there is one. */
  result: ActionResult<T> | null;
  /** The answer never came back. The submission may or may not have been carried out. */
  unresolved: boolean;
  /** A request is open. */
  busy: boolean;
  /** The `name`/`value` of the button that was pressed, when the form has more than one. */
  intent: string | null;
  submit: (formData: FormData, intent?: string | null) => Promise<void>;
  /** Re-send the unresolved submission unchanged, to find out what became of it. */
  recheck: () => Promise<void>;
  reset: () => void;
};

export function useSubmission<T>(
  action: (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>,
): Submission<T> {
  const [result, setResult] = useState<ActionResult<T> | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<string | null>(null);
  // Answers synchronously, before React has re-rendered the disabled control,
  // so a second press cannot open a second request.
  const inFlight = useRef(false);
  // What was sent, so it can be sent again byte for byte.
  const sent = useRef<FormData | null>(null);

  const run = useCallback(
    async (formData: FormData, pressed: string | null) => {
      if (inFlight.current) return;
      inFlight.current = true;
      sent.current = formData;
      setIntent(pressed);
      setBusy(true);
      setResult(null);
      setUnresolved(false);
      try {
        setResult(await action(null, formData));
      } catch {
        // No answer. Saying "it failed" here would be a guess, and the wrong
        // one half the time, so the form says what is actually known.
        setUnresolved(true);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [action],
  );

  const submit = useCallback(
    (formData: FormData, pressed: string | null = null) => run(formData, pressed),
    [run],
  );

  const recheck = useCallback(async () => {
    const previous = sent.current;
    if (!previous) return;
    await run(previous, intent);
  }, [run, intent]);

  const reset = useCallback(() => {
    sent.current = null;
    setResult(null);
    setUnresolved(false);
    setIntent(null);
  }, []);

  return { result, unresolved, busy, intent, submit, recheck, reset };
}

/**
 * The `FormData` a submit event is posting, including the pressed button's own
 * `name`/`value` - which is how a form tells "Submit" from "Save as draft".
 */
export function submittedData(event: React.FormEvent<HTMLFormElement>): {
  formData: FormData;
  intent: string | null;
} {
  const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
  return {
    formData: new FormData(event.currentTarget, submitter),
    intent: submitter?.value ?? null,
  };
}
