'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/primitives';

/**
 * Before / after values for an audit entry.
 *
 * Collapsed by default and rendered only when opened — an audit page showing
 * thirty entries would otherwise ship thirty JSON blobs to a phone that will
 * probably read none of them.
 *
 * Only fields that actually changed are listed. A dump of forty identical
 * columns hides the one that moved.
 */
export function AuditDiff({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  const [open, setOpen] = useState(false);

  const before = asRecord(oldValue);
  const after = asRecord(newValue);

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => !IGNORED.has(k))
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));

  if (keys.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-label-md font-label-md text-primary hover:bg-surface-container-high inline-flex h-9 items-center gap-1 rounded-lg px-2 normal-case"
      >
        <Icon name={open ? 'expand_less' : 'expand_more'} size={18} />
        {open ? 'Hide changes' : `${keys.length} field${keys.length === 1 ? '' : 's'} changed`}
      </button>

      {open ? (
        <dl className="border-outline-variant mt-2 divide-y divide-outline-variant/70 rounded-lg border text-xs">
          {keys.map((k) => (
            <div key={k} className="grid grid-cols-3 gap-2 p-2">
              <dt className="text-on-surface-variant truncate font-medium">{humanise(k)}</dt>
              <dd className="text-on-surface-variant break-words line-through">
                {display(before[k])}
              </dd>
              <dd className="text-on-surface break-words font-semibold">{display(after[k])}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Noise that changes on every write and tells a reader nothing. */
const IGNORED = new Set(['updated_at', 'created_at', 'id']);

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function humanise(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
