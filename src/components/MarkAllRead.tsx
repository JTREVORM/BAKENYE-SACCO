'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markNotificationsRead } from '@/app/actions/members';
import { Button } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import type { ActionResult } from '@/lib/errors';

export function MarkAllRead() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const busy = useRef(false);
  const router = useRouter();

  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant="ghost" size="sm" icon="done_all" loading={pending}
        onClick={() => {
          if (busy.current) return;
          busy.current = true;
          setResult(null);
          start(async () => {
            try {
              const next = await markNotificationsRead();
              setResult(next);
              if (next.ok) router.refresh();
            } catch {
              setResult({ ok: false, error: 'Unable to confirm the update. Please check your connection and try again.' });
            } finally {
              busy.current = false;
            }
          });
        }}
      >Mark all read</Button>
      {result ? <Alert tone={result.ok ? 'success' : 'error'}>{result.ok ? (result.message ?? 'All notifications marked as read.') : result.error}</Alert> : null}
    </div>
  );
}
