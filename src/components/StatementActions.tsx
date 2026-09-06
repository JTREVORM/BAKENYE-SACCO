'use client';

import { Button } from '@/components/ui/form';

/**
 * Print / PDF for a statement. Same reasoning as the receipt: the browser's
 * own print-to-PDF beats shipping a PDF engine to a low-end phone, and the
 * print stylesheet already lays the page out for A4.
 */
export function StatementActions() {
  return (
    <div className="no-print flex gap-3">
      <Button variant="primary" size="lg" className="flex-1" icon="print" onClick={() => window.print()}>
        Print
      </Button>
      <Button
        variant="outline"
        size="lg"
        className="flex-1"
        icon="download"
        onClick={() => window.print()}
        title="Choose “Save as PDF” in the print dialog"
      >
        Save PDF
      </Button>
    </div>
  );
}
