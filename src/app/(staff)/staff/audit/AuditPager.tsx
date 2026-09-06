'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/form';

export function AuditPager({ page, totalPages }: { page: number; totalPages: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(next: number) {
    const p = new URLSearchParams(params.toString());
    p.set('page', String(next));
    router.push(`${pathname}?${p.toString()}`);
  }

  return (
    <nav className="flex items-center justify-between gap-3" aria-label="Audit log pages">
      <Button variant="outline" icon="chevron_left" disabled={page <= 1} onClick={() => go(page - 1)}>
        Previous
      </Button>
      <span className="text-label-md font-label-md text-on-surface-variant normal-case">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        iconEnd="chevron_right"
        disabled={page >= totalPages}
        onClick={() => go(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
