import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageTitle, Avatar, Badge } from '@/components/ui/primitives';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { AuditFilters } from './AuditFilters';
import { AuditDiff } from './AuditDiff';
import { AuditPager } from './AuditPager';
import { ROLE_LABELS, type Role } from '@/lib/rbac';
import { formatDateTime } from '@/lib/format';
import type { AuditLogRow } from '@/types/db';
import { ScrollRow } from '@/components/ui/scroll';

export const metadata: Metadata = { title: 'Audit Log' };

const PAGE_SIZE = 30;

/**
 * System audit log.
 *
 * `audit_logs_desktop/code.html` connected to the real `audit_logs` table:
 * date and time, the staff member responsible, the action, the module, and the
 * details — with the before/after values expandable, which the Stitch design
 * gestured at with a "Details / Reason" column.
 *
 * The table is append-only. There is no edit and no delete anywhere in this
 * application, and no policy that would permit one — `write_audit()` is the
 * sole writer and it is `SECURITY DEFINER`.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; module?: string; page?: string }>;
}) {
  await requirePermission('audit.view');
  const sp = await searchParams;

  return (
    <div>
      <PageTitle
        title="System Audit Log"
        subtitle="An append-only record of every administrative action."
      />

      <AuditFilters />

      <Suspense key={JSON.stringify(sp)} fallback={<TableSkeleton rows={10} cols={5} />}>
        <Log sp={sp} />
      </Suspense>
    </div>
  );
}

async function Log({ sp }: { sp: { q?: string; module?: string; page?: string } }) {
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const supabase = await createClient();

  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (sp.module) query = query.eq('module', sp.module);

  if (sp.q?.trim()) {
    const term = `%${sp.q.trim()}%`;
    query = query.or(`summary.ilike.${term},actor_name.ilike.${term},action.ilike.${term}`);
  }

  const offset = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(offset, offset + PAGE_SIZE - 1);

  if (error) {
    return (
      <ErrorState
        title="Unable to load the audit log"
        description="Please check your connection and try again."
      />
    );
  }

  const rows = (data ?? []) as AuditLogRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (rows.length === 0) {
    return (
      <div className="bg-surface mt-6 rounded-xl shadow-neu-sm">
        <EmptyState
          icon="policy"
          title={sp.q || sp.module ? 'No matching entries' : 'No activity recorded yet'}
          description={
            sp.q || sp.module
              ? 'Try a different search term or module.'
              : 'Administrative actions will be recorded here as they happen.'
          }
        />
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <p className="text-label-md font-label-md text-on-surface-variant normal-case">
        {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'}
      </p>

      {/* Mobile: cards */}
      <ul className="flex flex-col gap-2 lg:hidden">
        {rows.map((r) => (
          <li
            key={r.id}
            className="bg-surface border-surface-container shadow-card rounded-xl border p-3"
          >
            <div className="flex items-start gap-3">
              <Avatar name={r.actor_name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-body-md font-body-md text-on-surface break-words font-semibold">
                  {r.summary ?? r.action}
                </p>
                <p className="text-label-md font-label-md text-on-surface-variant mt-1 normal-case">
                  {r.actor_name ?? 'System'}
                  {r.actor_role ? ` · ${ROLE_LABELS[r.actor_role as Role]}` : ''}
                </p>
                <p className="text-label-md font-label-md text-on-surface-variant/70 normal-case">
                  {formatDateTime(r.created_at)}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone="neutral">{r.module}</Badge>
                  <Badge tone={toneFor(r.action)}>{r.action}</Badge>
                </div>
                {r.reason ? (
                  <p className="text-body-md font-body-md text-on-surface-variant mt-2 break-words">
                    <span className="font-semibold">Reason:</span> {r.reason}
                  </p>
                ) : null}
              </div>
            </div>

            {r.old_value || r.new_value ? (
              <div className="border-outline-variant mt-3 border-t pt-3">
                <AuditDiff oldValue={r.old_value} newValue={r.new_value} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="bg-surface shadow-card hidden overflow-hidden rounded-xl lg:block">
        <ScrollRow arrows="overlay" label="Table, scrolls sideways">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surface-container-low/50 text-on-surface-variant text-label-md font-label-md border-outline-variant border-b">
                <th className="p-4 font-semibold">Date &amp; Time</th>
                <th className="p-4 font-semibold">User (Staff)</th>
                <th className="p-4 font-semibold">Action</th>
                <th className="p-4 font-semibold">Module</th>
                <th className="p-4 font-semibold">Details / Reason</th>
              </tr>
            </thead>
            <tbody className="text-body-md font-body-md text-on-surface divide-outline-variant/70 divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-container-low align-top transition-colors">
                  <td className="text-on-surface-variant p-4 whitespace-nowrap">
                    {formatDateTime(r.created_at)}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Avatar name={r.actor_name} size={28} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.actor_name ?? 'System'}</div>
                        {r.actor_role ? (
                          <div className="text-on-surface-variant text-xs">
                            {ROLE_LABELS[r.actor_role as Role]}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <Badge tone={toneFor(r.action)}>{r.action}</Badge>
                  </td>
                  <td className="text-on-surface-variant p-4 whitespace-nowrap">{r.module}</td>
                  <td className="max-w-md p-4">
                    <p className="break-words">{r.summary}</p>
                    {r.reason ? (
                      <p className="text-on-surface-variant mt-1 break-words text-xs">
                        Reason: {r.reason}
                      </p>
                    ) : null}
                    {r.old_value || r.new_value ? (
                      <div className="mt-2">
                        <AuditDiff oldValue={r.old_value} newValue={r.new_value} />
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRow>
      </div>

      {totalPages > 1 ? <AuditPager page={page} totalPages={totalPages} /> : null}
    </div>
  );
}

function toneFor(action: string) {
  if (action.includes('reversed') || action.includes('rejected') || action.includes('deactivated'))
    return 'error' as const;
  if (action.includes('approved') || action.includes('disbursed') || action.includes('created'))
    return 'success' as const;
  if (action.includes('role_changed') || action.includes('removed')) return 'warning' as const;
  return 'neutral' as const;
}

