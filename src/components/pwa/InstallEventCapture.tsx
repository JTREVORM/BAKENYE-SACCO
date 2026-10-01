/**
 * Catch the browser's install event before React is running.
 *
 * Chrome fires `beforeinstallprompt` as soon as it decides a page is
 * installable, which is usually before the page's own JavaScript has hydrated.
 * A listener added in a `useEffect` therefore misses it, and the "Install App"
 * button then has no event to replay - the member is shown manual instructions
 * on a browser that would have installed the app for them in one tap.
 *
 * So the listener is this: a few lines inline in the document head, which run
 * before anything else and park the event on `window` for the modal to pick up.
 * It is a Server Component, so none of it is in the client bundle.
 */
export const INSTALL_EVENT_KEY = '__bndInstallPromptEvent';
export const INSTALLED_KEY = '__bndAppInstalled';

const SCRIPT = `(function(){
  try {
    window.${INSTALL_EVENT_KEY} = null;
    window.${INSTALLED_KEY} = false;
    window.addEventListener('beforeinstallprompt', function (e) {
      // Keeping the event is what lets the Install button open the browser's own
      // dialog later; preventing the default stops the mini-infobar as well.
      e.preventDefault();
      window.${INSTALL_EVENT_KEY} = e;
    });
    window.addEventListener('appinstalled', function () {
      window.${INSTALL_EVENT_KEY} = null;
      window.${INSTALLED_KEY} = true;
    });
  } catch (e) { /* an old browser: the modal falls back to manual steps */ }
})();`;

export function InstallEventCapture() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
