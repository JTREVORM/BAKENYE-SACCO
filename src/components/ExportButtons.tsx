'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/form';

/**
 * Print and CSV export.
 *
 * CSV is built in the browser from rows the server already sent, so exporting
 * costs no extra request and no server-side spreadsheet library. Excel opens
 * `.csv` natively; a real `.xlsx` would mean shipping a writer library (~200KB)
 * to produce a file that, for a flat report like this, would contain exactly
 * the same data.
 *
 * The UTF-8 BOM matters: without it Excel on Windows mangles member names with
 * accents, which is not a theoretical problem for a Ugandan membership roll.
 */
export function ExportButtons({
  rows,
  filename,
  showPrint = true,
}: {
  /** First row is the header. */
  rows: (string | number)[][];
  filename: string;
  showPrint?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  function downloadCsv() {
    setBusy(true);
    try {
      const csv = rows
        .map((row) =>
          row
            .map((cell) => {
              const value = String(cell ?? '');
              // Quote anything that could break the column structure, and
              // double any embedded quotes.
              return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
            })
            .join(','),
        )
        .join('\r\n');

      const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-print flex gap-2">
      {showPrint ? (
        <Button variant="outline" icon="print" onClick={() => window.print()}>
          <span className="hidden sm:inline">Print</span>
        </Button>
      ) : null}
      <Button variant="outline" icon="download" loading={busy} onClick={downloadCsv}>
        <span className="hidden sm:inline">Export CSV</span>
        <span className="sm:hidden">CSV</span>
      </Button>
    </div>
  );
}
