import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageTitle } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Statement } from '@/components/Statement';
import { StatementRange } from '@/components/StatementRange';
import { StatementMemberPicker } from './StatementMemberPicker';
import { monthStart, toISODate } from '@/lib/format';
import type { MemberStatement } from '@/types/db';

export const metadata: Metadata = { title: 'Member Statement' };

/**
 * Staff-issued member statement.
 *
 * The same `member_statement()` the member sees, so a statement printed at the
 * counter and one the member downloads at home are byte-for-byte the same
 * document.
 */
export default async function StaffStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string; from?: string; to?: string }>;
}) {
  await requirePermission('reports.member');
  const sp = await searchParams;

  const today = new Date();
  const from = isDate(sp.from) ? sp.from! : monthStart(new Date(today.getFullYear(), today.getMonth() - 2, 1));
  const to = isDate(sp.to) ? sp.to! : toISODate(today);

  let statement: MemberStatement | null = null;
  let failed = false;

  if (sp.member) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('member_statement', {
      p_member_id: sp.member,
      p_from: from,
      p_to: to,
    });
    if (error) failed = true;
    else statement = data as MemberStatement;
  }

  return (
    <div>
      <div className="no-print">
        <PageTitle
          title="Member Statement"
          subtitle="Choose a member and a period, then print or save a PDF."
        />

        <div className="mb-6 flex flex-col gap-4">
          <StatementMemberPicker from={from} to={to} selectedId={sp.member} />
          {sp.member ? <StatementRange from={from} to={to} /> : null}
        </div>
      </div>

      {!sp.member ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState
            icon="description"
            title="Choose a member"
            description="Search above to produce their savings statement."
          />
        </div>
      ) : failed || !statement ? (
        <ErrorState
          title="Unable to build the statement"
          description="Please check your connection and try again."
        />
      ) : (
        <Statement statement={statement} />
      )}
    </div>
  );
}

function isDate(v: string | undefined): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
