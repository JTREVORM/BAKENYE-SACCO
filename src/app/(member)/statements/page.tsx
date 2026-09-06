import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getUnreadCount } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { MemberShell } from '@/components/layout/MemberShell';
import { Statement } from '@/components/Statement';
import { StatementRange } from '@/components/StatementRange';
import { ErrorState } from '@/components/ui/states';
import { monthStart, toISODate } from '@/lib/format';
import type { MemberStatement } from '@/types/db';

export const metadata: Metadata = { title: 'Statement' };

/**
 * Member statement.
 *
 * The range lives in the URL so a member can bookmark "last quarter" and share
 * the link with the office. `member_statement()` computes the opening balance
 * and running balances in Postgres — the browser never adds money up.
 */
export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireMember();
  const sp = await searchParams;
  const unread = await getUnreadCount();

  // Default to the last three months — long enough to be useful, short enough
  // to stay fast on a phone.
  const today = new Date();
  const defaultFrom = monthStart(new Date(today.getFullYear(), today.getMonth() - 2, 1));
  const from = isValidDate(sp.from) ? sp.from! : defaultFrom;
  const to = isValidDate(sp.to) ? sp.to! : toISODate(today);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('member_statement', {
    p_member_id: user.memberId,
    p_from: from,
    p_to: to,
  });

  return (
    <MemberShell unreadCount={unread}>
      <div className="flex flex-col gap-5 py-4">
        <div className="no-print">
          <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
            Statement
          </h1>
          <p className="text-body-md font-body-md text-on-surface-variant mt-1">
            Print or download a record of your savings activity.
          </p>
        </div>

        <StatementRange from={from} to={to} />

        {error || !data ? (
          <ErrorState
            title="Unable to build your statement"
            description="Please check your connection and try again."
          />
        ) : (
          <Statement statement={data as MemberStatement} />
        )}
      </div>
    </MemberShell>
  );
}

function isValidDate(value: string | undefined): boolean {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}
