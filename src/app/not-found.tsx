import Image from 'next/image';
import Link from 'next/link';
import { Icon } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <div className="bg-background flex min-h-[100dvh] flex-col items-center justify-center px-container-margin-mobile text-center">
      <Image
        src="/brand/bnd-logo.png"
        alt=""
        width={72}
        height={72}
        className="mb-6 h-18 w-18 object-contain opacity-80"
      />

      <div className="bg-surface-container-high text-on-surface-variant mb-5 flex h-16 w-16 items-center justify-center rounded-full">
        <Icon name="search" size={32} />
      </div>

      <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
        We could not find that page
      </h1>
      <p className="text-body-md font-body-md text-on-surface-variant mt-2 max-w-sm">
        The link may be out of date, or the record may belong to someone else and not be yours to
        view.
      </p>

      <Link
        href="/"
        className="bg-primary text-on-primary h-touch-target-primary text-button-text font-button-text mt-8 flex w-full max-w-sm items-center justify-center rounded-lg font-semibold"
      >
        Go to the home screen
      </Link>
    </div>
  );
}
