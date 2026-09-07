import Image from 'next/image';
import { Icon } from '@/components/ui/primitives';
import { brandScript } from '@/lib/brand-font';
import { clsx } from '@/lib/clsx';
import type { IconName } from '@/lib/icons';

/**
 * The signed-out shell.
 *
 * Two arrangements of the same pieces, and the difference is about what the
 * screen is for rather than how wide it is:
 *
 *  - **Phone.** The form is the first thing on the page. A member opening the
 *    app to check a balance should not have to scroll past a hero to reach the
 *    password field, so the brand is a shallow strip above the card and the
 *    promise, the assurances and the motto follow it, for whoever reads on.
 *  - **`lg` and wider.** The full landscape composition: brand panel on the
 *    left, form on the right, one footer across the bottom.
 *
 * The lockup and the brand copy are the same components in both, so the wording
 * lives in one place; only the wrappers differ.
 *
 * An earlier revision rendered the landscape composition at a fixed 1024px and
 * shrank the whole thing on a phone. It was faithful to the design and
 * unusable: a 56px button at 38% is 21px and body text lands near 6px. Type too
 * small to read is not a smaller version of a design, it is a picture of one.
 */

/**
 * The photograph is square, so `object-cover` crops it to whatever box it lands
 * in — a shallow band on a phone, the lower half of the panel on a wide screen.
 * `center` keeps the fisherman and the sun in frame at both.
 */
const HERO = '/brand/fisherman-at-sunset-stockcake.jpg';

const FEATURES: { icon: IconName; tone: string; title: string; detail: string }[] = [
  { icon: 'groups', tone: 'bg-[#2563c9]', title: 'Secure', detail: 'Your data is protected' },
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
    <div className="flex min-h-[100dvh] flex-col bg-[#0a2660]">
      <MobileBrandStrip />

      <div className="flex flex-1 flex-col lg:flex-row">
        <DesktopBrandPanel />

        {/* ------------------------------------------------------ the task */}
        <section className="bg-background relative isolate flex flex-1 items-start justify-center overflow-hidden px-4 pb-10 pt-6 sm:px-6 lg:w-[46%] lg:items-center lg:px-8 lg:py-12">
          <svg
            viewBox="0 0 400 400"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-40 hidden h-[380px] w-[460px] opacity-90 lg:block"
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
            width={440}
            height={440}
            className="pointer-events-none absolute -right-20 top-1/2 hidden w-[440px] -translate-y-1/2 opacity-[0.035] mix-blend-multiply lg:block"
          />

          <div className="relative z-10 w-full max-w-[430px]">{children}</div>
        </section>
      </div>

      <MobileBrandBody />
      <AuthFooter />
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Phone                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * The strip above the form: enough brand to know whose app this is, and no
 * more. Around 110px, which keeps the Sign In button above the fold even on a
 * 667px handset.
 */
function MobileBrandStrip() {
  return (
    <section className="relative isolate overflow-hidden bg-[#0e3483] px-5 pb-6 pt-4 sm:px-8 lg:hidden">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <Image
          src={HERO}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0e3483] via-[#0e3483]/75 to-[#0e3483]/10" />
      </div>

      {/* The curve hands over to the sheet the form sits on. */}
      <svg
        viewBox="0 0 1200 120"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-7 w-full"
      >
        <path d="M0,60 C320,-15 820,95 1200,15 L1200,120 L0,120 Z" fill="#e4e9f2" />
        <path
          d="M0,60 C320,-15 820,95 1200,15"
          fill="none"
          stroke="#f2c200"
          strokeWidth="10"
          strokeLinecap="round"
        />
      </svg>

      <BrandLockup size="compact" />
    </section>
  );
}

/** What a member may read once the form is behind them — or instead of it. */
function MobileBrandBody() {
  return (
    <section className="relative isolate overflow-hidden bg-[#0e3483] px-5 pb-10 pt-8 sm:px-8 lg:hidden">
      <BrandPromise className="max-w-lg" />
      <BrandAssurances className="mt-6" />
      <BrandMotto className="mt-8" />
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Wide                                                                      */
/* ------------------------------------------------------------------------ */

function DesktopBrandPanel() {
  return (
    <section className="relative isolate hidden w-[54%] flex-col overflow-hidden bg-[#0e3483] px-12 pb-0 pt-10 lg:flex">
      {/* The lake fills the lower half; the navy above carries the copy. It
          starts below the assurances so white labels never land on sunlit
          water. */}
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 top-[54%] -z-10">
        <Image src={HERO} alt="" fill sizes="54vw" className="object-cover object-center" />
        <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-[#0e3483] via-[#0e3483]/70 to-transparent" />
      </div>

      {/* The gold swoosh, and the navy it carries the motto on. */}
      <svg
        viewBox="0 0 1200 260"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[190px] w-full"
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

      <BrandLockup size="full" />
      <BrandPromise className="mt-9 max-w-[380px]" />
      <BrandAssurances className="mt-8" />
      <BrandMotto className="mt-auto pb-8 pt-16" />
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Shared pieces                                                             */
/* ------------------------------------------------------------------------ */

function BrandLockup({ size }: { size: 'compact' | 'full' }) {
  const compact = size === 'compact';
  return (
    <header className="relative z-10 flex items-center gap-3 sm:gap-4">
      <Image
        src="/brand/bnd-logo.png"
        alt="Bakenye Unity and Development SACCO"
        width={112}
        height={112}
        priority
        className={clsx(
          'shrink-0 rounded-full bg-white object-contain p-1 shadow-lg',
          compact ? 'h-12 w-12 sm:h-14 sm:w-14' : 'h-[84px] w-[84px]',
        )}
      />
      <div className="min-w-0">
        <p
          className={clsx(
            'font-extrabold uppercase leading-[1.12] tracking-tight text-white',
            compact ? 'text-[15px] sm:text-[18px]' : 'text-[24px]',
          )}
        >
          Bakenye Unity and
          <br />
          Development SACCO
        </p>
        <p
          className={clsx(
            'mt-0.5 italic text-white/85',
            compact ? 'text-[11px] sm:text-[12px]' : 'text-[15px]',
          )}
        >
          Together We Grow, Prosper and Build
        </p>
      </div>
    </header>
  );
}

function BrandPromise({ className }: { className?: string }) {
  return (
    <div className={clsx('relative z-10', className)}>
      <h1 className="text-[26px] font-extrabold leading-[1.15] tracking-tight text-white sm:text-[30px] lg:text-[34px]">
        Your Trusted Partner in <span className="text-[#f2c200]">Savings, Loans</span> and Financial
        Growth
      </h1>
      <p className="mt-3 max-w-md text-[14px] leading-relaxed text-white/85 sm:text-[15px]">
        We empower our members through accessible financial services, strong communities and
        sustainable development.
      </p>
    </div>
  );
}

function BrandAssurances({ className }: { className?: string }) {
  return (
    <ul className={clsx('relative z-10 grid grid-cols-4 gap-x-2 gap-y-4 sm:gap-x-4', className)}>
      {FEATURES.map((f) => (
        <li key={f.title} className="min-w-0">
          <span
            className={clsx(
              'mb-1.5 flex h-10 w-10 items-center justify-center rounded-full text-white shadow-md sm:h-11 sm:w-11',
              f.tone,
            )}
          >
            <Icon name={f.icon} size={20} />
          </span>
          <p className="text-[11px] font-bold leading-tight text-white sm:text-[12px] lg:text-[13px]">
            {f.title}
          </p>
          <p className="text-[10px] leading-snug text-white/75 lg:text-[11px]">{f.detail}</p>
        </li>
      ))}
    </ul>
  );
}

function BrandMotto({ className }: { className?: string }) {
  return (
    <div className={clsx('relative z-10', className)}>
      <p
        className={clsx(
          brandScript.className,
          'text-[26px] leading-[1.05] text-white sm:text-[30px] lg:text-[32px]',
        )}
      >
        Stronger Members
        <br />
        Brighter Futures
      </p>
      <svg
        viewBox="0 0 240 16"
        aria-hidden="true"
        className="mt-1 h-2.5 w-44 text-[#f2c200] sm:w-52"
      >
        <path
          d="M2,12 C60,2 170,2 238,8"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function AuthFooter() {
  return (
    <footer className="bg-[#0a2660] px-4 py-3 text-white/80 sm:px-8">
      <div className="max-w-content mx-auto flex flex-col items-center gap-0.5 text-center text-[12px] lg:flex-row lg:justify-between lg:gap-4 lg:text-left">
        <div className="flex flex-wrap items-center justify-center gap-x-4 lg:contents">
          <p className="flex items-center gap-1.5">
            <Icon name="location_on" size={15} className="shrink-0 text-white/60" />
            Bakenye Unity and Development SACCO
          </p>

          {/* Padded to the 44px minimum: these are the two things a member who
              cannot get in will actually tap, and on a phone they dial and
              compose rather than merely informing. */}
          <a
            href="tel:+256000000000"
            className="min-h-touch-target-min flex items-center gap-1.5 rounded-lg px-2 hover:bg-white/10 hover:text-white"
          >
            <Icon name="phone" size={15} className="shrink-0 text-white/60" />
            +256 000 000 000
          </a>
          <a
            href="mailto:info@bakenyesacco.org"
            className="min-h-touch-target-min flex items-center gap-1.5 rounded-lg px-2 hover:bg-white/10 hover:text-white"
          >
            <Icon name="mail" size={15} className="shrink-0 text-white/60" />
            info@bakenyesacco.org
          </a>
        </div>

        <p className="text-white/60">© {new Date().getFullYear()}. All rights reserved.</p>
      </div>
    </footer>
  );
}
