'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Avatar, Badge, Icon, Money } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { formatDate, formatPhone } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { SAVINGS_FREQUENCY_ADVERB, categoryTier } from '@/lib/categories';
import { clsx } from '@/lib/clsx';
import type { MemberFinancialsRow } from '@/types/db';

/**
 * Find the member standing at the counter.
 *
 * By member number, name or phone — the three things a member can actually tell
 * you, and exactly what section 8 of the brief asks for. The search runs server
 * side through `search_members()`, so it works across the whole register rather
 * than across a page of it.
 *
 * Results are the fewest facts needed to be sure it is the right person, plus
 * the one figure the cashier is about to act on: what they still owe.
 */
export function CollectSearch({
  query,
  results,
  selectedId,
}: {
  query: string;
  results: MemberFinancialsRow[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function search(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set('q', value);
    else next.delete('q');
    // A new search invalidates whoever was open.
    next.delete('member');
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        defaultValue={query}
        onSearch={search}
        placeholder="Member number, name or phone…"
      />

      {!query ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="person_search"
            title="Search for a member"
            description="Type a member number, a name or a phone number to bring up their savings position and record what they have paid."
          />
        </div>
      ) : results.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="search_off"
            title="No member matches that"
            description="Check the spelling, or try the member number instead."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {results.map((m) => {
            const owed = toNumber(m.savings_outstanding);
            const tier = categoryTier(m.savings_category_code);
            const selected = m.id === selectedId;

            return (
              <li key={m.id}>
                <Link
                  href={`?q=${encodeURIComponent(query)}&member=${m.id}`}
                  aria-current={selected ? 'true' : undefined}
                  className={clsx(
                    'flex items-center gap-3 rounded-xl border p-3 transition-colors',
                    selected
                      ? 'border-primary bg-primary-fixed'
                      : 'bg-surface border-surface-container hover:bg-surface-container-low shadow-card',
                  )}
                >
                  <Avatar name={m.full_name} src={m.photo_url} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                      {m.full_name}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                      {m.member_no} · {formatPhone(m.phone)}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant/80 truncate normal-case">
                      {m.savings_category_name && m.savings_frequency
                        ? `${m.savings_category_name} · ${formatUGX(
                            m.savings_expected_amount,
                          )} ${SAVINGS_FREQUENCY_ADVERB[m.savings_frequency]}`
                        : 'No savings category'}
                      {m.savings_next_due_on
                        ? ` · next due ${formatDate(m.savings_next_due_on)}`
                        : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {owed > 0 ? (
                      <>
                        <p className="text-label-md font-label-md text-on-surface-variant">
                          Owes
                        </p>
                        <Money
                          value={owed}
                          className="text-button-text font-button-text text-error font-semibold"
                        />
                      </>
                    ) : (
                      <Badge tone={tier.tone} dot>
                        Up to date
                      </Badge>
                    )}
                  </div>
                  <Icon name="chevron_right" size={20} className="text-outline shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
