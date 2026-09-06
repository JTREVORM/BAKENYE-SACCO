'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markNotificationsRead } from '@/app/actions/members';
import { Button } from '@/components/ui/form';

export function MarkAllRead() {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Button
      variant="ghost"
      size="sm"
      icon="done_all"
      loading={pending}
      onClick={() =>
        start(async () => {
          await markNotificationsRead();
          router.refresh();
        })
      }
    >
      Mark all read
    </Button>
  );
}
