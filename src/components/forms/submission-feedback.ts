import type { ActionResult } from '@/lib/errors';
import type { SubmissionStatus } from '@/types/db';
import { createClient } from '@/lib/supabase/client';

export type UncertainSubmission = {
  ok: false;
  error: string;
  uncertain: true;
  verification: SubmissionStatus | null;
};

/** The action contract has no transport flag. Generic failures are ambiguous too. */
export function mayBeLostResponse(message: string) {
  return /fetch|network|timeout|timed out|abort|connection|unexpected response|failed to find server action|something went wrong/i.test(message);
}

/** Read-only, submitter-scoped lookup. A failed lookup is never 'not found'. */
export async function verifySubmission(key: string): Promise<SubmissionStatus | null> {
  try {
    const { data, error } = await createClient().rpc('submission_status', { p_idempotency_key: key })
      .abortSignal(AbortSignal.timeout(15_000));
    if (error || !data || typeof data !== 'object' || !('found' in data)) return null;
    return data as SubmissionStatus;
  } catch {
    return null;
  }
}

export async function submitWithFeedback<T>(
  action: (prev: ActionResult<T> | null, form: FormData) => Promise<ActionResult<T>>,
  prev: ActionResult<T> | null,
  form: FormData,
): Promise<ActionResult<T> | UncertainSubmission> {
  try {
    const result = await action(prev, form);
    if (result.ok || !mayBeLostResponse(result.error)) return result;
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error &&
          typeof error.digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(error.digest)) throw error;
  }
  const key = String(form.get('idempotency_key') ?? '');
  return {
    ok: false,
    error: 'The submission response was lost. Its outcome needs verification.',
    uncertain: true,
    verification: key ? await verifySubmission(key) : null,
  };
}
