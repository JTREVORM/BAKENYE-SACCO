import Link from 'next/link';
import { Icon } from '@/components/ui/primitives';

/** A page-header action: the dark pill for the main one, the raised light pill beside it. */
export function ActionLink({
  href,
  icon,
  label,
  primary,
}: {
  href: string;
  icon: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? 'inline-flex h-touch-target-min items-center gap-2 rounded-full bg-ink px-5 text-button-text font-semibold text-white shadow-neu-dark transition-colors hover:bg-ink-soft'
          : 'inline-flex h-touch-target-min items-center gap-2 rounded-full bg-surface px-5 text-button-text font-semibold text-on-surface shadow-neu transition-shadow hover:shadow-card-hover'
      }
    >
      <Icon name={icon} size={18} />
      {label}
    </Link>
  );
}
