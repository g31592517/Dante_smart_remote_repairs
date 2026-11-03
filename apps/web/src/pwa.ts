import { registerSW } from 'virtual:pwa-register';

/**
 * PWA: installable app shell with offline start-up. Updates are applied on the next visit after the
 * user confirms, so a page is never swapped mid-task (e.g. while filling in a request form).
 */
export function registerPwa() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const update = registerSW({
    onNeedRefresh() {
      if (window.confirm('A new version of the app is available. Reload now?')) void update(true);
    },
  });
}
