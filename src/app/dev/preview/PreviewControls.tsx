'use client';

import { useEffect, useState } from 'react';

/**
 * Live viewport readout for the design preview.
 *
 * Shows the current width and the nearest Tailwind breakpoint, so a layout
 * problem spotted while resizing can be reported against a specific width
 * rather than "on mobile".
 */
const WIDTHS = [320, 360, 375, 390, 430, 768, 1024, 1440, 1920];

export function PreviewControls() {
  const [width, setWidth] = useState<number | null>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    function measure() {
      setWidth(window.innerWidth);
      // Horizontal overflow anywhere on the page is a hard failure.
      setOverflow(document.documentElement.scrollWidth > window.innerWidth + 1);
    }
    measure();
    window.addEventListener('resize', measure);
    const timer = setInterval(measure, 1000);
    return () => {
      window.removeEventListener('resize', measure);
      clearInterval(timer);
    };
  }, []);

  const breakpoint =
    width === null
      ? '—'
      : width >= 1536
        ? '2xl'
        : width >= 1280
          ? 'xl'
          : width >= 1024
            ? 'lg'
            : width >= 768
              ? 'md'
              : width >= 640
                ? 'sm'
                : 'base';

  return (
    <div
      data-preview-chrome
      className="bg-surface flex flex-wrap items-center gap-3 rounded-xl p-4 shadow-neu-sm"
    >
      <span className="text-button-text font-button-text text-on-surface tabular">
        {width ?? '—'}px · {breakpoint}
      </span>

      <span
        className={`text-label-md font-label-md rounded-full px-3 py-1 normal-case ${
          overflow ? 'bg-error text-on-error' : 'bg-tertiary-container text-white'
        }`}
      >
        {overflow ? 'Horizontal overflow detected' : 'No horizontal overflow'}
      </span>

      <div className="flex flex-wrap gap-1">
        {WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => window.resizeTo(w, window.outerHeight)}
            className="bg-surface-container text-on-surface-variant hover:bg-surface-container-high text-label-md font-label-md h-8 rounded-full px-3 normal-case"
            title="Only works when the window can be resized by script; otherwise use devtools."
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}
