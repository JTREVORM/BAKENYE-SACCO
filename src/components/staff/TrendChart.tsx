import { formatUGX, toNumber } from '@/lib/money';
import type { TrendPoint } from '@/lib/queries';

/**
 * Collections trend.
 *
 * Hand-rolled inline SVG rather than a charting library. Recharts and its peers
 * are 100–200KB of JavaScript for what is, here, twelve rectangles and some
 * text — and on the low-end Android phones this SACCO runs on, that is a
 * noticeable share of the page's whole budget. This renders on the server, so
 * the phone downloads finished markup and no chart code at all.
 *
 * The data comes pre-bucketed from `collections_trend()`, so the browser never
 * receives a year of raw transactions to aggregate.
 */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="text-body-md font-body-md text-on-surface-variant p-6 text-center">
        No collections recorded yet.
      </p>
    );
  }

  const series = points.map((p) => ({
    label: p.label,
    savings: toNumber(p.savings),
    repayments: toNumber(p.repayments),
    shares: toNumber(p.shares),
    total: toNumber(p.savings) + toNumber(p.repayments) + toNumber(p.shares),
  }));

  const max = Math.max(...series.map((s) => s.total), 1);

  // A fixed viewBox scaled by CSS: crisp at 320px and at 1920px, with no
  // resize listener and no layout thrash.
  const width = 100;
  const height = 44;
  const gap = 2;
  const barWidth = (width - gap * (series.length - 1)) / series.length;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height + 8}`}
        className="h-40 w-full"
        role="img"
        aria-label={`Collections over the last ${series.length} months, peaking at ${formatUGX(max)}`}
        preserveAspectRatio="none"
      >
        {series.map((s, i) => {
          const x = i * (barWidth + gap);
          const savingsH = (s.savings / max) * height;
          const repayH = (s.repayments / max) * height;
          const sharesH = (s.shares / max) * height;
          let y = height;

          const segments = [
            { h: savingsH, fill: '#0e3483' },   // primary — savings
            { h: repayH, fill: '#005e23' },     // tertiary-container — repayments
            { h: sharesH, fill: '#fcd400' },    // secondary-container — shares
          ];

          return (
            <g key={s.label}>
              {segments.map((seg, j) => {
                if (seg.h <= 0) return null;
                y -= seg.h;
                return (
                  <rect
                    key={j}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={seg.h}
                    fill={seg.fill}
                    rx={0.6}
                  />
                );
              })}
              {/* An empty month still gets a baseline tick, so a gap reads as
                  "nothing collected" rather than "chart is broken". */}
              {s.total === 0 ? (
                <rect x={x} y={height - 0.6} width={barWidth} height={0.6} fill="#c4c6d3" rx={0.3} />
              ) : null}
            </g>
          );
        })}
      </svg>

      {/* Labels sit outside the stretched SVG so the text is never distorted. */}
      <div className="mt-1 flex w-full gap-[2%]">
        {series.map((s) => (
          <span
            key={s.label}
            className="text-label-md font-label-md text-on-surface-variant flex-1 text-center normal-case"
          >
            {s.label}
          </span>
        ))}
      </div>

      <figcaption className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        <Key colour="#0e3483" label="Savings" />
        <Key colour="#005e23" label="Loan repayments" />
        <Key colour="#fcd400" label="Shares" />
      </figcaption>
    </figure>
  );
}

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="text-label-md font-label-md text-on-surface-variant flex items-center gap-1.5 normal-case">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: colour }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
