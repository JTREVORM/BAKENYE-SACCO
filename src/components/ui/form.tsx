'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { clsx } from '@/lib/clsx';
import { groupDigits } from '@/lib/money';
import { Icon } from './primitives';
import type { IconName } from '@/lib/icons';

/* ---------------------------------------------------------------------------
 * Button
 *
 * Heights come straight from DESIGN.md: 44px minimum touch target, 56px for a
 * primary action. That is not a stylistic choice — it is what makes the app
 * usable one-handed on a bus.
 * ------------------------------------------------------------------------- */
type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'success';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-on-primary shadow-card hover:bg-primary-container active:bg-on-primary-fixed-variant',
  secondary:
    'bg-secondary-container text-on-secondary-fixed shadow-card hover:bg-secondary-fixed-dim active:bg-secondary-fixed-dim',
  outline:
    'bg-surface text-on-surface border border-outline-variant shadow-card hover:bg-surface-container-high hover:border-outline active:bg-surface-container-highest',
  ghost:
    'bg-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface active:bg-surface-container-highest',
  danger: 'bg-error text-on-error shadow-card hover:bg-on-error-container active:bg-on-error-container',
  success:
    'bg-tertiary text-on-tertiary shadow-card hover:bg-tertiary-container active:bg-on-tertiary-container',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconEnd,
  block,
  loading,
  className,
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** `lg` is the 56px primary action height. */
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconEnd?: IconName;
  block?: boolean;
  loading?: boolean;
}) {
  const sizes = {
    sm: 'h-9 px-3 text-label-md rounded-lg gap-1.5',
    md: 'h-touch-target-min px-4 text-button-text rounded-xl gap-2',
    lg: 'h-touch-target-primary px-6 text-button-text rounded-xl gap-2',
  }[size];

  return (
    <button
      type={type}
      disabled={loading || rest.disabled}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-semibold',
        'transition-[background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.985]',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none',
        sizes,
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={20} /> : null}
      {children}
      {iconEnd && !loading ? <Icon name={iconEnd} size={20} /> : null}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={clsx('h-4 w-4 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Submit button wired to the enclosing form's pending state.
 *
 * This is the front line against duplicate financial submissions: while the
 * server action is in flight the control is disabled and reads "Processing…",
 * so the member cannot tap twice. The idempotency key on the RPC is the second
 * line, for the case where the first response never arrives at all.
 */
export function SubmitButton({
  children,
  pendingLabel = 'Processing…',
  ...rest
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...rest}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

/* ---------------------------------------------------------------------------
 * Field wrapper — persistent label, help text, error text.
 *
 * DESIGN.md: "Input fields require persistent labels and clear error states."
 * Placeholder-only labels disappear the moment someone starts typing, which is
 * exactly when a first-time user most needs them.
 * ------------------------------------------------------------------------- */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  icon,
  emphasis = false,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  /** Rendered before the label. Used on the sign-in screen. */
  icon?: IconName;
  /**
   * A larger, sentence-case, high-contrast label.
   *
   * The dense uppercase label is right inside the app, where a cashier is
   * filling in the same form for the hundredth time. It is wrong on the
   * sign-in screen, which is the first thing anyone sees and is read once,
   * carefully.
   */
  emphasis?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className={clsx(
          'flex items-center gap-2',
          // Sentence case in both modes. The dense uppercase label the export
          // used made every form read as a tax return; weight and colour carry
          // the same hierarchy without shouting.
          emphasis
            ? 'text-body-lg font-semibold text-on-surface'
            : 'text-body-md font-semibold text-on-surface',
        )}
      >
        {icon ? (
          <Icon
            name={icon}
            size={emphasis ? 20 : 16}
            className={emphasis ? 'text-primary' : 'text-on-surface-variant'}
          />
        ) : null}
        {/* The asterisk is bound to the label text, not laid out as a sibling
            of it — as a flex child it inherited the row gap and floated away
            from the word it qualifies. */}
        <span>
          {label}
          {required ? (
            <span className="ml-0.5 text-error" aria-hidden="true">
              *
            </span>
          ) : null}
        </span>
      </label>
      {children}
      {error ? (
        <p className="text-body-md font-body-md text-error flex items-start gap-1">
          <Icon name="error" size={16} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p
          className={clsx(
            // Explicitly normal weight: `text-label-md` carries a 600 weight in
            // the type scale, which is right for a label and wrong for the
            // supporting sentence underneath a field.
            'font-normal leading-snug text-on-surface-variant',
            emphasis ? 'text-[13px]' : 'text-label-md',
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_BASE =
  'w-full bg-surface-container-lowest border border-outline-variant rounded-2xl px-4 ' +
  'text-body-lg font-body-lg text-on-surface placeholder:text-on-surface-variant/70 ' +
  'outline-none transition-[border-color,box-shadow,background-color] ' +
  'hover:border-outline focus:border-primary focus:ring-2 focus:ring-primary/20 ' +
  'disabled:bg-surface-container disabled:text-on-surface-variant disabled:hover:border-outline-variant';

/** 44px minimum height on every control. */
const CONTROL_HEIGHT = 'h-touch-target-primary';

export function Input({
  invalid,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={clsx(
        CONTROL_BASE,
        CONTROL_HEIGHT,
        invalid && 'border-error hover:border-error focus:border-error focus:ring-error/25',
        className,
      )}
      {...rest}
    />
  );
}

export function Textarea({
  invalid,
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      rows={3}
      className={clsx(
        CONTROL_BASE,
        'min-h-[88px] py-3',
        invalid && 'border-error hover:border-error focus:border-error focus:ring-error/25',
        className,
      )}
      {...rest}
    />
  );
}

export function Select({
  invalid,
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={clsx(
        CONTROL_BASE,
        CONTROL_HEIGHT,
        'appearance-none bg-[length:20px] bg-[right_12px_center] bg-no-repeat pr-10',
        invalid && 'border-error hover:border-error focus:border-error focus:ring-error/25',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%235b647a'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

/* ---------------------------------------------------------------------------
 * MoneyInput
 *
 * `inputMode="numeric"` brings up the number pad on Android — a hard
 * requirement when a teller is entering hundreds of amounts a day. The visible
 * value is digit-grouped as you type; the submitted value is a plain number,
 * so the server never has to unpick "1,200,000".
 * ------------------------------------------------------------------------- */
export function MoneyInput({
  name,
  defaultValue,
  value: controlledValue,
  onValueChange,
  invalid,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'defaultValue'> & {
  name: string;
  defaultValue?: number | string;
  value?: number | string;
  onValueChange?: (value: number | null) => void;
  invalid?: boolean;
}) {
  const [display, setDisplay] = useState(() =>
    defaultValue != null && defaultValue !== '' ? groupDigits(String(defaultValue)) : '',
  );

  // Follow the parent when it drives the value (loan wizard "use max" buttons).
  useEffect(() => {
    if (controlledValue !== undefined) {
      setDisplay(controlledValue === '' ? '' : groupDigits(String(controlledValue)));
    }
  }, [controlledValue]);

  const raw = display.replace(/[^\d]/g, '');

  return (
    <div className="relative">
      <span className="text-on-surface-variant text-body-lg font-body-lg pointer-events-none absolute left-4 top-1/2 -translate-y-1/2">
        UGX
      </span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        value={display}
        onChange={(e) => {
          const next = groupDigits(e.target.value);
          setDisplay(next);
          onValueChange?.(next ? Number(next.replace(/,/g, '')) : null);
        }}
        className={clsx(
          CONTROL_BASE,
          CONTROL_HEIGHT,
          'tabular pl-[3.75rem] text-right font-semibold',
          invalid && 'border-error hover:border-error focus:border-error focus:ring-error/25',
          className,
        )}
        {...rest}
      />
      {/* The value the form actually posts. */}
      <input type="hidden" name={name} value={raw} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * PhoneInput — numeric keypad, Ugandan format hint.
 * ------------------------------------------------------------------------- */
export function PhoneInput({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="0772 123 456"
      className={clsx('tabular', className)}
      {...rest}
    />
  );
}

/* ---------------------------------------------------------------------------
 * SearchInput — debounced, so typing "Nam" in a 500-member list issues one
 * query instead of three.
 * ------------------------------------------------------------------------- */
export function SearchInput({
  defaultValue = '',
  onSearch,
  placeholder = 'Search…',
  delay = 300,
  className,
  autoFocus,
}: {
  defaultValue?: string;
  onSearch: (value: string) => void;
  placeholder?: string;
  delay?: number;
  className?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function push(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(next.trim()), delay);
  }

  return (
    <div className={clsx('relative', className)}>
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <Icon
        name="search"
        size={20}
        className="text-on-surface-variant pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
      />
      <input
        id={id}
        type="search"
        inputMode="search"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => push(e.target.value)}
        className={clsx(
          'bg-surface-container-low border-outline-variant text-body-md font-body-md',
          'h-touch-target-min hover:bg-surface-container focus:border-primary focus:ring-primary',
          'w-full rounded-full border py-3 pl-12 pr-10 outline-none transition-colors focus:ring-1',
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setValue('');
            if (timer.current) clearTimeout(timer.current);
            onSearch('');
          }}
          className="text-on-surface-variant hover:bg-surface-container-high absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full"
        >
          <Icon name="close" size={18} />
        </button>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Sticky action bar — keeps Submit in the thumb zone on a phone without
 * covering the field being filled in.
 * ------------------------------------------------------------------------- */
export function StickyActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={clsx('sticky-actions z-30 flex gap-3', className)}>{children}</div>;
}

/* ---------------------------------------------------------------------------
 * Radio card — the loan-type and repayment-period pickers in the Stitch wizard.
 * ------------------------------------------------------------------------- */
export function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  meta,
  icon,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: string;
  description?: string;
  meta?: React.ReactNode;
  icon?: IconName;
}) {
  return (
    <label
      className={clsx(
        'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
        checked
          ? 'border-primary bg-primary-fixed ring-primary ring-1'
          : 'border-outline-variant bg-surface hover:bg-surface-container-low',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="text-primary focus:ring-primary mt-0.5 h-5 w-5 shrink-0 border-outline"
      />
      {icon ? (
        <span
          className={clsx(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            checked ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant',
          )}
        >
          <Icon name={icon} size={20} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="text-button-text font-button-text text-on-surface block">{title}</span>
        {description ? (
          <span className="text-body-md font-body-md text-on-surface-variant mt-0.5 block">
            {description}
          </span>
        ) : null}
        {meta ? <span className="mt-2 block">{meta}</span> : null}
      </span>
    </label>
  );
}
