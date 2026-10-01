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
 * A successful member sign-in sets one cookie, `bnd_install_prompt`, with no
 * value of any consequence. The member area reads it in the browser, shows the
 * modal once, and deletes it. That gives exactly the behaviour asked for:
 *
 *   * prompted after every sign-in while the app is not installed,
 *   * never twice in one session, because the cookie is gone after the first
 *     render,
 *   * prompted again after signing out and back in, because signing in sets it
 *     again,
 *   * never for staff, because the sign-in action only sets it for a member.
 *
 * The cookie is readable by the browser (it is not httpOnly) because the client
 * is what clears it. It carries no identity, no token and nothing private - it
 * says "this person has just signed in", which they already know. It is not
 * read by the middleware and nothing about authentication depends on it, so it
 * cannot cause a redirect loop: at worst the modal does not appear.
 */

export const INSTALL_PROMPT_COOKIE = 'bnd_install_prompt';

/** The cookie the sign-in action sets. Session-lived, same-site, not httpOnly. */
export const installPromptCookieOptions = {
  httpOnly: false,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  // A couple of minutes is plenty to survive the redirect into the portal, and
  // short enough that a cookie left behind by a closed tab expires on its own.
  maxAge: 300,
};

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
