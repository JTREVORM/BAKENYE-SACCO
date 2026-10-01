'use client';

import { useEffect } from 'react';

/**
 * Register the service worker.
 *
 * Nothing in the application depends on it: it is what makes the browser
 * willing to offer installation (`public/sw.js` explains why), and it caches
 * only the icons. A registration failure - an older browser, a private window,
 * a locked-down policy - is swallowed, because the app works identically
 * without it.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    };
    // After load, so registration never competes with the first paint on a
    // phone that is already struggling.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
