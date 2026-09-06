import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Sign-in.
 *
 * Stitch did not export a login screen, so this one is assembled entirely from
 * the design system it did define: the `primary` royal-blue field, the BND
 * crest, `display-currency` / `headline-lg-mobile` type roles, 56px primary
 * action, and the same card treatment as every other surface.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const { next, reset } = await searchParams;

  return (
    <div className="bg-primary flex min-h-[100dvh] flex-col">
      {/* Brand band — the royal blue that anchors the whole app. */}
      {/* `overflow-hidden` is load-bearing: the decorative blur below is
          positioned outside the box, and without clipping it widens the
          document and produces a horizontal scrollbar from 768px up. */}
      <div className="px-container-margin-mobile relative flex flex-col items-center overflow-hidden pb-10 pt-14 text-center">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5 blur-2xl" />
        <Image
          src="/brand/bnd-logo.png"
          alt="Bakenye National Development SACCO"
          width={96}
          height={96}
          priority
          className="h-20 w-20 rounded-full bg-white object-contain p-1 shadow-lg sm:h-24 sm:w-24"
        />
        <h1 className="text-on-primary text-headline-lg-mobile font-headline-lg-mobile mt-4 font-bold">
          BND-SACCO
        </h1>
        <p className="text-primary-fixed-dim text-body-md font-body-md mt-1 max-w-xs">
          Bakenye National Development SACCO
        </p>
      </div>

      {/* Sheet — rises over the brand band, matching the Level-3 treatment. */}
      <div className="bg-background flex flex-1 flex-col rounded-t-[1.5rem] px-container-margin-mobile pt-8 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]">
        <div className="mx-auto w-full max-w-sm pb-10">
          <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
            Welcome back
          </h2>
          <p className="text-body-md font-body-md text-on-surface-variant mt-1">
            Sign in to view your savings, shares and loans.
          </p>

          <LoginForm next={next} resetDone={reset === 'done'} />

          <p className="text-body-md font-body-md text-on-surface-variant mt-8 text-center">
            Not registered yet? Visit the SACCO office to open your membership.
          </p>

          <p className="text-label-md font-label-md text-on-surface-variant mt-6 text-center normal-case">
            <Link href="/help" className="text-primary underline">
              Need help signing in?
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
