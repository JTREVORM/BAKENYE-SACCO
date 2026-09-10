import { EmptyState } from '@/components/ui/states';
import { formatCompactUGX, formatUGX, toNumber } from '@/lib/money';

/**
 * The finance charts. Server-rendered SVG, like the collections trend on the
 * staff dashboard: no chart library reaches the phone.
 *
 * Colours are the validated account palette (gold merchant, navy bank, teal
 * cash - lightness band, colour-blind separation and 3:1 contrast all pass)
 * and the product's in/out pair. Green and red sit in the colour-blind floor
 * band, so they are never the only encoding: money in is always the left bar
 * of a pair, money out the right, both are named in the legend, and every bar
 * carries a native tooltip with its figure.
 */

export const IN_COLOUR = '#12965a';
export const OUT_COLOUR = '#c02a2a';

/* --------------------------------------------------------------------------
 * Money distribution - a donut with the total in the middle and every slice
 * labelled with its amount and share beside it.
 * ----------------------------------------------------------------------- */
export function MoneyDistribution({
  slices,
}: {
  slices: { key: string; label: string; value: unknown; colour: string }[];
}) {
  const values = slices.map((s) => ({ ...s, n: toNumber(s.value) }));
  const positive = values.filter((s) => s.n > 0);
  const total = positive.reduce((s, v) => s + v.n, 0);
  const negative = values.filter((s) => s.n < 0);

  if (total <= 0) {
    return (
      <EmptyState
        compact
        icon="donut_large"
        title="No money recorded yet"
        description="Once collections are recorded, this shows how the SACCO's money is split between the merchant account, the bank and cash at hand."
      />
    );
  }

  const R = 60;
  const STROKE = 22;
  const C = 2 * Math.PI * R;
  // A 2px surface gap between segments, so neighbouring slices never merge.
  const GAP = positive.length > 1 ? 2 : 0;
  let offset = 0;

  return (
    <figure className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <svg
        viewBox="0 0 160 160"
        className="h-44 w-44 shrink-0"
        role="img"
        aria-label={`Money distribution: ${values
          .map((s) => `${s.label} ${formatUGX(s.n)}`)
          .join(', ')}`}
      >
        <circle cx="80" cy="80" r={R} fill="none" stroke="#dce2ee" strokeWidth={STROKE} />
        {positive.map((s) => {
          const len = (s.n / total) * C;
          const dash = Math.max(len - GAP, 0.5);
          const el = (
            <circle
              key={s.key}
              cx="80"
              cy="80"
              r={R}
              fill="none"
              stroke={s.colour}
              strokeWidth={STROKE}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            >
              <title>{`${s.label}: ${formatUGX(s.n)} (${((s.n / total) * 100).toFixed(1)}%)`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
        <text x="80" y="76" textAnchor="middle" fontSize="10" fill="#5b647a" fontWeight="600">
          Total
        </text>
        <text x="80" y="92" textAnchor="middle" fontSize="15" fill="#111827" fontWeight="700">
          {`${formatCompactUGX(total).prefix} ${formatCompactUGX(total).amount}`}
        </text>
      </svg>

      <figcaption className="w-full min-w-0 space-y-2.5">
        {values.map((s) => (
          <div key={s.key} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: s.colour }}
            />
            <span className="min-w-0 flex-1 truncate text-body-md text-on-surface">{s.label}</span>
            <span className="tabular shrink-0 text-body-md font-semibold text-on-surface">
              {formatUGX(s.n)}
            </span>
            <span className="tabular w-12 shrink-0 text-right text-label-md font-normal text-on-surface-variant">
              {s.n > 0 ? `${Math.round((s.n / total) * 100)}%` : '—'}
            </span>
          </div>
        ))}
        {negative.length > 0 ? (
          <p className="text-label-md font-normal text-error">
            {negative.map((s) => s.label).join(', ')} below zero - not drawn.
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}

/* --------------------------------------------------------------------------
 * Paired monthly bars - two measures side by side for each month, on one axis.
 * ----------------------------------------------------------------------- */
export function PairedBars({
  points,
  a,
  b,
  emptyTitle,
  emptyBody,
}: {
  points: { label: string; a: unknown; b: unknown }[];
  a: { label: string; colour: string };
  b: { label: string; colour: string };
  emptyTitle: string;
  emptyBody: string;
}) {
  const series = points.map((p) => ({ label: p.label, a: toNumber(p.a), b: toNumber(p.b) }));
  const peak = Math.max(0, ...series.map((s) => Math.max(s.a, s.b)));

  if (series.length === 0 || peak === 0) {
    return <EmptyState compact icon="bar_chart" title={emptyTitle} description={emptyBody} />;
  }

  const max = niceCeiling(peak);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  const W = 320;
  const H = 150;
  const PAD_L = 44;
  const PAD_B = 20;
  const plotW = W - PAD_L;
  const plotH = H - PAD_B;
  const slot = plotW / series.length;
  const barW = Math.min(14, (slot - 10) / 2);

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-52 w-full overflow-visible"
        role="img"
        aria-label={`${a.label} and ${b.label} by month`}
      >
        {ticks.map((t, i) => {
          const y = plotH - (t / max) * plotH;
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W}
                y1={y}
                y2={y}
                stroke="#dbe1ec"
                strokeWidth="1"
                strokeDasharray={i === 0 ? undefined : '3 3'}
              />
              <text x={PAD_L - 8} y={y + 3.5} textAnchor="end" fontSize="9" fill="#5b647a" fontWeight="600">
                {t === 0 ? '0' : formatCompactUGX(t).amount}
              </text>
            </g>
          );
        })}

        {series.map((s, i) => {
          const cx = PAD_L + i * slot + slot / 2;
          const bars = [
            { v: s.a, x: cx - barW - 1, colour: a.colour, name: a.label },
            { v: s.b, x: cx + 1, colour: b.colour, name: b.label },
          ];
          return (
            <g key={s.label}>
              <title>{`${s.label}: ${a.label} ${formatUGX(s.a)} · ${b.label} ${formatUGX(s.b)}`}</title>
              {bars.map((bar) => {
                const h = (bar.v / max) * plotH;
                if (bar.v <= 0) {
                  return (
                    <rect key={bar.name} x={bar.x} y={plotH - 2} width={barW} height={2} fill="#dbe1ec" rx={1} />
                  );
                }
                return (
                  <path
                    key={bar.name}
                    d={roundedTop(bar.x, plotH - h, barW, h, Math.min(4, h, barW / 2))}
                    fill={bar.colour}
                  />
                );
              })}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="9" fill="#5b647a" fontWeight="600">
                {s.label}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-outline-variant pt-3">
        <Key colour={a.colour} label={`${a.label} (left bar)`} />
        <Key colour={b.colour} label={`${b.label} (right bar)`} />
      </figcaption>
    </figure>
  );
}

/** A bar with 4px rounded data-end and a square baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return [
    `M${x},${y + h}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${y + h}`,
    'Z',
  ].join(' ');
}

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-2 text-label-md font-medium text-on-surface-variant">
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colour }} aria-hidden="true" />
      {label}
    </span>
  );
}
