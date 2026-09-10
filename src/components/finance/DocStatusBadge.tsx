import { Badge } from '@/components/ui/primitives';
import { DOC_STATUS_META } from '@/lib/treasury-format';
import type { FinanceDocStatus } from '@/types/treasury';

/** Draft · Awaiting approval · Completed · Rejected · Cancelled · Reversed. */
export function DocStatusBadge({ status }: { status: FinanceDocStatus }) {
  const meta = DOC_STATUS_META[status] ?? { label: status, tone: 'neutral' as const };
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}
