import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@/components/ui/primitives';
import { brandScript } from '@/lib/brand-font';
import { clsx } from '@/lib/clsx';
import type { IconName } from '@/lib/icons';
import { getBrand } from '@/lib/brand';
import { splitName, type Brand } from '@/lib/sacco-brand';
import { PUBLIC_ROBOTS, absoluteUrl } from '@/lib/site';

/**
 * The public page.
 *
 * This is the only substantial page of the whole deployment that a search
 * engine is invited to read. It is served at `/` to a visitor with no session
 * (the middleware rewrites `/` here rather than redirecting to /login, so the
 * SACCO's own address is the thing Google indexes), and a signed-in member sees
 * their dashboard at that same address.
 *
 * Everything on this page is either the SACCO's own brand copy - the same
 * wording as the sign-in shell, which the SACCO approved - or a plain statement
 * of what the system actually does. There are deliberately no figures, no
 * membership counts, no testimonials, no regulatory claims, no branch addresses
 * and no founding date: none of those are recorded anywhere in this project, and
 * inventing them to fill out a page would be a lie that outlives whoever wrote
 * it. Contact details appear only when the SACCO has published them in
 * Settings -> Organisation.
 */
const HERO = '/brand/fisherman-at-sunset-stockcake.jpg';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();

  return {
    // Not "%s · BUD-SACCO": the homepage title is the whole name, because that
    // is the phrase a member searching for the SACCO actually types.
    title: {
      absolute: `${brand.legalName} — Savings, Shares and Loans`,
    },
    description:
      `${brand.legalName} (${brand.shortName}) is a savings and credit co-operative society ` +
      'in Uganda. Members save, buy shares, borrow against their savings and follow every ' +
      'transaction in the member app.',
    keywords: [
      brand.legalName,
      brand.shortName,
      'SACCO',
      'savings and credit co-operative',
      'savings and credit cooperative society',
      'member savings',
      'SACCO loans',
      'SACCO shares',
      'Uganda SACCO',
    ],
    // `/`, not `/welcome`: the rewrite means both addresses serve this page, and
    // the one the SACCO wants in search results is the bare domain.
    alternates: { canonical: '/' },
    robots: PUBLIC_ROBOTS,
    openGraph: {
      type: 'website',
      siteName: brand.legalName,
      title: `${brand.legalName} — Savings, Shares and Loans`,
      description: `${brand.motto}. Savings, shares and loans for members of ${brand.shortName}.`,
      url: '/',
      locale: 'en_UG',
      images: [
        {
          url: '/brand/og-image.png',
          width: 1200,
          height: 630,
          alt: `${brand.legalName} — ${brand.motto}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${brand.legalName} — Savings, Shares and Loans`,
      description: `${brand.motto}. Savings, shares and loans for members of ${brand.shortName}.`,
      images: ['/brand/og-image.png'],
    },
  };
}

const SERVICES: { icon: IconName; title: string; detail: string }[] = [
  {
    icon: 'savings',
    title: 'Savings',
    detail:
      'Save at the office or through the member app, and watch the balance and every deposit on your own statement.',
  },
  {
    icon: 'diamond',
    title: 'Shares',
    detail:
      'Buy shares in the SACCO and hold a stake in what the membership builds together.',
  },
  {
    icon: 'request_quote',
    title: 'Loans',
    detail:
      'Apply for a loan against your savings, follow the approval, and see each repayment as it is received.',
  },
  {
    icon: 'handshake',
    title: 'Guarantees',
    detail:
      'Stand as a guarantor for a fellow member, and keep track of what you have guaranteed.',
  },
  {
    icon: 'receipt_long',
    title: 'Statements and receipts',
    detail:
      'Every transaction is receipted and every account has a statement you can read or download at any time.',
  },
  {
    icon: 'smartphone',
    title: 'The member app',
    detail:
      'Install the SACCO on your phone from the browser - no app store, and it works on a modest Android handset.',
  },
];

/** The same four assurances the sign-in screen carries. */
const ASSURANCES: { icon: IconName; tone: string; title: string; detail: string }[] = [
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

export default async function WelcomePage() {
  const brand = await getBrand();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#0a2660]">
      <StructuredData brand={brand} />
      <Hero brand={brand} />

      <main className="bg-background flex-1">
        <div className="mx-auto max-w-[1120px] px-5 py-12 sm:px-8 lg:py-16">
          <Services />
          <Membership />
          <Privacy />
        </div>
      </main>

      <SiteFooter brand={brand} />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function Hero({ brand }: { brand: Brand }) {
  const [nameTop, nameBottom] = splitName(brand.legalName);

  return (
    <header className="relative isolate overflow-hidden bg-[#0e3483] px-5 pb-16 pt-8 sm:px-8 lg:pb-24 lg:pt-12">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <Image
          src={HERO}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0e3483] via-[#0e3483]/85 to-[#0e3483]/35" />
      </div>

      <div className="mx-auto max-w-[1120px]">
        <div className="flex items-center gap-3 sm:gap-4">
          <Image
            src="/brand/bnd-logo.png"
            alt={brand.legalName}
            width={112}
            height={112}
            priority
            className="h-14 w-14 shrink-0 rounded-full bg-white object-contain p-1 shadow-lg sm:h-[84px] sm:w-[84px]"
          />
          <div className="min-w-0">
            <p className="text-[16px] font-extrabold uppercase leading-[1.12] tracking-tight text-white sm:text-[22px]">
              {nameTop}
              <br />
              {nameBottom}
            </p>
            <p className="mt-0.5 text-[12px] italic text-white/85 sm:text-[15px]">{brand.motto}</p>
          </div>
        </div>

        <h1 className="mt-10 max-w-[640px] text-[28px] font-extrabold leading-[1.15] tracking-tight text-white sm:text-[34px] lg:text-[42px]">
          Your Trusted Partner in <span className="text-[#f2c200]">Savings, Loans</span> and
          Financial Growth
        </h1>
        <p className="mt-4 max-w-[560px] text-[15px] leading-relaxed text-white/85 sm:text-[17px]">
          We empower our members through accessible financial services, strong communities and
          sustainable development. {brand.shortName} is a savings and credit co-operative society
          owned by the members it serves.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            className="min-h-touch-target-min inline-flex items-center gap-2 rounded-full bg-[#f2c200] px-7 py-3.5 text-[15px] font-bold text-[#0a2148] shadow-lg transition-colors hover:bg-[#ffd42b]"
          >
            <Icon name="login" size={20} />
            Member sign in
          </Link>
          <Link
            href="/help"
            className="min-h-touch-target-min inline-flex items-center gap-2 rounded-full border border-white/40 px-7 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
          >
            <Icon name="help" size={20} />
            Help signing in
          </Link>
        </div>

        <ul className="mt-12 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          {ASSURANCES.map((a) => (
            <li key={a.title} className="min-w-0">
              <span
                className={clsx(
                  'mb-2 flex h-11 w-11 items-center justify-center rounded-full text-white shadow-md',
                  a.tone,
                )}
              >
                <Icon name={a.icon} size={20} />
              </span>
              <p className="text-[13px] font-bold leading-tight text-white">{a.title}</p>
              <p className="text-[11px] leading-snug text-white/75">{a.detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

function Services() {
  return (
    <section aria-labelledby="services">
      <h2
        id="services"
        className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface"
      >
        What members can do
      </h2>
      <p className="text-body-md text-on-surface-variant mt-2 max-w-[600px]">
        Everything below is part of the SACCO your membership already gives you access to.
      </p>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICES.map((s) => (
          <li key={s.title} className="bg-surface rounded-3xl p-5 shadow-neu">
            <span className="bg-primary-container text-on-primary-container mb-3 flex h-11 w-11 items-center justify-center rounded-full">
              <Icon name={s.icon} size={22} />
            </span>
            <h3 className="text-title-md text-on-surface font-semibold">{s.title}</h3>
            <p className="text-body-md text-on-surface-variant mt-1.5 leading-relaxed">
              {s.detail}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Membership() {
  return (
    <section aria-labelledby="membership" className="mt-14">
      <h2
        id="membership"
        className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface"
      >
        Joining and signing in
      </h2>

      <ol className="mt-6 flex flex-col gap-4">
        {[
          {
            title: 'Register at the SACCO office',
            body: 'Membership is opened by SACCO staff. Bring your National ID; the office records your details and gives you a temporary password.',
          },
          {
            title: 'Sign in with your member number',
            body: 'Sign in with the member number on your passbook — for example BND26001 — or with your phone number, and the temporary password. You then choose a password of your own.',
          },
          {
            title: 'Install the app on your phone',
            body: 'After signing in, the SACCO offers to add itself to your home screen so your savings, shares and loans are one tap away.',
          },
        ].map((step, i) => (
          <li key={step.title} className="bg-surface flex gap-4 rounded-3xl p-5 shadow-neu">
            <span className="bg-primary text-on-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold">
              {i + 1}
            </span>
            <div className="min-w-0">
              <h3 className="text-title-md text-on-surface font-semibold">{step.title}</h3>
              <p className="text-body-md text-on-surface-variant mt-1 leading-relaxed">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <p className="text-body-md text-on-surface-variant mt-5">
        Stuck at the sign-in screen?{' '}
        <Link href="/help" className="text-primary font-semibold underline">
          Help signing in
        </Link>{' '}
        answers the usual questions.
      </p>
    </section>
  );
}

function Privacy() {
  return (
    <section aria-labelledby="privacy" className="mt-14">
      <h2 id="privacy" className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
        Your account is private
      </h2>
      <div className="bg-surface mt-4 flex gap-4 rounded-3xl p-5 shadow-neu">
        <span className="bg-tertiary-container text-on-tertiary-container flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
          <Icon name="security" size={22} />
        </span>
        <p className="text-body-md text-on-surface-variant leading-relaxed">
          This page is the only part of {`the SACCO's`} website that is open to the public. Member
          records — savings, shares, loans, guarantees, receipts, statements and reports — are
          reachable only after signing in, are visible only to the member they belong to and to the
          staff whose role permits it, and are kept out of search engines entirely.
        </p>
      </div>
    </section>
  );
}

function SiteFooter({ brand }: { brand: Brand }) {
  return (
    <footer className="bg-[#0a2660] px-5 py-8 text-white/80 sm:px-8">
      <div className="mx-auto max-w-[1120px] flex flex-col gap-4">
        <p className={clsx(brandScript.className, 'text-[24px] leading-[1.05] text-white')}>
          Stronger Members
          <br />
          Brighter Futures
        </p>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
          <p className="flex items-center gap-1.5">
            <Icon name="apartment" size={15} className="shrink-0 text-white/60" />
            {brand.legalName}
          </p>
          {brand.contactPhone ? (
            <a
              href={`tel:${brand.contactPhone.replace(/[^+0-9]/g, '')}`}
              className="min-h-touch-target-min flex items-center gap-1.5 rounded-lg px-2 hover:bg-white/10 hover:text-white"
            >
              <Icon name="phone" size={15} className="shrink-0 text-white/60" />
              {brand.contactPhone}
            </a>
          ) : null}
          {brand.contactEmail ? (
            <a
              href={`mailto:${brand.contactEmail}`}
              className="min-h-touch-target-min flex items-center gap-1.5 rounded-lg px-2 hover:bg-white/10 hover:text-white"
            >
              <Icon name="mail" size={15} className="shrink-0 text-white/60" />
              {brand.contactEmail}
            </a>
          ) : null}
          <Link href="/login" className="hover:text-white underline">
            Member sign in
          </Link>
          <Link href="/help" className="hover:text-white underline">
            Help
          </Link>
        </div>

        <p className="text-[12px] text-white/60">
          © {new Date().getFullYear()} {brand.legalName}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

/**
 * Organization structured data.
 *
 * Only fields the project can actually substantiate. No `address`, because no
 * address is recorded; no `foundingDate`, `sameAs`, `aggregateRating` or
 * `review`, for the same reason. `contactPoint` appears only when the SACCO has
 * published a phone number or an e-mail address. Google penalises invented
 * structured data and, more to the point, a member who rang a number we made up
 * would reach a stranger.
 */
function StructuredData({ brand }: { brand: Brand }) {
  const contacts: Record<string, string>[] = [];
  if (brand.contactPhone) {
    contacts.push({
      '@type': 'ContactPoint',
      contactType: 'customer support',
      telephone: brand.contactPhone,
    });
  }
  if (brand.contactEmail) {
    contacts.push({
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: brand.contactEmail,
    });
  }

  const organisation: Record<string, unknown> = {
    '@type': 'Organization',
    '@id': `${absoluteUrl('/')}#organisation`,
    name: brand.legalName,
    alternateName: brand.shortName,
    url: absoluteUrl('/'),
    logo: absoluteUrl('/icons/icon-512.png'),
    description:
      `${brand.legalName} is a savings and credit co-operative society in Uganda, offering ` +
      'its members savings, shares and loans.',
  };
  if (brand.motto) organisation.slogan = brand.motto;
  if (contacts.length) organisation.contactPoint = contacts;

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      organisation,
      {
        '@type': 'WebSite',
        '@id': `${absoluteUrl('/')}#website`,
        url: absoluteUrl('/'),
        name: brand.legalName,
        inLanguage: 'en',
        publisher: { '@id': `${absoluteUrl('/')}#organisation` },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // The payload is built above from the organisation record and fixed
      // strings; there is no user input anywhere in it.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
