import type { ActionResult } from '@/lib/errors';

/** A lost response cannot tell us whether Auth already installed the password. */
export function withPasswordFeedback<T>(action: (prev: ActionResult<T> | null, data: FormData) => Promise<ActionResult<T>>) {
  return async (prev: ActionResult<T> | null, data: FormData): Promise<ActionResult<T>> => {
    try {
      return await action(prev, data);
    } catch (error) {
      // Next redirects are control flow, including the successful first change.
      if (error && typeof error === 'object' && 'digest' in error &&
          typeof error.digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(error.digest)) throw error;
      return { ok: false, error: 'We could not confirm the password change. Please sign in again. If you submitted a new password, try that password first, or contact SACCO Support for assistance.' };
    }
  };
}
