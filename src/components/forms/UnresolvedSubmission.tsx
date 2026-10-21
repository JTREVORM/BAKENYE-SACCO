'use client';

import { Alert } from '@/components/ui/states';
import { Button } from '@/components/ui/form';
import { Icon } from '@/components/ui/primitives';

/**
 * What a money form shows when the answer never came back.
 *
 * The honest statement is that nobody knows yet, so this screen says that and
 * nothing else. It offers one action - send the same submission again, which
 * the database answers with the posting it already made - and it deliberately
 * offers no way to start a fresh one, because a fresh submission carries a new
 * idempotency key and that is the only way to post this money twice.
 */
export function UnresolvedSubmission({
  busy,
  onRecheck,
  onClose,
  closeLabel = 'Leave it for now',
  noun = 'transaction',
}: {
  busy: boolean;
  onRecheck: () => void;
  onClose?: () => void;
  closeLabel?: string;
  /** What was being recorded, for the sentences below. */
  noun?: string;
}) {
  return (
    <div className="animate-slide-up flex flex-col items-center py-6 text-center">
      <div className="bg-secondary-container mb-4 flex h-16 w-16 items-center justify-center rounded-full">
        <Icon name="cloud_off" size={36} className="text-on-secondary-container" />
      </div>

      <h2 className="text-body-lg font-body-lg text-on-surface font-semibold">
        No answer came back
      </h2>
      <p className="text-body-md font-body-md text-on-surface-variant mt-2 max-w-sm">
        The connection dropped before the SACCO answered. This {noun} may have been
        recorded in full, or not at all — from here there is no way to tell.
      </p>

      <Alert tone="warning" className="mt-5 w-full text-left">
        Do not enter it again. Checking sends this same submission back, and the
        SACCO answers a submission it has already carried out with the entry it
        made the first time, so it cannot be recorded twice.
      </Alert>

      <div className="mt-6 flex w-full flex-col gap-3">
        <Button size="lg" block icon="search" loading={busy} onClick={onRecheck}>
          Check the result
        </Button>
        {onClose ? (
          <Button variant="outline" size="lg" block disabled={busy} onClick={onClose}>
            {closeLabel}
          </Button>
        ) : null}
      </div>

      <p className="text-label-md font-label-md text-on-surface-variant/80 mt-4 normal-case">
        If you leave it, check the member&rsquo;s statement before recording anything further.
      </p>
    </div>
  );
}

/**
 * The same statement, in one line, for an action that carries no idempotency
 * key: an approval, a rejection, a reversal. Re-sending one of those is not
 * safe to offer as a button, so this says what is known and sends the person to
 * the record itself. The posting functions behind these refuse a second
 * approval or a second reversal, so a reload is enough to see what happened.
 */
export function UnresolvedNotice({ noun = 'change' }: { noun?: string }) {
  return (
    <Alert tone="warning" title="No answer came back">
      The connection dropped before the SACCO answered, so this {noun} may or may not
      have been carried out. Reload this page to see where it stands before trying
      again — do not repeat it from memory.
    </Alert>
  );
}
