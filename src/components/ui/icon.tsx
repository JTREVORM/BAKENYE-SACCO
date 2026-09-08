import { clsx } from '@/lib/clsx';
import type { IconName } from '@/lib/icons';

/* ---------------------------------------------------------------------------
 * Icon
 *
 * Material Symbols, rendered as a ligature. `aria-hidden` because every icon in
 * this app is paired with a text label or an accessible name on its control.
 *
 * It lives in its own module rather than in `primitives.tsx` because the scroll
 * containers need it and `primitives.tsx` needs them: `DataTable` and `TabBar`
 * both scroll sideways. Two modules importing each other would work in ESM
 * right up until one of them is a client boundary and the other is not, which
 * is exactly the case here. One leaf module both can import costs nothing and
 * removes the question.
 *
 * `primitives.tsx` re-exports it, so the fifty-odd files that import `Icon`
 * from there are unaffected.
 * ------------------------------------------------------------------------- */
export function Icon({
  name,
  className,
  size,
  filled = true,
  weight = 400,
}: {
  name: IconName | string;
  className?: string;
  size?: number;
  filled?: boolean;
  weight?: 300 | 400 | 500 | 600;
}) {
  return (
    <span
      aria-hidden="true"
      className={clsx('material-symbols-outlined select-none', className)}
      style={{
        ...(size ? { fontSize: `${size}px`, width: `${size}px`, height: `${size}px` } : null),
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`,
      }}
    >
      {name}
    </span>
  );
}
