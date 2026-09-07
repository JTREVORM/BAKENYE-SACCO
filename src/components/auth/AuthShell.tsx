import Image from 'next/image';
import { Icon } from '@/components/ui/primitives';
import { ScaledCanvas } from './ScaledCanvas';
import { brandScript } from '@/lib/brand-font';
import { clsx } from '@/lib/clsx';
import type { IconName } from '@/lib/icons';

/**
 * The signed-out shell: brand on the left, the task on the right.
 *
 * Everything on the left is doing one job — telling a member who has never used
 * a computer banking system that this is their SACCO and it is safe. Hence the
 * crest at full size, the motto, and the four reassurances rather than a bare
 * form on a white page.
 *
 * There is deliberately **one** composition, at every screen size. It is
 * designed against 1024px and [`ScaledCanvas`](./ScaledCanvas.tsx) shrinks the
 * whole thing to fit anything narrower, rather than re-laying it out into a
 * portrait stack. That is a specified requirement, and it has a cost: on a
 * 390px handset the page renders at 38% and the form is readable by
 * pinch-zooming rather than by reading. Rotating to landscape roughly doubles
 * it. Nothing below is written with a phone breakpoint because there is not
 * one — if that changes, this is the file that grows the `lg:` prefixes back.
 */

const FEATURES: { icon: IconName; tone: string; title: string; detail: string }[] = [
  {
    icon: 'groups',
    tone: 'bg-[#2563c9]',
    title: 'Secure',
    detail: 'Your data is protected',
  },
  {
    icon: 'verified_user',
    tone: 'bg-[#1f9d55]',
    title: 'Reliable',
    detail: 'Trusted by our members',
  },
  {
    icon: 'trending_up',
    tone: 'bg-[#f0a92b]',
    title: 'Growing Together',
    detail: 'Stronger communities',
  },
  {
    icon: 'handshake',
    tone: 'bg-[#5b4bc4]',
    title: 'Member Focused',
    detail: 'Your success is our priority',
  },
];

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <ScaledCanvas>
      <div className="flex min-h-[100dvh] flex-col bg-[#0a2660]">
        <div className="flex flex-1 flex-row">
          <BrandPanel />

          {/* ---------------------------------------------------- the task */}
          <section className="relative isolate flex w-[46%] flex-1 items-center justify-center overflow-hidden bg-gradient-to-br from-[#eaf1fb] via-[#f5f9fd] to-[#d9e7f8] px-8 py-14">
            {/* The gold arc that sweeps in from the top of the sheet. */}
            <svg
              viewBox="0 0 400 400"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute -right-24 -top-40 h-[420px] w-[520px] opacity-90"
            >
              <path
                d="M0,400 C120,180 260,60 460,0"
                fill="none"
                stroke="#f2c200"
                strokeWidth="14"
                strokeLinecap="round"
              />
            </svg>

            {/* The crest, ghosted into the sheet the way a watermark sits on
                headed paper. */}
            <Image
              src="/brand/bnd-logo.png"
              alt=""
              aria-hidden="true"
              width={520}
              height={520}
              className="pointer-events-none absolute -right-24 top-1/2 w-[520px] -translate-y-1/2 opacity-[0.06] mix-blend-multiply"
            />

            <div className="relative z-10 w-full max-w-[560px]">{children}</div>
          </section>
        </div>

        <AuthFooter />
      </div>
    </ScaledCanvas>
  );
}

/* ------------------------------------------------------------------------ */

function BrandPanel() {
  return (
    <section className="relative isolate flex w-[54%] flex-col overflow-hidden bg-[#0e3483] px-16 pb-0 pt-12">
      {/* ------------------------------------------------------ the lake.
          A CSS sunset sits underneath, so the panel still reads as dawn over
          the water on the first paint and does not collapse into an empty blue
          box if the photograph is ever missing. */}
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 top-[42%] -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-[#2b5ea8] via-[#e8a552] to-[#123a7d]" />
        <div
          className="absolute inset-0 bg-cover bg-[center_top]"
          style={{ backgroundImage: "url('/brand/login-hero.jpg')" }}
        />
        {/* Blend the top of the photograph back into the navy above it so
            there is no hard seam across the middle of the panel. */}
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#0e3483] via-[#0e3483]/70 to-transparent" />
      </div>

      {/* The gold swoosh, and the navy it carries the motto on. */}
      <svg
        viewBox="0 0 1200 260"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[220px] w-full"
      >
        <path d="M0,120 C320,10 820,150 1200,40 L1200,260 L0,260 Z" fill="#0a2660" />
        <path
          d="M0,120 C320,10 820,150 1200,40"
          fill="none"
          stroke="#f2c200"
          strokeWidth="9"
          strokeLinecap="round"
        />
      </svg>

      {/* ------------------------------------------------------- the brand */}
      <header className="relative z-10 flex items-center gap-4">
        <Image
          src="/brand/bnd-logo.png"
          alt="Bakenye National Development SACCO"
          width={128}
          height={128}
          priority
          className="h-[104px] w-[104px] shrink-0 rounded-full bg-white object-contain p-1 shadow-lg"
        />
        <div className="min-w-0">
          <p className="text-[30px] font-extrabold uppercase leading-[1.12] tracking-tight text-white">
            Bakenye National
            <br />
            Development SACCO
          </p>
          <p className="mt-1 text-[17px] italic text-white/85">
            Together We Grow, Prosper and Build
          </p>
        </div>
      </header>

      {/* ---------------------------------------------------- the promise */}
      <div className="relative z-10 mt-12 max-w-xl">
        <h1 className="text-[44px] font-extrabold leading-[1.14] tracking-tight text-white">
          Your Trusted Partner in{' '}
          <span className="text-[#f2c200]">Savings, Loans</span> and Financial Growth
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-white/85">
          We empower our members through accessible financial services, strong communities and
          sustainable development.
        </p>
      </div>

      {/* -------------------------------------------------- the assurances */}
      <ul className="relative z-10 mt-10 grid grid-cols-4 gap-x-4 gap-y-4">
        {FEATURES.map((f) => (
          <li key={f.title} className="min-w-0">
            <span
              className={clsx(
                'mb-2 flex h-12 w-12 items-center justify-center rounded-full text-white shadow-md',
                f.tone,
              )}
            >
              <Icon name={f.icon} size={24} />
            </span>
            <p className="text-sm font-bold leading-tight text-white">{f.title}</p>
            <p className="text-xs leading-snug text-white/75">{f.detail}</p>
          </li>
        ))}
      </ul>

      {/* ------------------------------------------------------- the motto.
          Sits on the navy the swoosh lays down, so it stays legible whatever
          the photograph is doing behind it. */}
      <div className="relative z-10 mt-auto pb-10 pt-24">
        <p className={clsx(brandScript.className, 'text-[40px] leading-[1.05] text-white')}>
          Stronger Members
          <br />
          Brighter Futures
        </p>
        <svg viewBox="0 0 240 16" aria-hidden="true" className="mt-1 h-3 w-60 text-[#f2c200]">
          <path
            d="M2,12 C60,2 170,2 238,8"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */

function AuthFooter() {
  return (
    <footer className="bg-[#0a2660] px-8 py-4 text-white/80">
      <div className="max-w-content mx-auto flex flex-row items-center justify-between gap-4 text-[13px]">
        <p className="flex items-center gap-1.5">
          <Icon name="location_on" size={16} className="shrink-0 text-white/60" />
          Bakenye National Development SACCO
        </p>

        {/* Padded to the 44px minimum at design scale: these are the two things
            a member who cannot get in will actually tap. */}
        <a
          href="tel:+256000000000"
          className="min-h-touch-target-min flex items-center gap-1.5 rounded-lg px-2 hover:bg-white/10 hover:text-white"
        >
          <Icon name="phone" size={16} className="shrink-0 text-white/60" />
          +256 000 000 000
        </a>
        <a
          href="mailto:info@bakenyesacco.org"
          className="min-h-touch-target-min flex items-center gap-1.5 rounded-lg px-2 hover:bg-white/10 hover:text-white"
        >
          <Icon name="mail" size={16} className="shrink-0 text-white/60" />
          info@bakenyesacco.org
        </a>

        <p className="text-white/60">© {new Date().getFullYear()}. All rights reserved.</p>
      </div>
    </footer>
  );
}
