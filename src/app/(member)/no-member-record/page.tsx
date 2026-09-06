import Image from 'next/image';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { Icon } from '@/components/ui/primitives';
import { SignOutButton } from '@/components/SignOutButton';

export const metadata: Metadata = { title: 'Account not linked' };

/**
 * A signed-in account that is not attached to a member record.
 *
 * This happens when a login is created before the membership paperwork is
 * finished, or if a member record is unlinked. Showing an empty dashboard with
 * UGX 0 everywhere would look like the SACCO had lost their money, so we say
 * plainly what is wrong and who to ask.
 */
export default async function NoMemberRecordPage() {
  const user = await requireUser();

  return (
    <div className="bg-background px-container-margin-mobile flex min-h-[100dvh] flex-col items-center justify-center text-center">
      <Image
        src="/brand/bnd-logo.png"
        alt=""
        width={72}
        height={72}
        className="mb-6 h-16 w-16 object-contain"
      />

      <div className="bg-secondary-container text-on-secondary-container mb-5 flex h-16 w-16 items-center justify-center rounded-full">
        <Icon name="badge" size={32} />
      </div>

      <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
        Your account is not linked to a membership yet
      </h1>
      <p className="text-body-md font-body-md text-on-surface-variant mt-2 max-w-sm">
        You are signed in as {user.fullName}, but this login is not yet connected to a member
        record. Please visit the SACCO office with your National ID and they will complete your
        registration.
      </p>
      <p className="text-body-md font-body-md text-on-surface-variant mt-4 max-w-sm">
        No savings, shares or loans are affected — there is simply nothing to show until the two
        records are linked.
      </p>

      <div className="mt-8 w-full max-w-sm">
        <SignOutButton />
      </div>
    </div>
  );
}
