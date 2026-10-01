/**
 * Installing the app on a member's phone.
 *
 * The one place that knows how the install prompt is armed, how it is
 * suppressed, and how to tell whether the app is already installed. The modal
 * (`components/pwa/InstallPrompt.tsx`) and the sign-in action both read from
 * here so they cannot disagree.
 *
 * HOW IT IS ARMED
 *
 * Every sign-in sets one cookie, `bnd_install_prompt`, whose value is a nonce
 * identifying that sign-in. The member area and the staff workspace each read it
 * in the browser and offer the app once per nonce, remembering which nonce they
 * have already offered for in `sessionStorage`.
 *
 * The nonce is what makes this robust. An earlier version used a fixed value
 * and relied on *deleting* the cookie to mean "already offered", which lost the
 * offer whenever the cookie went early or late:
 *
 *   * somebody sent through "choose your password" first spent that detour on a
 *     screen that reads nothing, and a slow detour outlived a short-lived
 *     cookie;
 *   * the browser consumed the cookie before the modal was actually on screen,
 *     so anything that interrupted the gap between the two lost the offer for
 *     good.
 *
 * With a nonce, the cookie may be read early, late or twice; what decides is
 * whether this sign-in's nonce has been offered for yet. That gives exactly the
 * behaviour asked for:
 *
 *   * prompted after every sign-in while the app is not installed,
 *   * never twice in one session, because the nonce is recorded once offered,
 *   * prompted again after signing out and back in, because a new sign-in mints
 *     a new nonce,
 *   * offered to members and staff alike - the SACCO asked for staff to be
 *     included after the first release, which had left them out,
 *   * never for someone who has already installed it on this device.
 *
 * The cookie is readable by the browser (it is not httpOnly) because the client
 * is what clears it. It carries no identity, no token and nothing private - a
 * random nonce and the fact that somebody just signed in, which they know. It
 * is not read by the middleware and nothing about authentication depends on it,
 * so it cannot cause a redirect loop: at worst the modal does not appear.
 */

export const INSTALL_PROMPT_COOKIE = 'bnd_install_prompt';

/** Which sign-in the browser has already made the offer for, per tab. */
export const INSTALL_OFFERED_KEY = 'bnd_install_offered';

/** That this browser installed the app, so later tabs do not ask again. */
export const INSTALLED_LOCALLY_KEY = 'bnd_app_installed';

/** A value identifying one sign-in. Not a secret and not an identifier. */
export function newLoginNonce(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** The cookie a member's sign-in sets. Same-site, not httpOnly, no identity. */
export const installPromptCookieOptions = {
  httpOnly: false,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  // Long enough to survive a "choose your password" detour on a first sign-in
  // and a slow first paint on a 3G phone. It is safe to outlive the visit
  // because the nonce, not the cookie's absence, is what stops a second offer.
  maxAge: 30 * 60,
};

/**
 * Has this browser already installed the app?
 *
 * Running standalone proves it. Otherwise we rely on what we recorded when the
 * install succeeded: a browser gives a page no way to ask "is this site
 * installed?" from an ordinary tab, so an installed member who opens the site in
 * a tab would otherwise be offered the app they already have.
 */
export function alreadyInstalled(): boolean {
  if (isStandalone()) return true;
  try {
    return window.localStorage.getItem(INSTALLED_LOCALLY_KEY) === '1';
  } catch {
    // Private window, or site data blocked. Fall back to "not installed": an
    // extra offer is better than never offering.
    return false;
  }
}

/** Remember that this browser installed the app, so later tabs do not ask. */
export function rememberInstalled(): void {
  try {
    window.localStorage.setItem(INSTALLED_LOCALLY_KEY, '1');
  } catch {
    /* nothing to do - the prompt simply may appear again */
  }
}

/** Is the app being viewed as an installed app rather than in a browser tab? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  if (window.matchMedia?.('(display-mode: fullscreen)').matches) return true;
  if (window.matchMedia?.('(display-mode: minimal-ui)').matches) return true;
  // iOS Safari's own flag, which predates the display-mode query.
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

/** The browser family, only as far as the install instructions differ. */
export type Platform = 'android-chrome' | 'ios-safari' | 'desktop' | 'firefox' | 'other';

export function detectPlatform(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): Platform {
  const s = ua.toLowerCase();
  const ios = /iphone|ipad|ipod/.test(s) || (/macintosh/.test(s) && typeof document !== 'undefined' && 'ontouchend' in document);
  if (ios) return 'ios-safari';
  if (/firefox|fxios/.test(s)) return 'firefox';
  if (/android/.test(s)) return 'android-chrome';
  if (/windows|macintosh|linux|cros/.test(s)) return 'desktop';
  return 'other';
}

/**
 * What to tell someone whose browser will not install the app for them.
 *
 * Never a dead "Install" button: if the browser has given us no install event,
 * the modal shows these steps instead so the member can still do it by hand.
 */
export function manualInstructions(platform: Platform): { heading: string; steps: string[] } {
  switch (platform) {
    case 'ios-safari':
      return {
        heading: 'Add to your Home Screen',
        steps: [
          'Tap the Share button at the bottom of Safari.',
          'Scroll down and tap “Add to Home Screen”.',
          'Tap “Add”. The app appears with your other apps.',
        ],
      };
    case 'android-chrome':
      return {
        heading: 'Add to your Home screen',
        steps: [
          'Tap the ⋮ menu at the top right of the browser.',
          'Tap “Add to Home screen” or “Install app”.',
          'Confirm, and the app appears with your other apps.',
        ],
      };
    case 'firefox':
      return {
        heading: 'Install from the Firefox menu',
        steps: [
          'Open the Firefox menu (⋮ on a phone, ☰ on a computer).',
          'Choose “Install” or “Add to Home screen”.',
          'Confirm to finish.',
        ],
      };
    default:
      return {
        heading: 'Install from your browser menu',
        steps: [
          'Open your browser’s menu.',
          'Look for “Install app”, “Install this site as an app” or “Add to Home screen”.',
          'Confirm to finish. If you cannot find it, Chrome, Edge and Safari all offer it.',
        ],
      };
  }
}
