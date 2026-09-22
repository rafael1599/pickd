import { useEffect, useSyncExternalStore } from 'react';

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

let newBuildLive = false;
const listeners = new Set<() => void>();

/**
 * Said once and never taken back: a page cannot stop being the old one without
 * reloading, so a build that is newer still changes nothing about what the
 * indicator is already saying.
 */
export function markNewBuild(): void {
  if (newBuildLive) return;
  newBuildLive = true;
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** True once the server is serving a build other than the one running here. */
export function useNewBuildAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => newBuildLive,
    () => false
  );
}

/**
 * Tells an open page that a newer build is live. A phone on the floor keeps
 * PickD open for hours and runs whatever it loaded in the morning — on 11 Sep a
 * fix went live at 16:15 and a phone kept dropping ticks at 16:17 because it
 * still ran the old build. The check reads `version.json` (emitted by
 * vite.config.ts) a minute after loading, every five minutes, and whenever the
 * page comes back to the screen.
 *
 * **It says so in the status pill, not in a toast** (Rafael, 22 Sep 2026: "no
 * quiero que vuelva a aparecer, en vez de eso hacer amarillo ámbar el
 * chequecito de status"). A toast that never expires sits on top of the work it
 * means to improve, and it lands while someone is counting. The pill is already
 * in the header and already answers "how are things right now": amber instead
 * of green says the same thing without taking the screen, and the reload is a
 * tap given between two things. It still never reloads on its own — someone may
 * be halfway through typing.
 */
export function useAppUpdate(): void {
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let stopped = false;
    const check = async () => {
      // Once it is known, there is nothing left to learn: stop asking.
      if (stopped || newBuildLive || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        if (isNewerBuild(await res.json(), __BUILD_ID__)) markNewBuild();
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
