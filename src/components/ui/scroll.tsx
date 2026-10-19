'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from '@/lib/clsx';
import { Icon } from './icon';

/* ---------------------------------------------------------------------------
 * Scrolling
 *
 * Two containers — `ScrollArea` for vertical panels, `ScrollRow` for anything
 * that runs sideways — plus the hook they share. Everything else in the product
 * scrolls through one of these, so the behaviour is defined once.
 *
 * The rules they encode:
 *
 *  - The native scroller is never replaced. Wheel, trackpad, keyboard, touch
 *    and the scrollbar itself all keep working exactly as the browser intends;
 *    the arrows are an addition, not a substitute. Nothing here listens for
 *    `wheel` or `touchmove`, which is what makes hijacked scrolling feel wrong.
 *  - An arrow appears only where there is somewhere to go. A control that is
 *    always visible and usually dead teaches people to ignore it.
 *  - Arrows are for pointers. Below `md` they are not rendered at all: a phone
 *    scrolls by thumb, and 40px of chrome on a 390px screen is a real cost paid
 *    for an affordance nobody there would use.
 *  - A click scrolls smoothly, unless the reader has asked for reduced motion,
 *    in which case it jumps.
 * ------------------------------------------------------------------------- */

type Axis = 'x' | 'y';

type Edges = {
  /** Is there anything to scroll to at all? */
  scrollable: boolean;
  atStart: boolean;
  atEnd: boolean;
};

const AT_REST: Edges = { scrollable: false, atStart: true, atEnd: true };

/**
 * Track whether a scroller can move, and which end it is resting against.
 *
 * Measurement is driven by three things, because all three happen in this app
 * without the others: the user scrolls; the viewport resizes; or the content
 * changes underneath a viewport that did not move at all — which is what a
 * filtered member list or a newly loaded page of transactions does.
 */
function useScrollEdges<T extends HTMLElement>(axis: Axis) {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState<Edges>(AT_REST);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const viewport = axis === 'x' ? el.clientWidth : el.clientHeight;
    const content = axis === 'x' ? el.scrollWidth : el.scrollHeight;
    const position = axis === 'x' ? Math.abs(el.scrollLeft) : el.scrollTop;

    // A pixel of slack throughout. Sub-pixel layout routinely leaves
    // scrollWidth a fraction above clientWidth on a row that fits perfectly,
    // and a scroll position a fraction short of the end on one that does not.
    const scrollable = content - viewport > 1;

    const next: Edges = {
      scrollable,
      atStart: !scrollable || position <= 1,
      atEnd: !scrollable || position >= content - viewport - 1,
    };

    setEdges((prev) =>
      prev.scrollable === next.scrollable &&
      prev.atStart === next.atStart &&
      prev.atEnd === next.atEnd
        ? prev
        : next,
    );
  }, [axis]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Coalesce every source into one measurement per frame. Scroll events fire
    // far faster than the layout reads below are worth doing.
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };

    measure();
    el.addEventListener('scroll', schedule, { passive: true });

    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    // The viewport can hold still while its contents grow — a table gaining
    // rows, a chip row gaining filters. Observing the children catches the
    // common case; the mutation observer below catches children appearing.
    for (const child of Array.from(el.children)) resize.observe(child);

    const mutate = new MutationObserver(() => {
      resize.disconnect();
      resize.observe(el);
      for (const child of Array.from(el.children)) resize.observe(child);
      schedule();
    });
    mutate.observe(el, { childList: true, subtree: true });

    // One more measurement once the webfont has swapped in. Until then the
    // table is laid out in the fallback face, which is wider: a table that fits
    // perfectly in Inter measures as overflowing in the fallback, and the arrow
    // that puts over the header row never goes away, because the element's own
    // box never changes size afterwards and nothing else asks again.
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => {
        if (!cancelled) schedule();
      });
    }

    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      el.removeEventListener('scroll', schedule);
      resize.disconnect();
      mutate.disconnect();
    };
  }, [measure]);

  return { ref, ...edges };
}

/** Reduced motion is checked per click rather than cached: it can change. */
function scrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined' || !window.matchMedia) return 'smooth';
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/**
 * Move one screenful, less a sliver.
 *
 * The overlap is the point: landing with a row or two of the previous view
 * still on screen is what keeps a paged scroll readable instead of feeling
 * like a jump cut.
 */
function page(el: HTMLElement | null, axis: Axis, direction: 1 | -1) {
  if (!el) return;
  const viewport = axis === 'x' ? el.clientWidth : el.clientHeight;
  const distance = Math.max(120, viewport * 0.82) * direction;
  el.scrollBy({ [axis === 'x' ? 'left' : 'top']: distance, behavior: scrollBehavior() });
}

/* ------------------------------------------------------------------------- */

/**
 * The control itself: a small raised disc, in the same soft-UI vocabulary as
 * every other button in the product, that sinks when pressed and fades to
 * unmistakably dead at the end of its travel.
 *
 * It is deliberately not a `<Button>`. This is chrome attached to a scroller,
 * not an action in the page, and it must never be picked up by a form's submit
 * handling or turn up in the tab order ahead of the content it scrolls — hence
 * `tabIndex={-1}` and `aria-hidden`. Keyboard users scroll the panel with the
 * keys the browser already gives them, which is both faster and standard.
 */
function ScrollButton({
  icon,
  label,
  disabled,
  onClick,
  className,
  tone = 'light',
}: {
  icon: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
  className?: string;
  tone?: 'light' | 'dark';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      tabIndex={-1}
      aria-hidden="true"
      title={label}
      // Screen furniture. A register printed for the committee should not come
      // out with two chevrons floating over the first and last columns.
      data-scroll-control=""

      className={clsx(
        'hidden h-8 w-8 shrink-0 items-center justify-center rounded-full md:flex',
        'transition-[opacity,box-shadow,background-color] duration-150',
        // The important modifier is not decoration. `group-hover:opacity-100`
        // fires from the wrapper, not the button, so hovering anywhere in the
        // table would otherwise light a dead arrow back up to full strength
        // and throw away the one signal that says there is nothing that way.
        'disabled:pointer-events-none disabled:!opacity-25 disabled:shadow-none',
        tone === 'dark'
          ? 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white active:bg-white/5'
          : 'bg-surface text-on-surface-variant shadow-neu-sm hover:text-primary hover:shadow-card active:shadow-neu-pressed',
        className,
      )}
    >
      <Icon name={icon} size={20} filled={false} />
    </button>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * A vertical scroller with optional up/down controls.
 *
 * `controls`:
 *  - `pager` — a stacked pair floating in the bottom-right corner. For the
 *    page-length scrollers, where the corner is margin rather than content.
 *  - `edge`  — a single small disc at whichever edge has more to show, centred
 *    on it. For panels too narrow or too dense to give up a corner: navigation
 *    rails, dialog bodies.
 *  - `none`  — the styled scrollbar and nothing else.
 */
export function ScrollArea({
  children,
  className,
  wrapperClassName,
  controls = 'pager',
  tone = 'light',
  stableGutter = false,
  ...rest
}: {
  children: React.ReactNode;
  /** Applied to the scrolling viewport. */
  className?: string;
  /** Applied to the positioned wrapper the controls are anchored to. */
  wrapperClassName?: string;
  controls?: 'pager' | 'edge' | 'none';
  tone?: 'light' | 'dark';
  /**
   * Reserve the scrollbar's width whether or not it is showing. Worth it on
   * the page-length scrollers, where otherwise every navigation between a
   * short screen and a long one shifts the whole layout sideways.
   */
  stableGutter?: boolean;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  const { ref, scrollable, atStart, atEnd } = useScrollEdges<HTMLDivElement>('y');

  return (
    <div className={clsx('relative flex min-h-0 flex-col', wrapperClassName)}>
      <div
        ref={ref}
        className={clsx(
          'min-h-0 flex-1 overflow-y-auto',
          tone === 'dark' && 'scroll-dark',
          stableGutter && 'scroll-gutter',
          className,
        )}
        {...rest}
      >
        {children}
      </div>

      {controls === 'pager' && scrollable ? (
        <div className="pointer-events-none absolute bottom-4 right-3 z-20 flex flex-col gap-1.5">
          <ScrollButton
            icon="expand_less"
            label="Scroll up"
            tone={tone}
            disabled={atStart}
            onClick={() => page(ref.current, 'y', -1)}
            className="pointer-events-auto"
          />
          <ScrollButton
            icon="expand_more"
            label="Scroll down"
            tone={tone}
            disabled={atEnd}
            onClick={() => page(ref.current, 'y', 1)}
            className="pointer-events-auto"
          />
        </div>
      ) : null}

      {controls === 'edge' && scrollable ? (
        <>
          {!atStart ? (
            <ScrollButton
              icon="expand_less"
              label="Scroll up"
              tone={tone}
              disabled={false}
              onClick={() => page(ref.current, 'y', -1)}
              className="absolute left-1/2 top-1 z-20 -translate-x-1/2"
            />
          ) : null}
          {!atEnd ? (
            <ScrollButton
              icon="expand_more"
              label="Scroll down"
              tone={tone}
              disabled={false}
              onClick={() => page(ref.current, 'y', 1)}
              className="absolute bottom-1 left-1/2 z-20 -translate-x-1/2"
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * A horizontal scroller with left/right controls.
 *
 * `arrows`:
 *  - `flank` — the controls sit outside the scroller, one either side, in a
 *    flex row. Nothing is ever covered, which is what a strip of filter chips
 *    needs: every pixel of it is a tap target.
 *  - `overlay` — the controls float over the left and right edges, vertically
 *    centred, and appear when the pointer is over the panel. For a wide table,
 *    where flanking arrows would mean a tall thin button column down each side
 *    and 70px less room for the data.
 *
 * Either way they are absent below `md` and absent when the content fits.
 */
export function ScrollRow({
  children,
  className,
  wrapperClassName,
  arrows = 'flank',
  label,
  ...rest
}: {
  children: React.ReactNode;
  /** Applied to the scrolling viewport. */
  className?: string;
  /** Applied to the wrapper. */
  wrapperClassName?: string;
  arrows?: 'flank' | 'overlay' | 'none';
  /** Names the scrollable region for assistive technology. */
  label?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  const { ref, scrollable, atStart, atEnd } = useScrollEdges<HTMLDivElement>('x');

  // A region that can scroll must be reachable and announced. `tabindex=0` on
  // an overflowing scroller is what lets a keyboard user scroll it with the
  // arrow keys at all — without it the content is unreachable, which is the
  // usual way a custom scroll container fails an audit.
  const viewport = (
    <div
      ref={ref}
      role={scrollable ? 'region' : undefined}
      aria-label={scrollable ? label : undefined}
      tabIndex={scrollable ? 0 : undefined}
      className={clsx('min-w-0 flex-1 overflow-x-auto', className)}
      {...rest}
    >
      {children}
    </div>
  );

  if (arrows === 'none') {
    return <div className={clsx('min-w-0', wrapperClassName)}>{viewport}</div>;
  }

  if (arrows === 'overlay') {
    return (
      <div className={clsx('group relative min-w-0', wrapperClassName)}>
        {viewport}
        {scrollable ? (
          <>
            <ScrollButton
              icon="chevron_left"
              label="Scroll left"
              disabled={atStart}
              onClick={() => page(ref.current, 'x', -1)}
              className={clsx(
                // Anchored to the top of the region, not its middle. A register
                // runs to several screenfuls, and a control centred on the
                // whole table lands a thousand pixels below the fold — present
                // in the DOM, invisible in practice. The top edge is where the
                // reader meets the table, and on a data table it is the header
                // row, which is the least costly strip to sit on.
                'absolute left-1.5 top-2 z-20',
                // Present whenever there is somewhere to go, but held back a
                // little until the pointer arrives. Hiding it completely was
                // the first attempt and it was wrong: an affordance nobody can
                // see until they happen to hover the right panel is not an
                // affordance. The few pixels of cell it covers are the ones
                // the click is about to scroll away.
                'opacity-80 group-hover:opacity-100 group-focus-within:opacity-100',
              )}
            />
            <ScrollButton
              icon="chevron_right"
              label="Scroll right"
              disabled={atEnd}
              onClick={() => page(ref.current, 'x', 1)}
              className={clsx(
                'absolute right-1.5 top-2 z-20',
                'opacity-80 group-hover:opacity-100 group-focus-within:opacity-100',
              )}
            />
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className={clsx('flex min-w-0 items-center gap-1.5', wrapperClassName)}>
      {scrollable ? (
        <ScrollButton
          icon="chevron_left"
          label="Scroll left"
          disabled={atStart}
          onClick={() => page(ref.current, 'x', -1)}
        />
      ) : null}
      {viewport}
      {scrollable ? (
        <ScrollButton
          icon="chevron_right"
          label="Scroll right"
          disabled={atEnd}
          onClick={() => page(ref.current, 'x', 1)}
        />
      ) : null}
    </div>
  );
}
