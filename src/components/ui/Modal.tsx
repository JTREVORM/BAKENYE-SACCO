'use client';

import { useEffect, useId, useRef } from 'react';
import { Icon } from './primitives';
import { clsx } from '@/lib/clsx';

/**
 * Accessible dialog.
 *
 * Uses the native `<dialog>` element, so focus trapping, Escape-to-close and
 * inertness of the page behind it come from the platform rather than from a
 * few hundred lines of focus-management JavaScript.
 *
 * On mobile it presents as a bottom sheet — reachable with a thumb, and the
 * shape Android users expect — and as a centred dialog from `sm` up. Both are
 * scrollable and capped in height so a long form can never push its own action
 * buttons off the screen, which is the "inaccessible dialog" failure the brief
 * calls out.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      // Stop the page behind from scrolling under the sheet.
      document.body.style.overflow = 'hidden';
    } else if (!open && dialog.open) {
      dialog.close();
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Backdrop click: the dialog element itself is the backdrop area.
        if (e.target === ref.current) onClose();
      }}
      className={clsx(
        'bg-transparent p-0 backdrop:bg-black/50',
        // Mobile: bottom sheet.
        'm-0 mt-auto w-full max-w-full',
        // Desktop: centred.
        'sm:m-auto sm:w-[calc(100%-2rem)]',
        size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md',
      )}
    >
      <div
        className={clsx(
          'bg-surface flex max-h-[85dvh] flex-col overflow-hidden shadow-2xl',
          'rounded-t-xl sm:rounded-xl',
        )}
      >
        <div className="border-outline-variant/50 flex items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-button-text font-button-text text-on-surface">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="text-body-md font-body-md text-on-surface-variant mt-0.5">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-on-surface-variant hover:bg-surface-container-high -mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div
          className="overflow-y-auto p-4"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </div>
      </div>
    </dialog>
  );
}
