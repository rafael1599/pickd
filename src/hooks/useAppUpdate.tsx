import { useEffect } from 'react';
import toast from 'react-hot-toast';

const CHECK_EVERY_MS = 5 * 60_000;
const FIRST_CHECK_MS = 60_000;

/** True when the build being served is not the one this page is running. */
export function isNewerBuild(served: unknown, running: string): boolean {
  if (typeof served !== 'object' || served === null) return false;
  const build = (served as { build?: unknown }).build;
  return typeof build === 'string' && build.length > 0 && build !== running;
}

/** The short commit a build came from, for the menu ('37bd187'). */
export function buildCommit(build: string): string {
  return build.split('-')[0];
}

function offerReload() {
  toast(
    () => (
      <span className="flex items-center gap-3">
        <span className="font-bold">New PickD version</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-black uppercase tracking-widest"
        >
          Reload
        </button>
      </span>
    ),
    { id: 'app-update', duration: Infinity }
  );
}

/**
 * Tells an open page that a newer build is live. A phone on the floor keeps
 * PickD open for hours and runs whatever it loaded in the morning — on 11 Sep a
 * fix went live at 16:15 and a phone kept dropping ticks at 16:17 because it
 * still ran the old build. The check reads `version.json` (emitted by
 * vite.config.ts) a minute after loading, every five minutes, and whenever the
 * page comes back to the screen; a tap on Reload applies it. It never reloads on
 * its own: someone may be halfway through typing.
 */
export function useAppUpdate(): void {
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        if (isNewerBuild(await res.json(), __BUILD_ID__)) offerReload();
      } catch {
        // Offline, or a deploy from before version.json existed.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const first = window.setTimeout(check, FIRST_CHECK_MS);
    const every = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(every);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
