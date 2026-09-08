'use client';

import { useEffect, useId, useRef } from 'react';
import { Icon } from './primitives';
import { ScrollArea } from './scroll';
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
        'animate-fade-in bg-transparent p-0 backdrop:bg-ink/55 backdrop:backdrop-blur-[2px]',
        // Mobile: bottom sheet.
        'm-0 mt-auto w-full max-w-full',
        // Desktop: centred.
        'sm:m-auto sm:w-[calc(100%-2rem)]',
        size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md',
      )}
    >
      <div
        className={clsx(
          'flex max-h-[88dvh] flex-col overflow-hidden bg-surface shadow-pop',
          'rounded-t-3xl sm:rounded-3xl',
        )}
      >
        {/* Grab handle. Present only in the sheet presentation, where it is
            the affordance that says "this can be dismissed downwards". */}
        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <span className="h-1.5 w-11 rounded-full bg-surface-container shadow-neu-inset-sm" />
        </div>

        <div className="flex items-start justify-between gap-3 border-b border-outline-variant/70 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-title-md text-on-surface">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-body-md font-body-md text-on-surface-variant">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-shadow hover:bg-surface hover:shadow-neu-sm active:shadow-neu-pressed"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* A long form in a capped dialog is the case the brief calls out: the
            body scrolls, `overscroll-contain` keeps a flick at the end of it
            from scrolling the page behind, and a chevron appears at whichever
            edge still has content. */}
        <ScrollArea
          controls="edge"
          wrapperClassName="min-h-0"
          className="scroll-panel p-5"
          style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </ScrollArea>
      </div>
    </dialog>
  );
}
