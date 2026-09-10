'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/form';

/** Previous / next through a server-paginated list, keeping every other filter. */
export function Pager({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (pages <= 1) return null;

  function go(next: number) {
    const q = new URLSearchParams(params.toString());
    if (next <= 1) q.delete('page');
    else q.set('page', String(next));
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <nav aria-label="Pages" className="no-print mt-4 flex items-center justify-between gap-3">
      <Button variant="outline" icon="chevron_left" disabled={page <= 1} onClick={() => go(page - 1)}>
        Previous
      </Button>
      <span className="text-label-md font-normal text-on-surface-variant">
        Page {page} of {pages} · {total.toLocaleString()} entries
      </span>
      <Button variant="outline" iconEnd="chevron_right" disabled={page >= pages} onClick={() => go(page + 1)}>
        Next
      </Button>
    </nav>
  );
}
