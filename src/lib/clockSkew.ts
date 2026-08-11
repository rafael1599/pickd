/**
 * Device-vs-server clock skew probe.
 *
 * Diagnostic only — nothing branches on the result. It exists because the
 * whole "logged out but the app doesn't know it" failure mode has two
 * candidate triggers and they need different fixes, and only one of them
 * leaves a trace we can read from the client:
 *
 *   - **Clock skew.** supabase-js decides "has my token expired?" by
 *     comparing `expires_at` to `Date.now()`. If a warehouse tablet's clock
 *     runs minutes ahead of the auth server, the client is convinced a token
 *     the server rejects is still fine — it never refreshes, and every
 *     request 401s while the UI insists everything is normal.
 *   - A refresh that failed and left a consumed refresh token behind.
 *
 * A warn in the console at boot is enough to tell them apart the next time
 * this happens on a real device. Threshold is deliberately loose: gotrue's
 * own expiry margin is ~10s, so anything under 30s can't be what's killing
 * a 1-hour token.
 */

import { supabaseUrl, supabaseAnonKey } from './supabase';

/** Skew past which the device clock can plausibly break token expiry logic. */
export const CLOCK_SKEW_WARN_MS = 30_000;

export interface ClockSkewReading {
  /** serverTime - deviceTime, in ms. Positive = device clock is behind. */
  skewMs: number;
  /** Round-trip time of the probe — the uncertainty on `skewMs`. */
  rttMs: number;
  significant: boolean;
}

/**
 * Probe the auth server's clock via the `Date` response header.
 *
 * Uses GoTrue's unauthenticated `/health` endpoint so this works before (and
 * regardless of) a valid session, and reads only the header — the body is
 * irrelevant. The server stamps `Date` when it responds, so the honest
 * comparison point is the midpoint of the round trip, not the moment we
 * started. RTT is returned alongside so a reading taken over bad wifi can be
 * discounted rather than trusted blindly.
 *
 * Returns `null` when the probe can't be completed (offline, CORS, no `Date`
 * header) — absence of a reading is never treated as absence of skew.
 */
export async function measureClockSkew(signal?: AbortSignal): Promise<ClockSkewReading | null> {
  try {
    const started = Date.now();
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      method: 'GET',
      headers: { apikey: supabaseAnonKey },
      cache: 'no-store',
      signal,
    });
    const finished = Date.now();

    const serverDate = response.headers.get('date');
    if (!serverDate) return null;

    const serverTime = new Date(serverDate).getTime();
    if (Number.isNaN(serverTime)) return null;

    // The response was stamped somewhere inside the round trip; its midpoint
    // is the least-wrong estimate of "what the device clock read at that
    // instant". `Date` has 1s resolution, so sub-second precision is noise.
    const deviceTimeAtResponse = (started + finished) / 2;
    const skewMs = serverTime - deviceTimeAtResponse;
    const rttMs = finished - started;

    return { skewMs, rttMs, significant: Math.abs(skewMs) > CLOCK_SKEW_WARN_MS };
  } catch {
    return null;
  }
}

/**
 * Run the probe and warn loudly if the device clock is far enough off to
 * break session expiry. Fire-and-forget; never throws.
 */
export async function reportClockSkew(signal?: AbortSignal): Promise<void> {
  const reading = await measureClockSkew(signal);
  if (!reading) return;

  const seconds = Math.round(reading.skewMs / 1000);
  if (reading.significant) {
    console.warn(
      `[ClockSkew] Device clock is ${Math.abs(seconds)}s ${seconds > 0 ? 'BEHIND' : 'AHEAD OF'} the auth server ` +
        `(rtt ${reading.rttMs}ms). This can make the session expire without the client noticing — ` +
        `enable automatic date & time on this device.`
    );
  } else {
    console.debug(`[ClockSkew] ${seconds}s (rtt ${reading.rttMs}ms) — within tolerance.`);
  }
}
