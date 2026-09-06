'use client';

import { useRouter } from 'next/navigation';
import { MemberPicker } from '@/components/forms/MemberPicker';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { PickedMember } from '@/components/forms/MemberPicker';

/**
 * Member selector for the statement report. Navigating rather than holding
 * local state keeps the chosen member in the URL, so the printed page and the
 * shared link both point at the same document.
 */
export function StatementMemberPicker({
  from,
  to,
  selectedId,
}: {
  from: string;
  to: string;
  selectedId?: string;
}) {
  const router = useRouter();
  const [initial, setInitial] = useState<PickedMember | null>(null);

  useEffect(() => {
    if (!selectedId) {
      setInitial(null);
      return;
    }
    let cancelled = false;

    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('member_financials')
        .select('id, member_no, full_name, phone, photo_url, savings_balance, share_value')
        .eq('id', selectedId)
        .maybeSingle();
      if (!cancelled) setInitial((data as PickedMember) ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <MemberPicker
      name="member"
      label="Member"
      initial={initial}
      onSelect={(m) =>
        router.push(
          m
            ? `/staff/reports/statement?member=${m.id}&from=${from}&to=${to}`
            : '/staff/reports/statement',
        )
      }
    />
  );
}
