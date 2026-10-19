import { formatCompactUGX, formatUGX, toNumber } from '@/lib/money';
import type { TrendPoint } from '@/lib/queries';
import { EmptyState } from '@/components/ui/states';

/**
 * Collections trend — stacked monthly bars.
 *
 * Hand-rolled inline SVG rather than a charting library. Recharts and its peers
 * are 100–200KB of JavaScript for what is, here, a few dozen rectangles — and on
 * the low-end Android phones this SACCO runs on that is a noticeable share of
 * the page's whole budget. This renders on the server, so the phone downloads
 * finished markup and no chart code at all.
 *
 * The data comes pre-bucketed from `collections_trend()`, so the browser never
 * receives a year of raw transactions to aggregate.
 *
 * Two things make it read as a real chart rather than as coloured blocks: a
 * value axis with gridlines, so a bar's height means an amount instead of a
 * ratio; and a `<title>` per bar, which the browser shows as a native tooltip
 * and a screen reader announces — an interaction that costs zero JavaScript.
 */

const SERIES = [
  { key: 'savings', label: 'Savings', fill: '#123a86' },
  { key: 'repayments', label: 'Loan repayments', fill: '#12965a' },
  { key: 'shares', label: 'Shares', fill: '#e8b800' },
] as const;

export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return (
      <EmptyState
        compact
        icon="monitoring"
        title="No collections recorded yet"
        description="Once savings, repayments and share purchases are recorded, six months of trend will appear here."
      />
    );
  }

  const series = points.map((p) => ({
    label: p.label,
    savings: toNumber(p.savings),
    repayments: toNumber(p.repayments),
    shares: toNumber(p.shares),
    total: toNumber(p.savings) + toNumber(p.repayments) + toNumber(p.shares),
  }));

  const peak = Math.max(...series.map((s) => s.total), 0);
  // Round the axis up to a friendly number so the gridline labels read as
  // amounts a person would say out loud, not as 1/4 of an arbitrary maximum.
  const max = niceCeiling(peak);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  /* A fixed viewBox scaled by CSS: crisp at 320px and at 1920px, with no
   * resize listener and no layout thrash. `preserveAspectRatio` is left at the
   * default so the bars keep their proportions instead of being stretched. */
  // The panel this sits in is two-thirds of a dashboard grid — wide and not
  // very tall. A 320x150 viewBox letterboxes in it, leaving the chart marooned
  // in the middle of a white field; these proportions fill the panel.
  const W = 600;
  const H = 190;
  const PAD_L = 52;
  const PAD_B = 24;
  const plotW = W - PAD_L;
  const plotH = H - PAD_B;

  const slot = plotW / series.length;
  const barW = Math.min(54, slot * 0.5);

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        /* Width-driven: the height follows the viewBox's ratio, so the chart
           fills the panel instead of being letterboxed in the middle of it. */
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={`Collections over the last ${series.length} months, peaking at ${formatUGX(peak)}`}
      >
        {/* Value axis */}
        {ticks.map((t, i) => {
          const y = plotH - (t / max) * plotH;
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W}
                y1={y}
                y2={y}
                stroke="#e3e9f3"
                strokeWidth="1"
                strokeDasharray={i === 0 ? undefined : '3 3'}
              />
              <text
                x={PAD_L - 10}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#5a6782"
                fontWeight="600"
              >
                {t === 0 ? '0' : compactAxis(t)}
              </text>
            </g>
          );
        })}

        {series.map((s, i) => {
          const x = PAD_L + i * slot + (slot - barW) / 2;
          let y = plotH;

          return (
            <g key={s.label}>
              {/* One string, not several. A browser treats every child node of
                  `<title>` as text and React refuses to reconcile an array
                  there, so the interpolated form threw a hydration error on
                  every dashboard load. */}
              <title>
                {`${s.label}: ${formatUGX(s.total)}${
                  s.total > 0
                    ? ` — savings ${formatUGX(s.savings)}, repayments ${formatUGX(
                        s.repayments,
                      )}, shares ${formatUGX(s.shares)}`
                    : ''
                }`}
              </title>

              {SERIES.map((seg, j) => {
                const v = s[seg.key];
                if (v <= 0) return null;
                const h = (v / max) * plotH;
                y -= h;
                const isTop = j === topSegment(s);
                return (
                  <rect
                    key={seg.key}
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    fill={seg.fill}
                    /* Only the topmost segment of a stack is rounded; rounding
                       every segment would draw visible notches through the bar. */
                    rx={isTop ? 3 : 0}
                    ry={isTop ? 3 : 0}
                  />
                );
              })}

              {/* An empty month still gets a baseline tick, so a gap reads as
                  "nothing collected" rather than "chart is broken". */}
              {s.total === 0 ? (
                <rect x={x} y={plotH - 2} width={barW} height={2} fill="#d9e1ee" rx={1} />
              ) : null}

              <text
                x={x + barW / 2}
                y={H - 7}
                textAnchor="middle"
                fontSize="11"
                fill="#5a6782"
                fontWeight="600"
              >
                {s.label}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-outline-variant pt-3">
        {SERIES.map((s) => (
          <Key key={s.key} colour={s.fill} label={s.label} />
        ))}
      </figcaption>
    </figure>
  );
}

/** Index of the last non-zero segment, i.e. the one drawn at the top. */
function topSegment(s: { savings: number; repayments: number; shares: number }): number {
  for (let i = SERIES.length - 1; i >= 0; i -= 1) {
    if (s[SERIES[i].key] > 0) return i;
  }
  return -1;
}

/** 1, 2 or 5 times a power of ten — the numbers axes are conventionally drawn at. */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function compactAxis(value: number): string {
  const { amount } = formatCompactUGX(value);
  return amount;
}

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-2 text-label-md font-medium text-on-surface-variant">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: colour }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Sparkline — a single series, for a card header rather than a panel.
 * ------------------------------------------------------------------------- */
export function Sparkline({
  values,
  className,
  tone = '#123a86',
}: {
  values: number[];
  className?: string;
  tone?: string;
}) {
  if (values.length < 2) return null;

  const W = 100;
  const H = 28;
  const max = Math.max(...values, 1);
  const step = W / (values.length - 1);
  const pts = values.map((v, i) => `${i * step},${H - (v / max) * H}`);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={`0,${H} ${pts.join(' ')} ${W},${H}`}
        fill={tone}
        fillOpacity="0.08"
        stroke="none"
      />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={tone}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
