import { Icon } from '@/components/ui/primitives';
import { formatUGX } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { ActivityLine } from '@/lib/treasury-format';

/**
 * Today's activity, one line per kind of movement.
 *
 * Money received, money moved between the SACCO's own accounts and money paid
 * out are visually distinct - a merchant-to-bank transfer is not income, and
 * the list must not make it look like one.
 */
export function ActivityList({ lines }: { lines: ActivityLine[] }) {
  return (
    <ul className="divide-y divide-outline-variant/70">
      {lines.map((l) => {
        const zero = l.amount === 0;
        return (
          <li key={l.key} className="flex items-center gap-3 px-5 py-3">
            <span
              className={clsx(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                zero
                  ? 'bg-surface-container text-on-surface-variant'
                  : l.kind === 'in'
                    ? 'bg-tertiary-fixed text-tertiary'
                    : l.kind === 'out'
                      ? 'bg-error-container text-error'
                      : 'bg-primary-fixed text-primary',
              )}
            >
              <Icon name={l.icon} size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-md font-semibold text-on-surface">
                {l.label}
              </span>
              <span className="block text-label-md font-normal text-on-surface-variant">
                {l.kind === 'in'
                  ? 'Money received'
                  : l.kind === 'out'
                    ? 'Money paid out'
                    : l.kind === 'move'
                      ? 'Between SACCO accounts · not income or expense'
                      : 'Corrections posted'}
              </span>
            </span>
            <span
              className={clsx(
                'tabular shrink-0 text-right text-body-md font-bold',
                zero ? 'text-on-surface-variant' : 'text-on-surface',
              )}
            >
              {l.kind === 'net' && l.amount > 0 ? '+' : ''}
              {formatUGX(l.amount)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
