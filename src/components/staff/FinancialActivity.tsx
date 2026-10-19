import Link from 'next/link';
import { Icon, Panel } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { getMonthlyFlow } from '@/lib/treasury';
import { formatCompactUGX, formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';

/**
 * Monthly financial activity — money in, money out and the net between them.
 *
 * The figures are `treasury_monthly_flow()`, the same function the finance
 * screens chart, so the dashboard and the books agree. Internal transfers are
 * excluded by that function: moving money from the merchant account to the bank
 * is neither income nor expenditure.
 *
 * Hand-rolled inline SVG, server-rendered, like every other chart in the
 * product: no chart library reaches the phone. Each bar carries a `<title>`,
 * which the browser shows as a native tooltip and a screen reader announces —
 * an interaction that costs no JavaScript at all.
 */

const SERIES = [
  { key: 'in', label: 'Money in', fill: '#12965a' },
  { key: 'out', label: 'Money out', fill: '#0a2148' },
  { key: 'net', label: 'Net', fill: '#7da5e3' },
] as const;

const RANGES = [
  { months: 6, label: '6 months' },
  { months: 12, label: '12 months' },
] as const;

export async function FinancialActivity({
  months = 6,
  baseHref,
  compact = false,
}: {
  months?: number;
  compact?: boolean;
  /** The dashboard this panel sits on, so the range links come back to it. */
  baseHref: string;
}) {
  const points = await getMonthlyFlow(months);

  return (
    <ActivityPanel
      compact={compact}
      months={months}
      baseHref={baseHref}
      series={
        points?.map((p) => ({
          label: p.label,
          in: toNumber(p.money_in),
          out: toNumber(p.money_out),
          net: toNumber(p.money_in) - toNumber(p.money_out),
        })) ?? null
      }
    />
  );
}

/**
 * The panel itself, given buckets.
 *
 * Split from the read above so the design harness at `/dev/preview` can render
 * the real chart against fixtures, without a database.
 */
export function ActivityPanel({
  series,
  months,
  baseHref,
  compact = false,
}: {
  series: Bucket[] | null;
  months: number;
  compact?: boolean;
  baseHref: string;
}) {
  return (
    <Panel
      title="Monthly Financial Activity"
      icon="bar_chart"
      padded={false}
      action={<RangePicker months={months} baseHref={baseHref} />}
      bodyClassName="flex min-h-0 flex-col p-5"
    >
      {!series || series.length === 0 ? (
        <EmptyState
          compact
          icon="monitoring"
          title="No movements recorded yet"
          description="Once money moves through the merchant account, the bank or the cash box, its monthly shape appears here."
        />
      ) : (
        <ActivityChart series={series} compact={compact} />
      )}
    </Panel>
  );
}

/**
 * The range control.
 *
 * A `<details>` disclosure rather than a `<select>`: it is two links to the
 * same page with a different range, which is what it actually is, and it needs
 * no JavaScript to open.
 */
function RangePicker({ months, baseHref }: { months: number; baseHref: string }) {
  const current = RANGES.find((r) => r.months === months) ?? RANGES[0];

  return (
    <details className="group relative">
      <summary className="text-label-md text-on-surface-variant bg-surface-container hover:bg-surface-container-high flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-3 font-semibold transition-colors [&::-webkit-details-marker]:hidden">
        {current.label}
        <Icon name="expand_more" size={16} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="bg-surface absolute right-0 z-20 mt-1.5 w-40 overflow-hidden rounded-xl p-1 shadow-pop">
        {RANGES.map((r) => (
          <Link
            key={r.months}
            href={`${baseHref}?flow=${r.months}`}
            scroll={false}
            className={clsx(
              'text-body-md flex h-10 items-center gap-2 rounded-lg px-3 transition-colors',
              r.months === months
                ? 'text-primary bg-primary-fixed font-semibold'
                : 'text-on-surface hover:bg-surface-container-high',
            )}
          >
            {r.months === months ? <Icon name="check" size={16} /> : null}
            {r.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

export type Bucket = { label: string; in: number; out: number; net: number };

function ActivityChart({ series, compact }: { series: Bucket[]; compact: boolean }) {
  const values = series.flatMap((s) => [s.in, s.out, s.net]);
  // One step size for the whole axis, with both ends snapped to a multiple of
  // it. Quartiles of an arbitrary maximum give gridlines labelled 13.8M, which
  // nobody reads as an amount; this gives 0, 5M, 10M, 15M, 20M. A loss-making
  // month is drawable because the axis is allowed below zero — only as far as
  // it actually needs to go.
  const rawTop = Math.max(...values, 0);
  const rawBottom = Math.min(...values, 0);
  const step = niceStep((rawTop - rawBottom) / 4);
  const top = Math.ceil(rawTop / step) * step;
  const bottom = Math.floor(rawBottom / step) * step;
  const span = top - bottom || 1;

  const W = 340;
  const H = 180;
  const PAD_L = 42;
  const PAD_B = 22;
  const plotW = W - PAD_L;
  const plotH = H - PAD_B;

  const zeroY = plotH - ((0 - bottom) / span) * plotH;
  const slot = plotW / series.length;
  const barW = Math.min(12, (slot * 0.74) / 3);
  const groupW = barW * 3 + 4;

  const ticks: number[] = [];
  for (let t = bottom; t <= top + step / 2; t += step) ticks.push(t);

  return (
    // The panel is as tall as whatever sits beside it in the dashboard grid, so
    // the chart takes the slack and the legend stays on the floor.
    <figure className="flex w-full flex-1 flex-col justify-between">
      <svg
        preserveAspectRatio={compact ? 'none' : undefined}
        viewBox={`0 0 ${W} ${H}`}
        className="my-auto h-auto max-h-[22rem] w-full overflow-visible"
        role="img"
        aria-label={`Money in, money out and the net for ${series.length} months, from ${series[0]?.label} to ${series[series.length - 1]?.label}`}
      >
        {ticks.map((t, i) => {
          const y = plotH - ((t - bottom) / span) * plotH;
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W}
                y1={y}
                y2={y}
                stroke="#e3e9f3"
                strokeWidth="1"
                strokeDasharray={Math.abs(t) < step / 2 ? undefined : '3 3'}
              />
              <text
                x={PAD_L - 8}
                y={y + 3.5}
                textAnchor="end"
                fontSize="9"
                fill="#5a6782"
                fontWeight="600"
              >
                {Math.abs(t) < step / 2 ? '0' : compactAxis(t)}
              </text>
            </g>
          );
        })}

        {series.map((s, i) => {
          const groupX = PAD_L + i * slot + (slot - groupW) / 2;
          return (
            <g key={`${s.label}-${i}`}>
              <title>
                {`${s.label}: money in ${formatUGX(s.in)}, money out ${formatUGX(
                  s.out,
                )}, net ${formatUGX(s.net)}`}
              </title>
              {SERIES.map((seg, j) => {
                const v = s[seg.key];
                const y = plotH - ((Math.max(v, 0) - bottom) / span) * plotH;
                const h = Math.abs(v / span) * plotH;
                const x = groupX + j * (barW + 2);
                // A measured zero keeps a 2px stub on the baseline, so an empty
                // month reads as "nothing moved" rather than as a gap.
                if (h < 2) {
                  return (
                    <rect
                      key={seg.key}
                      x={x}
                      y={zeroY - 2}
                      width={barW}
                      height={2}
                      fill={seg.fill}
                      opacity={0.35}
                      rx={1}
                    />
                  );
                }
                return (
                  <rect
                    key={seg.key}
                    x={x}
                    y={v >= 0 ? y : zeroY}
                    width={barW}
                    height={h}
                    fill={seg.fill}
                    rx={2}
                  />
                );
              })}
              <text
                x={groupX + groupW / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize="9"
                fill="#5a6782"
                fontWeight="600"
              >
                {s.label}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="border-outline-variant mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 border-t pt-3">
        {SERIES.map((s) => (
          <span
            key={s.key}
            className="text-label-md text-on-surface-variant flex items-center gap-2 font-medium"
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: s.fill }}
            />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** 1, 2 or 5 times a power of ten — the intervals axes are conventionally drawn at. */
function niceStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function compactAxis(value: number): string {
  const { amount } = formatCompactUGX(value);
  return value < 0 ? `−${amount.replace('-', '')}` : amount;
}
