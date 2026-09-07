'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/form';
import { printDocument } from '@/lib/print';

/**
 * PDF and CSV export.
 *
 * **PDF** goes through the browser's own print engine, with the report's
 * letterhead supplied by `PrintLetterhead`. Chrome, Edge and Safari all offer
 * "Save as PDF" as a print destination, and they name the file from
 * `document.title` — so `printDocument()` swaps in a proper document name
 * first, and the member gets `BND-SACCO Member Register 2026-09-07.pdf`
 * rather than whatever the tab happened to be called.
 *
 * Shipping a PDF library instead would cost 300 KB–1 MB of JavaScript on
 * phones that already take several seconds to load the app, to reproduce
 * something the browser does natively and better.
 *
 * **CSV** is built in the browser from rows the server already sent, so
 * exporting costs no extra request. Excel opens `.csv` natively; a real
 * `.xlsx` would mean shipping a writer library to produce, for a flat report
 * like this, exactly the same data.
 *
 * The UTF-8 BOM matters: without it Excel on Windows mangles member names with
 * accents, which is not a theoretical problem for a Ugandan membership roll.
 */
export function ExportButtons({
  rows,
  filename,
  documentTitle,
  showPrint = true,
  showCsv = true,
}: {
  /** First row is the header. */
  rows?: (string | number)[][];
  /** Used for the CSV file name and, unless overridden, the PDF name. */
  filename: string;
  /** The name the saved PDF takes. Defaults to `filename`. */
  documentTitle?: string;
  showPrint?: boolean;
  showCsv?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  function downloadCsv() {
    if (!rows) return;
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
    <div className="no-print flex flex-wrap gap-2">
      {showPrint ? (
        <Button
          variant="primary"
          icon="download"
          onClick={() => printDocument(documentTitle ?? filename)}
          title="Opens the print dialog — choose “Save as PDF” as the destination"
        >
          <span className="hidden sm:inline">Download PDF</span>
          <span className="sm:hidden">PDF</span>
        </Button>
      ) : null}

      {showCsv && rows ? (
        <Button variant="outline" icon="description" loading={busy} onClick={downloadCsv}>
          <span className="hidden sm:inline">Export CSV</span>
          <span className="sm:hidden">CSV</span>
        </Button>
      ) : null}
    </div>
  );
}
