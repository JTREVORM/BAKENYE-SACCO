'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SearchInput } from '@/components/ui/form';
import { clsx } from '@/lib/clsx';

const MODULES = [
  { value: '', label: 'All Modules' },
  { value: 'Members', label: 'Members' },
  { value: 'Savings', label: 'Savings' },
  { value: 'Shares', label: 'Shares' },
  { value: 'Loans', label: 'Loans' },
  { value: 'Financials', label: 'Financials' },
  { value: 'User Management', label: 'User Management' },
];

export function AuditFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  const module = params.get('module') ?? '';

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        defaultValue={params.get('q') ?? ''}
        onSearch={(v) => setParam('q', v)}
        placeholder="Search by user, action..."
      />

      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {MODULES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setParam('module', m.value)}
            aria-pressed={module === m.value}
            className={clsx(
              'text-label-md font-label-md h-touch-target-min shrink-0 rounded-full px-4 normal-case transition-colors',
              module === m.value
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
