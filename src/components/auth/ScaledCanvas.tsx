'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Renders the signed-out design at its intended width and shrinks the whole
 * thing to fit a narrower screen.
 *
 * This exists because the sign-in screen is specified as one fixed landscape
 * composition — brand panel beside the form — and that composition is to appear
 * on a phone as well, rather than being re-laid-out into a portrait stack.
 *
 * The trade-off is real and worth stating in the file that causes it: at 390px
 * the whole page renders at 38% and body text lands near 6px. Everything is
 * legible only by pinch-zooming, which the viewport deliberately still allows.
 * Rotating the handset to landscape roughly doubles the scale.
 *
 * Above `DESIGN_WIDTH` nothing happens at all: the children render at their
 * natural size and this component is a passthrough.
 *
 * Without JavaScript the page still works — it renders at full width and
 * scrolls sideways, which is the same bargain as any desktop site on a phone.
 */

/** The width the composition is designed against; also Tailwind's `lg`. */
const DESIGN_WIDTH = 1024;

export function ScaledCanvas({ children }: { children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | null>(null);

  // Layout effect so the scale is applied in the same frame the browser paints
  // after hydration, rather than a tick later as a visible jump.
  useIsomorphicLayoutEffect(() => {
    const node = inner.current;
    if (!node) return;

    const measure = () => {
      const next = Math.min(1, window.innerWidth / DESIGN_WIDTH);
      setScale(next);
      // The transform does not affect layout, so the wrapper has to be told
      // how tall the scaled result actually is or the footer floats away from
      // the bottom of it.
      setHeight(next < 1 ? node.offsetHeight * next : null);
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  const scaled = scale < 1;

  return (
    <div
      // No `overflow-hidden` here: in landscape the scaled composition is
      // taller than the viewport, and clipping it would put the Sign In button
      // somewhere the member cannot reach. The clipping that matters — the
      // unscaled 1024px layout width — is handled by the box below.
      className={
        scaled ? 'flex min-h-[100dvh] flex-col justify-center bg-[#0a2660]' : 'bg-[#0a2660]'
      }
    >
      {/* The transform does not take up space, so this box carries the scaled
          height and keeps the letterbox centred rather than pinned to the top
          of a much taller screen. */}
      <div style={scaled && height ? { height, overflow: 'hidden' } : undefined}>
        <div
          ref={inner}
          style={
            scaled
              ? {
                  width: DESIGN_WIDTH,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }
              : undefined
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** `useLayoutEffect` warns during SSR; on the server there is nothing to lay out. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
