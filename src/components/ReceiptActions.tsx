'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/form';
import { Icon } from '@/components/ui/primitives';
import { printDocument } from '@/lib/print';

/**
 * Receipt actions: print, save as PDF, share, copy reference.
 *
 * "Save as PDF" is the browser's own print-to-PDF path rather than a bundled
 * PDF library. On the low-end Android devices most of the membership uses, a
 * client-side PDF generator is several hundred kilobytes of JavaScript to
 * reproduce something Chrome already does natively — and the print stylesheet
 * gives an identical result.
 *
 * "Share" uses the Web Share API where the device offers it, so a member can
 * send the receipt straight into WhatsApp. The button is simply not rendered
 * where the API is unavailable, rather than shown and doing nothing.
 */
export function ReceiptActions({
  reference,
  receiptNo,
  amount,
  type,
  documentTitle,
}: {
  reference: string;
  receiptNo: string;
  amount: string;
  type: string;
  documentTitle?: string;
}) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is unavailable over plain HTTP or when the user has blocked
      // it. The reference is selectable in the receipt body either way.
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: `BND-SACCO receipt ${receiptNo}`,
        text: `BND-SACCO ${type} of ${amount}. Receipt ${receiptNo}, reference ${reference}.`,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
      });
    } catch {
      // The member dismissed the share sheet. Nothing to report.
    }
  }

  return (
    <div className="no-print mt-6 flex flex-col gap-3">
      <div className="flex gap-3">
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          icon="print"
          onClick={() => printDocument(documentTitle)}
        >
          Print
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="flex-1"
          icon="download"
          onClick={() => printDocument(documentTitle)}
          title="Choose “Save as PDF” in the print dialog"
        >
          Download PDF
        </Button>
      </div>

      <div className="flex gap-3">
        <Button
          variant="ghost"
          size="md"
          className="flex-1"
          icon={copied ? 'check' : 'content_copy'}
          onClick={copyReference}
        >
          {copied ? 'Reference copied' : 'Copy reference'}
        </Button>

        {canShare ? (
          <Button variant="ghost" size="md" className="flex-1" icon="share" onClick={share}>
            Share
          </Button>
        ) : null}
      </div>

      <p className="text-label-md font-label-md text-on-surface-variant text-center normal-case">
        <Icon name="info" size={14} className="mr-1 inline align-text-bottom" />
        To save a PDF, choose “Save as PDF” as the destination in the print dialog.
      </p>
    </div>
  );
}
