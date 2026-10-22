import type { Metadata } from 'next';
import { RecoverySupport } from '@/components/auth/RecoverySupport';

export const metadata: Metadata = { title: 'Password Recovery' };

// Includes legacy links with ?reason=unavailable; recovery is suspended for every visit.
export default function RecoveryPage() {
  return <RecoverySupport />;
}
