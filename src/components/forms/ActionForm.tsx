'use client';

import { createContext, useContext } from 'react';
import { submittedData, type Submission } from '@/components/forms/useSubmission';

/**
 * A form whose outcome is awaited rather than published through the router.
 *
 * It exists so that converting a form away from `useActionState` is a two-line
 * change at the call site: swap the hook for `useSubmission`, and the `<form
 * action={…}>` for this. Everything inside keeps working, `SubmitButton`
 * included - it reads its pending state from here instead of `useFormStatus`,
 * which clears through the same unreliable update.
 */
type FormStatus = { busy: boolean; intent: string | null };

const SubmissionStatus = createContext<FormStatus | null>(null);

/** The enclosing `ActionForm`'s state, or null under a plain form. */
export function useSubmissionStatus(): FormStatus | null {
  return useContext(SubmissionStatus);
}

export function ActionForm({
  submission,
  guard,
  children,
  ...rest
}: {
  submission: Pick<Submission<never>, 'busy' | 'intent' | 'submit'>;
  /** Return false to refuse the submission - a confirmation step not yet passed. */
  guard?: () => boolean;
  children: React.ReactNode;
} & Omit<React.FormHTMLAttributes<HTMLFormElement>, 'action' | 'onSubmit'>) {
  return (
    <SubmissionStatus.Provider value={{ busy: submission.busy, intent: submission.intent }}>
      <form
        {...rest}
        onSubmit={(event) => {
          event.preventDefault();
          if (guard && !guard()) return;
          const { formData, intent } = submittedData(event);
          void submission.submit(formData, intent);
        }}
      >
        {children}
      </form>
    </SubmissionStatus.Provider>
  );
}
