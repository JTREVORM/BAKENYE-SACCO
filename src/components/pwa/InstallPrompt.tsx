'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/form';
import { Icon } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import {
  INSTALL_OFFERED_KEY,
  INSTALL_PROMPT_COOKIE,
  alreadyInstalled,
  detectPlatform,
  manualInstructions,
  rememberInstalled,
  type Platform,
} from '@/lib/pwa';
import { INSTALL_EVENT_KEY } from './InstallEventCapture';

/**
 * Offer to install the app, once per sign-in.
 *
 * This is the real installation flow, not a decorative button. Chromium
 * browsers fire `beforeinstallprompt` when a site is installable; that event is
 * caught in the document head (`InstallEventCapture`, because it fires before
 * React hydrates) and `prompt()`ed when the member taps Install, which opens the
 * browser's own dialog. Where no such event exists - Safari, Firefox, an older
 * browser - the same modal shows that browser's manual steps instead of a button
 * that would do nothing.
 *
 * WHEN IT APPEARS
 *
 * A member's sign-in sets a non-secret cookie whose value is a nonce for that
 * sign-in. This component offers the app once per nonce and records which nonce
 * it has offered for. So: after every member sign-in while the app is not
 * installed; never a second time in the same session; again after signing out
 * and back in; never when the app is already installed, whether it is running
 * standalone or being viewed in a tab; and never for staff, who are not given
 * the cookie.
 *
 * It touches nothing to do with authentication, performs no navigation, and
 * renders nothing at all when there is no reason to appear.
 */
export function InstallPrompt({
  appName,
  legalName,
}: {
  /** Short name, for the heading. */
  appName: string;
  /** Full name, for the sentence. */
  legalName: string;
}) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>('other');
  const [showSteps, setShowSteps] = useState(false);
  const [working, setWorking] = useState(false);
  /** The browser's own install event, kept so the button can replay it. */
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  const clearCookie = useCallback(() => {
    // `Secure` is repeated because the cookie was set with it; some browsers
    // refuse to overwrite a Secure cookie from a non-Secure write.
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${INSTALL_PROMPT_COOKIE}=; Max-Age=0; path=/; SameSite=Lax${secure}`;
  }, []);

  /** Whatever the head script has already caught, plus anything fired later. */
  const captured = useCallback((): BeforeInstallPromptEvent | null => {
    const early = (window as unknown as Record<string, unknown>)[INSTALL_EVENT_KEY];
    return deferred.current ?? (early ? (early as BeforeInstallPromptEvent) : null);
  }, []);

  useEffect(() => {
    // The head script caught anything fired before hydration; this catches a
    // later firing, which happens when the browser only decides the page is
    // installable once the service worker has activated.
    function onBeforeInstall(event: Event) {
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
    }
    function onInstalled() {
      deferred.current = null;
      // Remember it, so a later tab on this browser does not offer the app the
      // member has just installed.
      rememberInstalled();
      setOpen(false);
      clearCookie();
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [clearCookie]);

  // Decide whether this sign-in still owes the member an offer.
  useEffect(() => {
    const nonce = readCookie(INSTALL_PROMPT_COOKIE);
    if (!nonce) return;

    // Already offered for this sign-in: nothing more to do. Recorded per tab, so
    // moving around the portal does not ask again, and a fresh sign-in - which
    // mints a new nonce - does.
    if (readOffered() === nonce) {
      clearCookie();
      return;
    }

    // Somebody who already has the app does not need offering it. Recorded when
    // the install succeeded, so it holds in an ordinary tab too, not only when
    // running standalone.
    if (alreadyInstalled()) {
      rememberOffered(nonce);
      clearCookie();
      return;
    }

    setPlatform(detectPlatform());

    // The offer is only counted as made once the modal is actually on screen, so
    // nothing in between can swallow it. If the browser has already handed us an
    // install event there is nothing to wait for; otherwise give Chromium a
    // short grace period to fire it, so the button works rather than falling
    // straight through to manual steps.
    function offer() {
      rememberOffered(nonce!);
      clearCookie();
      setOpen(true);
    }
    if (captured()) {
      offer();
      return;
    }
    const timer = window.setTimeout(offer, 900);
    return () => window.clearTimeout(timer);
  }, [clearCookie, captured]);

  if (!open) return null;

  const guide = manualInstructions(platform);

  async function install() {
    const event = captured();
    if (!event) {
      setShowSteps(true);
      return;
    }
    setWorking(true);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      deferred.current = null;
      (window as unknown as Record<string, unknown>)[INSTALL_EVENT_KEY] = null;
      if (choice.outcome === 'accepted') setOpen(false);
      else setShowSteps(false);
    } catch {
      // The browser refused to replay the event. Fall back to telling the
      // member how to do it themselves rather than failing silently.
      setShowSteps(true);
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => setOpen(false)}
      title={`Install ${appName} App`}
      description={`Add ${legalName} to your device for quick and convenient access to your account.`}
    >
      <div className="flex flex-col gap-5">
        <div className="bg-surface-container-low flex items-center gap-4 rounded-2xl p-4 shadow-neu-inset-sm">
          <Image
            src="/icons/icon-192.png"
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-2xl"
          />
          <div className="min-w-0 flex-1">
            <p className="text-body-lg text-on-surface truncate font-semibold">{appName}</p>
            <p className="text-label-md text-on-surface-variant font-normal normal-case">
              Opens full screen · works from your home screen · no download charges
            </p>
          </div>
        </div>

        <ul className="flex flex-col gap-2">
          {[
            'Open your account in one tap, without typing an address.',
            'Runs full screen, like any other app on your phone.',
            'Nothing is downloaded from a store and nothing to keep updated.',
          ].map((line) => (
            <li key={line} className="text-body-md text-on-surface-variant flex items-start gap-2">
              <Icon name="check_circle" size={18} className="text-tertiary mt-0.5 shrink-0" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {showSteps ? (
          <Alert tone="info" title={guide.heading}>
            <ol className="mt-1 flex list-inside list-decimal flex-col gap-1">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          {/* Where the browser offers no programmatic install, the button opens
              the instructions for this browser instead of pretending. */}
          <Button
            size="lg"
            className="sm:flex-1"
            icon="download"
            onClick={install}
            disabled={working}
          >
            {working ? 'Installing…' : !showSteps ? 'Install App' : 'Show me how'}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="sm:flex-1"
            onClick={() => setOpen(false)}
          >
            Not Now
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** One cookie value, or null. Never throws. */
function readCookie(name: string): string | null {
  const hit = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

/** Which sign-in this tab has already made the offer for. */
function readOffered(): string | null {
  try {
    return window.sessionStorage.getItem(INSTALL_OFFERED_KEY);
  } catch {
    return null;
  }
}

function rememberOffered(nonce: string): void {
  try {
    window.sessionStorage.setItem(INSTALL_OFFERED_KEY, nonce);
  } catch {
    /* private window: the offer may appear once more, which is harmless */
  }
}

/**
 * The event Chromium fires when a site meets the installability criteria. It is
 * not in the DOM typings because it is not in the specification yet.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
