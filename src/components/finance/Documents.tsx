'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { attachFinanceDocument } from '@/app/actions/treasury';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/primitives';
import { Button, SubmitButton } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { DocumentField } from './forms/fields';
import type { ActionResult } from '@/lib/errors';
import type { FinanceDocumentRow } from '@/types/treasury';

/**
 * The supporting documents on one entry, each opened through a short-lived
 * signed link, plus - for staff who record finance - a way to attach another.
 */
export function DocumentsButton({
  ownerType,
  ownerId,
  documents,
  canAttach,
}: {
  ownerType: FinanceDocumentRow['owner_type'];
  ownerId: string;
  documents: Pick<FinanceDocumentRow, 'id' | 'file_name' | 'created_at'>[];
  canAttach: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult<{ attached: boolean }> | null, FormData>(
    attachFinanceDocument,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  if (documents.length === 0 && !canAttach) return null;

  return (
    <>
      <Button size="sm" variant="ghost" icon="attach_file" onClick={() => setOpen(true)}>
        {documents.length > 0 ? `Documents (${documents.length})` : 'Attach'}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Supporting documents">
        <div className="flex flex-col gap-5">
          {documents.length > 0 ? (
            <ul className="divide-y divide-outline-variant/70 rounded-2xl bg-surface-container-low px-4 shadow-neu-inset-sm">
              {documents.map((d) => (
                <li key={d.id}>
                  <a
                    href={`/staff/finance/documents/${d.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-touch-target-min items-center gap-3 py-3 text-body-md font-semibold text-primary hover:underline"
                  >
                    <Icon name="description" size={18} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{d.file_name}</span>
                    <Icon name="open_in_new" size={16} className="shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">No documents attached yet.</p>
          )}

          {canAttach ? (
            <form action={action} className="flex flex-col gap-4" noValidate>
              <input type="hidden" name="owner_type" value={ownerType} />
              <input type="hidden" name="owner_id" value={ownerId} />
              {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
              {state?.ok ? <Alert tone="success">{state.message}</Alert> : null}
              <DocumentField label="Attach a document" />
              <SubmitButton pendingLabel="Uploading…" icon="upload_file">
                Attach
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
