'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/primitives';

/**
 * The payment reference a member quotes when paying by mobile money or bank
 * transfer. Tap-to-copy, because retyping a reference on a phone keypad while
 * standing at an agent's counter is exactly where errors happen.
 */
export function CopyableReference({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked or unavailable; the text is still selectable.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="bg-secondary-container text-on-secondary-container hover:bg-secondary-fixed-dim flex w-full items-center justify-between gap-3 rounded-xl p-4 text-left transition-colors"
    >
      <span className="min-w-0">
        <span className="text-label-md font-label-md block">Payment reference</span>
        <span className="text-button-text font-button-text tabular mt-1 block select-all break-all font-mono">
          {reference}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Icon name={copied ? 'check' : 'content_copy'} size={20} />
        <span className="text-label-md font-label-md normal-case">
          {copied ? 'Copied' : 'Copy'}
        </span>
      </span>
    </button>
  );
}
