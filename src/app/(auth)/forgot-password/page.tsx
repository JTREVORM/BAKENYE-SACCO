import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-sm flex-col px-container-margin-mobile py-10">
      <Link
        href="/login"
        className="text-primary hover:bg-surface-container-high -ml-2 mb-6 flex h-11 w-11 items-center justify-center rounded-full"
        aria-label="Back to sign in"
      >
        <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </Link>

      <Image
        src="/brand/bnd-logo.png"
        alt=""
        width={64}
        height={64}
        className="h-16 w-16 object-contain"
      />

      <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface mt-6">
        Reset your password
      </h1>
      <p className="text-body-md font-body-md text-on-surface-variant mt-2">
        Enter the email address on your BND-SACCO account and we will send you a link to set a new
        password.
      </p>

      <ForgotPasswordForm />

      <p className="text-body-md font-body-md text-on-surface-variant mt-8">
        If you registered without an email address, please call or visit the SACCO office to have
        your password reset.
      </p>
    </div>
  );
}
