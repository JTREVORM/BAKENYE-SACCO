'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SearchInput } from '@/components/ui/form';

/** A search box that writes `?q=` and keeps every other filter. */
export function SearchBox({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <SearchInput
      className="min-w-0 flex-1 sm:max-w-md"
      defaultValue={params.get('q') ?? ''}
      placeholder={placeholder}
      onSearch={(v) => {
        const q = new URLSearchParams(params.toString());
        if (v) q.set('q', v);
        else q.delete('q');
        q.delete('page');
        router.push(`${pathname}?${q.toString()}`);
      }}
    />
  );
}

/** A row of filter chips that each set one URL parameter. */
export function FilterChips({
  param,
  options,
}: {
  param: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(param) ?? '';

  return (
    <div className="no-print -mx-container-margin-mobile overflow-x-auto px-container-margin-mobile md:mx-0 md:px-0">
      <div className="flex gap-2 pb-1 md:flex-wrap">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={current === o.value}
            onClick={() => {
              const q = new URLSearchParams(params.toString());
              if (o.value) q.set(param, o.value);
              else q.delete(param);
              q.delete('page');
              router.push(`${pathname}?${q.toString()}`);
            }}
            className={
              current === o.value
                ? 'h-touch-target-min shrink-0 rounded-full bg-ink px-4 text-label-md font-semibold text-white'
                : 'h-touch-target-min shrink-0 rounded-full bg-surface px-4 text-label-md font-semibold text-on-surface-variant shadow-neu-sm hover:text-primary'
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
