'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Avatar, Icon, Money } from '@/components/ui/primitives';
import { Field, Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/form';
import { formatPhone } from '@/lib/format';
import { clsx } from '@/lib/clsx';

export type PickedMember = {
  id: string;
  member_no: string;
  full_name: string;
  phone: string;
  photo_url: string | null;
  savings_balance: number;
  share_value: number;
};

/**
 * Type-ahead member selector.
 *
 * Queries `search_guarantor_candidates` (active members, capped at 10 rows,
 * matched server-side against name / member number / phone) with a 250ms
 * debounce. A cashier serving a queue never downloads the register — they
 * download at most ten rows per keystroke pause.
 */
export function MemberPicker({
  name,
  label = 'Member',
  required = true,
  excludeMemberId,
  loanId,
  initial,
  error,
  onSelect,
}: {
  name: string;
  label?: string;
  required?: boolean;
  /** Never offer this member — used to keep a borrower off their own guarantor list. */
  excludeMemberId?: string;
  loanId?: string;
  initial?: PickedMember | null;
  error?: string | null;
  onSelect?: (member: PickedMember | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedMember[]>([]);
  const [selected, setSelected] = useState<PickedMember | null>(initial ?? null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function search(term: string) {
    setQuery(term);
    if (timer.current) clearTimeout(timer.current);

    if (term.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    setOpen(true);
    timer.current = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('search_guarantor_candidates', {
        p_query: term.trim(),
        p_exclude_member: excludeMemberId ?? '00000000-0000-0000-0000-000000000000',
        p_loan_id: loanId ?? null,
      });
      setResults((data as PickedMember[]) ?? []);
      setLoading(false);
    }, 250);
  }

  function choose(member: PickedMember) {
    setSelected(member);
    setResults([]);
    setQuery('');
    setOpen(false);
    onSelect?.(member);
  }

  function clear() {
    setSelected(null);
    onSelect?.(null);
  }

  if (selected) {
    return (
      <Field label={label} error={error}>
        <input type="hidden" name={name} value={selected.id} />
        <div className="bg-surface-container-low flex items-center gap-3 rounded-lg p-3 shadow-neu-sm">
          <Avatar name={selected.full_name} src={selected.photo_url} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
              {selected.full_name}
            </p>
            <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
              {selected.member_no} · {formatPhone(selected.phone)}
            </p>
            <p className="text-label-md font-label-md text-on-surface-variant/80 truncate normal-case">
              Savings <Money value={selected.savings_balance} /> · Shares{' '}
              <Money value={selected.share_value} />
            </p>
          </div>
          <button
            type="button"
            onClick={clear}
            aria-label={`Change ${label.toLowerCase()}`}
            className="text-on-surface-variant hover:bg-surface-container-high flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
      </Field>
    );
  }

  return (
    <Field
      label={label}
      required={required}
      error={error}
      hint="Search by name, member number or phone."
    >
      <div className="relative">
        <Icon
          name="search"
          size={20}
          className="text-on-surface-variant pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setOpen(true)}
          placeholder="Search Member ID or Name"
          autoComplete="off"
          className="pl-12"
          invalid={!!error}
        />
        {loading ? (
          <Spinner className="text-primary absolute right-4 top-1/2 -translate-y-1/2" />
        ) : null}

        {open && !loading ? (
          <div
            // The styled scrollbar and scroll containment, but no arrows: a
            // click target inside a listbox that is not one of the options
            // would break the pattern the keyboard and screen reader rely on.
            className="bg-surface scroll-panel animate-slide-up absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-2xl shadow-pop"
            role="listbox"
          >
            {results.length === 0 ? (
              <p className="text-body-md font-body-md text-on-surface-variant p-4 text-center">
                No active member matches “{query.trim()}”.
              </p>
            ) : (
              results.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => choose(m)}
                  className={clsx(
                    'hover:bg-surface-container-low border-outline-variant flex w-full items-center gap-3 border-b p-3 text-left last:border-0',
                    'min-h-touch-target-min',
                  )}
                >
                  <Avatar name={m.full_name} src={m.photo_url} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="text-body-md font-body-md text-on-surface block truncate font-semibold">
                      {m.full_name}
                    </span>
                    <span className="text-label-md font-label-md text-on-surface-variant tabular block truncate normal-case">
                      {m.member_no} · {formatPhone(m.phone)}
                    </span>
                  </span>
                  <Icon name="chevron_right" size={20} className="text-on-surface-variant shrink-0" />
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </Field>
  );
}
