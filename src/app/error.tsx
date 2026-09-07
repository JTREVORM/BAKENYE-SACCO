'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/form';
import { Icon } from '@/components/ui/primitives';

/**
 * Application error boundary.
 *
 * Shows what happened in plain language and offers a way forward. The `digest`
 * is included because it is the only thing that links what the member saw to
 * what the server logged — but it is presented as a reference code, not as a
 * stack trace.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side logging happens in the platform's own log; this puts the
    // detail somewhere a developer can find it during local debugging without
    // ever rendering it to the member.
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="bg-background flex min-h-[100dvh] flex-col items-center justify-center px-container-margin-mobile text-center">
      <Image
        src="/brand/bnd-logo.png"
        alt=""
        width={72}
        height={72}
        className="mb-6 h-18 w-18 object-contain opacity-80"
      />

      <div className="bg-error-container text-on-error-container mb-5 flex h-16 w-16 items-center justify-center rounded-full">
        <Icon name="error" size={32} />
      </div>

      <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
        Something went wrong
      </h1>
      <p className="text-body-md font-body-md text-on-surface-variant mt-2 max-w-sm">
        We could not complete that. Your money and records are safe — nothing was changed. Please
        try again, or contact the SACCO office if it keeps happening.
      </p>

      {error.digest ? (
        <p className="text-label-md font-label-md text-on-surface-variant/70 tabular mt-4 normal-case">
          Reference: {error.digest}
        </p>
      ) : null}

      <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
        <Button size="lg" block icon="refresh" onClick={reset}>
          Try again
        </Button>
        <Link
          href="/"
          className="text-primary bg-surface h-touch-target-primary text-button-text font-button-text flex items-center justify-center rounded-lg font-semibold shadow-neu-sm"
        >
          Go to the home screen
        </Link>
      </div>
    </div>
  );
}
