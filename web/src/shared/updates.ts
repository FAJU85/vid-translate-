/**
 * Keeping the installed app (and open tabs) on the newest KAVOX. Each build has an id (written in
 * by web/vite.config.ts); /version.json says the id of what is live now. The app compares the two.
 *
 * Work in progress (an upload, a video being made, unsaved subtitle edits) holds updates: the app
 * never reloads on its own under it, and asks before reloading when the person taps Refresh.
 */
declare const __BUILD_ID__: string;

/** This page's build ('dev' in `npm run dev`, where nothing is checked). */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

let holds = 0;

/** Something must not be interrupted: call the returned function when it is over. */
export function holdUpdates(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
  };
}

/** True while an upload, a video in progress or unsaved edits would be lost by a reload. */
export const updatesHeld = () => holds > 0;

/** The build that is live now, or null when it cannot be read (offline). */
export async function liveBuild(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { build?: unknown };
    return typeof body.build === 'string' ? body.build : null;
  } catch {
    return null;
  }
}

/** Ask the browser to look for a new service worker now (not only once a day). */
export function checkServiceWorker(): void {
  try {
    void navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
  } catch {
    /* not supported here */
  }
}
