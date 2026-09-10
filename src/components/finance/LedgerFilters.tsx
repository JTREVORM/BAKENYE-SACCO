'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Input, SearchInput, Select } from '@/components/ui/form';
import { MOVEMENT_LABELS } from '@/lib/treasury-format';
import type { MovementClass } from '@/types/treasury';

/**
 * Filters for the unified ledger. Everything lives in the URL, so a filtered
 * view - "this week's cash payments by Grace" - can be bookmarked and shared.
 */
export function LedgerFilters({
  accounts,
  users,
  showAccount = true,
}: {
  accounts: { id: string; name: string }[];
  users: { id: string; full_name: string }[];
  showAccount?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');

  function set(values: Record<string, string>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(values)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    q.delete('page');
    router.push(`${pathname}?${q.toString()}`);
  }

  const active =
    ['account', 'kind', 'user', 'from', 'to', 'q', 'member'].some((k) => params.get(k)) ?? false;

  return (
    <div className="no-print mb-4 flex flex-col gap-3 rounded-3xl bg-surface p-4 shadow-neu">
      <SearchInput
        defaultValue={params.get('q') ?? ''}
        onSearch={(v) => set({ q: v })}
        placeholder="Search reference, provider ref, member or description…"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {showAccount ? (
          <Field label="Account" htmlFor="ledger-account">
            <Select
              id="ledger-account"
              value={params.get('account') ?? ''}
              onChange={(e) => set({ account: e.target.value })}
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Type" htmlFor="ledger-kind">
          <Select
            id="ledger-kind"
            value={params.get('kind') ?? ''}
            onChange={(e) => set({ kind: e.target.value })}
          >
            <option value="">All types</option>
            {(Object.keys(MOVEMENT_LABELS) as MovementClass[]).map((k) => (
              <option key={k} value={k}>
                {MOVEMENT_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Recorded by" htmlFor="ledger-user">
          <Select
            id="ledger-user"
            value={params.get('user') ?? ''}
            onChange={(e) => set({ user: e.target.value })}
          >
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="From" htmlFor="ledger-from">
            <Input
              id="ledger-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              onBlur={() => set({ from })}
              className="px-3"
            />
          </Field>
          <Field label="To" htmlFor="ledger-to">
            <Input
              id="ledger-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              onBlur={() => set({ to })}
              className="px-3"
            />
          </Field>
        </div>
      </div>

      {active ? (
        <div>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => router.push(pathname)}>
            Clear filters
          </Button>
        </div>
      ) : null}
    </div>
  );
}
