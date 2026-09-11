import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@/components/ui/primitives';
import type { IconName } from '@/lib/icons';

export const metadata: Metadata = { title: 'Help signing in' };

/**
 * Sign-in help.
 *
 * Reachable without a session, since the people who need it are by definition
 * locked out. Listed in `PUBLIC_PATHS`-adjacent routing terms: it is a static
 * page with no data, so the middleware redirect to /login would be actively
 * unhelpful here.
 */
export default function HelpPage() {
  return (
    <div className="bg-background px-container-margin-mobile mx-auto min-h-[100dvh] w-full max-w-lg py-10">
      <Link
        href="/login"
        className="text-primary hover:bg-surface-container-high -ml-2 mb-6 flex h-11 w-11 items-center justify-center rounded-full"
        aria-label="Back to sign in"
      >
        <Icon name="arrow_back" />
      </Link>

      <Image
        src="/brand/bnd-logo.png"
        alt=""
        width={64}
        height={64}
        className="h-16 w-16 object-contain"
      />

      <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface mt-6">
        Help signing in
      </h1>

      <div className="mt-6 flex flex-col gap-4">
        <Item
          icon="badge"
          title="What do I sign in with?"
          body="Your member number (on your passbook, like BND-M-0000123) or your phone number, and your password. Staff can also use their email. There is one sign-in for everyone."
        />
        <Item
          icon="lock"
          title="I have forgotten my password"
          body="Use “Forgot Password?” on the sign-in screen. If you have no email, visit the office with your National ID: staff give you a one-time reset code - never your password - and you choose a new one under “Set up your account”."
        />
        <Item
          icon="person"
          title="I have never signed in before"
          body="When you registered, the office gave you a setup code. Choose “Set up your account” on the sign-in screen, enter your member number or phone and the code, and choose your password. Lost the code? Ask the office for a new one."
        />
        <Item
          icon="block"
          title="It says my account is unavailable or suspended"
          body="This happens when a membership is suspended or closed. Please speak to the SACCO administration — your savings and shares are unaffected."
        />
        <Item
          icon="phone"
          title="Still stuck?"
          body="Visit the SACCO office during working hours with your National ID. Staff can look up your membership and put it right."
        />
      </div>

      <Link
        href="/login"
        className="bg-primary text-on-primary h-touch-target-primary text-button-text font-button-text mt-8 flex items-center justify-center rounded-lg font-semibold"
      >
        Back to sign in
      </Link>
    </div>
  );
}

function Item({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <section className="bg-surface shadow-card flex gap-3 rounded-xl p-4">
      <span className="bg-primary-fixed text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <h2 className="text-button-text font-button-text text-on-surface">{title}</h2>
        <p className="text-body-md font-body-md text-on-surface-variant mt-1">{body}</p>
      </div>
    </section>
  );
}
