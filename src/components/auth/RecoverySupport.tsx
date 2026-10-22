import Link from 'next/link';
import { LoginScene } from '@/app/(auth)/login/LoginScene';
import { Icon } from '@/components/ui/primitives';
import { RECOVERY_SUSPENDED_MESSAGE } from '@/lib/recovery';

/** The same support destination for direct visits and legacy recovery links. */
export function RecoverySupport() {
  const [notice, assistance] = RECOVERY_SUSPENDED_MESSAGE.split(/(?<=\.)\s+/, 2);
  return (
    <LoginScene heading="Password Recovery" introduction="Account access support">
      <article className="mt-6 rounded-[28px] border-t-4 border-[#bf9644] bg-white p-6 shadow-card sm:p-8" aria-labelledby="login-heading">
        <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#edf2f8] text-[#142a43]">
          <Icon name="lock" size={28} />
        </span>
        <p className="mt-5 text-base font-semibold leading-relaxed text-[#142a43]">{notice}</p>
        <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-[#53677f]">
          <p>For your account&apos;s security, online password recovery is currently unavailable.</p>
          <p>If you have forgotten your password, {assistance.charAt(0).toLowerCase() + assistance.slice(1)}</p>
          <p>Our authorized staff will help you securely regain access to your account.</p>
        </div>
        <Link href="/login" className="mt-7 flex min-h-14 items-center justify-center gap-2 rounded-full bg-[#142a43] px-4 py-3 font-semibold text-white hover:bg-[#203e60] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#142a43]">
          <Icon name="arrow_back" size={20} />Back to Sign In
        </Link>
      </article>
    </LoginScene>
  );
}
