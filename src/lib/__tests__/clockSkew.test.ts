import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { measureClockSkew, CLOCK_SKEW_WARN_MS } from '../clockSkew';

vi.mock('../supabase', () => ({
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key',
}));

/** A fetch that answers instantly with the given `Date` header. */
function respondingWith(date: string | null) {
  return vi.fn().mockResolvedValue({
    headers: { get: (h: string) => (h === 'date' && date ? date : null) },
  });
}

describe('measureClockSkew', () => {
  const DEVICE_NOW = Date.parse('2026-08-11T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(DEVICE_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports ~0 skew when the server agrees with the device', async () => {
    vi.stubGlobal('fetch', respondingWith('Tue, 11 Aug 2026 12:00:00 GMT'));
    const reading = await measureClockSkew();
    expect(reading).not.toBeNull();
    expect(Math.abs(reading!.skewMs)).toBeLessThan(1000);
    expect(reading!.significant).toBe(false);
  });

  it('flags a device clock running ahead as significant, with a negative skew', async () => {
    // Server says 12:00:00; the device believes it is 12:05:00.
    vi.setSystemTime(DEVICE_NOW + 5 * 60_000);
    vi.stubGlobal('fetch', respondingWith('Tue, 11 Aug 2026 12:00:00 GMT'));

    const reading = await measureClockSkew();
    expect(reading!.skewMs).toBeCloseTo(-5 * 60_000, -3);
    expect(reading!.significant).toBe(true);
  });

  it('flags a device clock running behind with a positive skew', async () => {
    vi.setSystemTime(DEVICE_NOW - 5 * 60_000);
    vi.stubGlobal('fetch', respondingWith('Tue, 11 Aug 2026 12:00:00 GMT'));

    const reading = await measureClockSkew();
    expect(reading!.skewMs).toBeCloseTo(5 * 60_000, -3);
    expect(reading!.significant).toBe(true);
  });

  it('does not flag drift below the tolerance', async () => {
    vi.setSystemTime(DEVICE_NOW + (CLOCK_SKEW_WARN_MS - 5_000));
    vi.stubGlobal('fetch', respondingWith('Tue, 11 Aug 2026 12:00:00 GMT'));

    const reading = await measureClockSkew();
    expect(reading!.significant).toBe(false);
  });

  it('returns null rather than a bogus reading when the Date header is missing', async () => {
    vi.stubGlobal('fetch', respondingWith(null));
    await expect(measureClockSkew()).resolves.toBeNull();
  });

  it('returns null rather than a bogus reading when the Date header is unparseable', async () => {
    vi.stubGlobal('fetch', respondingWith('not a date'));
    await expect(measureClockSkew()).resolves.toBeNull();
  });

  it('swallows a failed probe — being offline is not evidence of skew', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    await expect(measureClockSkew()).resolves.toBeNull();
  });

  it('sends the anon key and bypasses cache so a stale Date is not reused', async () => {
    const fetchMock = respondingWith('Tue, 11 Aug 2026 12:00:00 GMT');
    vi.stubGlobal('fetch', fetchMock);

    await measureClockSkew();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.supabase.co/auth/v1/health');
    expect(init.headers).toEqual({ apikey: 'anon-key' });
    expect(init.cache).toBe('no-store');
  });
});
