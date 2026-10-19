import Link from 'next/link';
import Image from 'next/image';
import { clsx } from '@/lib/clsx';
import { Icon } from '@/components/ui/primitives';
import type { IconName } from '@/lib/icons';

/**
 * The banner every dashboard opens with — staff and member alike.
 *
 * One shell, two faces. `HeroShell` is the navy photograph — the SACCO's own
 * imagery behind a left-to-right gradient, so the headline keeps AAA contrast
 * at every width and the picture never has to be cropped to a shape it does not
 * suit. If an image file is ever removed the gradient alone still reads
 * correctly.
 *
 *   `BrandHero`   — the whole-SACCO overview: the organisation's name, its
 *                   promise, and the three figures a board asks for first.
 *   `WelcomeHero` — a role's own desk: who is signed in, what today is, and the
 *                   way through to the overview.
 *   `MemberHero`  — the member portal's own greeting, with the member number
 *                   and status the rest of the portal is keyed to.
 *
 * Nothing here computes a figure. Callers pass what the database returned, and
 * a hero with nothing to show simply shows no figures.
 */

type Artwork = 'landscape' | 'community';

const ARTWORK: Record<Artwork, { src: string; position: string }> = {
  landscape: { src: '/brand/fisherman-at-sunset-stockcake.jpg', position: 'object-center' },
  // A short, very wide banner crops this one to a horizontal band. Centring it
  // lands on empty sky; 68% down the frame is the ridge line and the sunrise,
  // which is the part of the picture worth showing.
  community: { src: '/brand/login-community.webp', position: 'object-[center_68%]' },
};

export function HeroShell({
  artwork,
  children,
  aside,
  priority = false,
}: {
  artwork: Artwork;
  children: React.ReactNode;
  aside?: React.ReactNode;
  priority?: boolean;
}) {
  return (
    <section className="bg-ink relative isolate overflow-hidden rounded-2xl shadow-brand">
      <Image
        src={ARTWORK[artwork].src}
        alt=""
        fill
        priority={priority}
        sizes="(max-width: 768px) 100vw, 1200px"
        className={clsx('object-cover opacity-55', ARTWORK[artwork].position)}
      />
      <div
        aria-hidden="true"
        className="from-ink-deep via-ink/92 to-ink/25 absolute inset-0 bg-gradient-to-r"
      />
      {/* A second, vertical wash. Without it the foot of a tall banner loses
          the type against a bright patch of sky. */}
      <div
        aria-hidden="true"
        className="from-ink-deep/70 absolute inset-0 bg-gradient-to-t via-transparent to-transparent"
      />

      <div className="relative z-10 flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:gap-8 md:p-8">
        <div className="min-w-0 max-w-2xl">{children}</div>
        {aside ? <div className="w-full shrink-0 md:w-auto">{aside}</div> : null}
      </div>
    </section>
  );
}

/** The gold rule that sits under every hero headline. */
function GoldRule({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx('bg-gold-gradient block h-1 w-16 rounded-full', className)}
    />
  );
}

/* ------------------------------------------------------------------------ *
 * The whole-SACCO banner
 * ------------------------------------------------------------------------ */

export function BrandHero({
  eyebrow,
  nameTop,
  nameBottom,
  description,
  figures,
}: {
  eyebrow: string;
  nameTop: string;
  nameBottom: string;
  description: string;
  /** Rendered beside the headline; typically `<HeroFigures />`. */
  figures?: React.ReactNode;
}) {
  return (
    <HeroShell artwork="landscape" priority aside={figures}>
      <p className="text-secondary-fixed-dim text-label-md font-semibold uppercase tracking-[0.16em]">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-[26px] font-bold uppercase leading-[1.12] tracking-tight text-white md:text-[36px]">
        {nameTop}
        <br />
        {nameBottom}
      </h1>
      <GoldRule className="mt-4" />
      <p className="text-body-lg mt-4 max-w-md text-white/80">{description}</p>
    </HeroShell>
  );
}

/**
 * The three headline figures beside the brand hero.
 *
 * Every row is a real figure with a page behind it, so the card is navigation
 * as well as summary.
 */
export function HeroFigures({
  figures,
}: {
  figures: readonly { icon: IconName | string; label: string; value: string; href: string }[];
}) {
  if (figures.length === 0) return null;

  return (
    <dl className="w-full space-y-1 rounded-2xl border border-white/20 bg-white/10 p-3 backdrop-blur-md md:w-auto md:min-w-[300px]">
      {figures.map((f) => (
        <div key={f.label}>
          <Link
            href={f.href}
            className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/10"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-inset ring-white/15">
              <Icon name={f.icon} size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <dd className="tabular text-[17px] font-bold leading-tight text-white">{f.value}</dd>
              <dt className="text-label-md font-medium leading-snug text-white/70">{f.label}</dt>
            </div>
            <Icon
              name="chevron_right"
              size={18}
              className="shrink-0 text-white/45 transition-colors group-hover:text-white"
            />
          </Link>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------------ *
 * A role's own banner
 * ------------------------------------------------------------------------ */

export function WelcomeHero({
  roleName,
  fullName,
  subtitle,
  showOverviewLink = true,
}: {
  roleName: string;
  fullName: string;
  subtitle: string;
  showOverviewLink?: boolean;
}) {
  const first = fullName.trim().split(/\s+/)[0];
  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  return (
    <HeroShell
      artwork="community"
      priority
      aside={
        showOverviewLink ? (
          <Link
            href="/staff"
            className="text-button-text bg-surface text-ink hover:bg-surface-container-high inline-flex h-12 shrink-0 items-center gap-2 rounded-full px-5 font-semibold shadow-neu transition-colors"
          >
            <Icon name="insights" size={18} />
            SACCO overview
          </Link>
        ) : null
      }
    >
      <p className="text-secondary-fixed-dim text-label-md font-semibold uppercase tracking-[0.16em]">
        {roleName} Dashboard
      </p>
      <h1 className="mt-2 text-[26px] font-bold leading-[1.15] tracking-tight text-white md:text-[36px]">
        Welcome back, {first}
      </h1>
      <p className="text-body-lg mt-2 text-white/80">
        {today} <span className="text-white/50">·</span> {subtitle}
      </p>
      <GoldRule className="mt-4" />
    </HeroShell>
  );
}

/* ------------------------------------------------------------------------ *
 * The member portal
 * ------------------------------------------------------------------------ */

export function MemberHero({
  fullName,
  memberNo,
  status,
}: {
  fullName: string;
  memberNo: string | null;
  /** The member's status badge, rendered by the caller. */
  status?: React.ReactNode;
}) {
  const first = fullName.trim().split(/\s+/)[0];

  return (
    <HeroShell artwork="community" priority>
      <p className="text-secondary-fixed-dim text-label-md font-semibold uppercase tracking-[0.16em]">
        Member Dashboard
      </p>
      <h1 className="mt-2 text-[24px] font-bold leading-[1.15] tracking-tight text-white md:text-[32px]">
        Welcome, {first}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        {memberNo ? (
          <span className="tabular text-label-md rounded-full bg-white/15 px-3 py-1 font-semibold text-white ring-1 ring-inset ring-white/20">
            {memberNo}
          </span>
        ) : null}
        {status}
      </div>
      <GoldRule className="mt-4" />
    </HeroShell>
  );
}
