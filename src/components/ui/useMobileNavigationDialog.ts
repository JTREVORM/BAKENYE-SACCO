'use client';

import { useEffect, useRef } from 'react';

/** The same native dialog focus/inertness behavior as Modal, while keeping
 * the existing navigation drawer's layout and closing it on desktop. */
export function useMobileNavigationDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const mobile = window.matchMedia('(max-width: 767px)');
    const sync = () => {
      if (open && mobile.matches) {
        if (!dialog.open) dialog.showModal();
      } else if (dialog.open) dialog.close();
    };
    sync();
    mobile.addEventListener('change', sync);
    return () => {
      mobile.removeEventListener('change', sync);
      if (dialog.open) dialog.close();
    };
  }, [open]);
  return ref;
}
