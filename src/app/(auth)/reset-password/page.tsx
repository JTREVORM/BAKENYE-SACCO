import type { Metadata } from 'next';
import Image from 'next/image';
import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata: Metadata = { title: 'Set a new password' };

export default function ResetPasswordPage() {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-sm flex-col px-container-margin-mobile py-10">
      <Image
        src="/brand/bnd-logo.png"
        alt=""
        width={64}
        height={64}
        className="h-16 w-16 object-contain"
      />

      <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface mt-6">
        Set a new password
      </h1>
      <p className="text-body-md font-body-md text-on-surface-variant mt-2">
        Choose a password you have not used on this account before.
      </p>

      <ResetPasswordForm />
    </div>
  );
}
