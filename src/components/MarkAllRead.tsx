'use client';

import { useRef, useState } from 'react';
import { markNotificationsRead } from '@/app/actions/members';
import { Button } from '@/components/ui/form';

/**
 * "Mark all read".
 *
 * Two things here are deliberate, and both come straight out of certification.
 *
 * The busy state is held in this component rather than taken from
 * `useTransition`. A transition stays pending until the router update it
 * schedules has committed, so a spinner bound to one waits on a tree refresh
 * rather than on the member's own request — and when that refresh never
 * committed, the control stayed disabled and spinning long after the database
 * had saved the change. Settling on the action's own result means the button
 * always finishes the request it started, and says so if it failed.
 *
 * The saved state is then shown by a native navigation rather than
 * `router.refresh()`. Against a full notifications list the client router
 * applied the refreshed tree roughly one time in six, while the server's
 * response was correct every time, so the page carried on showing read
 * notifications as unread. This is the same client-navigation defect the
 * dashboard chart ranges navigate around. The mutation, its ownership checks
 * and its revalidation are unchanged.
 */
export function MarkAllRead() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Answers synchronously, before React has re-rendered the disabled button,
  // so a fast second tap cannot post the same write twice.
  const inFlight = useRef(false);

  async function markAll() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await markNotificationsRead();
      if (result.ok) window.location.reload();
      else setError(result.error);
    } catch {
      // A dropped request leaves the notifications as they were, so the button
      // comes back and can simply be pressed again.
      setError('Something went wrong. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="ghost" size="sm" icon="done_all" loading={busy} onClick={markAll}>
        Mark all read
      </Button>
      {error ? (
        <p role="alert" className="text-label-md font-label-md text-error normal-case">
          {error}
        </p>
      ) : null}
    </div>
  );
}
