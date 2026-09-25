/**
 * La sombra nunca toca el hilo principal y nunca rechaza: cada desenlace es un
 * estado que se anota. Worker falso, relojes falsos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setBackgroundReaderForTests,
  readPalletInBackground,
  type WorkerLike,
} from '../readPalletInBackground';

class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: { id: number; file: File; reduceTo?: number }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(m: unknown) {
    this.posted.push(m as { id: number; file: File });
  }
  terminate() {
    this.terminated = true;
  }
  answer(data: Record<string, unknown>) {
    const last = this.posted[this.posted.length - 1];
    this.onmessage?.({ data: { id: last.id, ...data } } as MessageEvent);
  }
}

const file = () => new File(['x'], 'p.jpg', { type: 'image/jpeg' });
const opts = { timeoutMs: 1000, queueMax: 2 };
const fakeResult = { boxes: [], totalBoxes: 0 } as never;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.all = [];
  __setBackgroundReaderForTests({ createWorker: () => new FakeWorker(), supports: () => true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('readPalletInBackground', () => {
  it('answers unsupported without starting anything when the device cannot', async () => {
    __setBackgroundReaderForTests({ supports: () => false });
    const out = await readPalletInBackground(file(), opts);
    expect(out.status).toBe('unsupported');
    expect(FakeWorker.all).toHaveLength(0);
    __setBackgroundReaderForTests({ supports: () => true });
  });

  it('returns ok with the result and the reduced copy', async () => {
    const p = readPalletInBackground(file(), { ...opts, reduceTo: 2000 });
    const w = FakeWorker.all[0];
    expect(w.posted[0].reduceTo).toBe(2000);
    const reduced = new Blob(['r']);
    w.answer({ success: true, result: fakeResult, reduced });
    const out = await p;
    expect(out.status).toBe('ok');
    if (out.status === 'ok') expect(out.reduced).toBe(reduced);
  });

  it('turns a worker failure into error, not a rejection, and does not retry', async () => {
    const p = readPalletInBackground(file(), opts);
    FakeWorker.all[0].answer({ success: false, error: 'boom' });
    await expect(p).resolves.toMatchObject({ status: 'error', error: 'boom' });
    expect(FakeWorker.all[0].posted).toHaveLength(1);
  });

  it('kills a hung worker on timeout and starts a fresh one for the next photo', async () => {
    const p1 = readPalletInBackground(file(), opts);
    const p2 = readPalletInBackground(file(), opts);
    vi.advanceTimersByTime(1000);
    await expect(p1).resolves.toMatchObject({ status: 'timeout' });
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1].answer({ success: true, result: fakeResult });
    await expect(p2).resolves.toMatchObject({ status: 'ok' });
  });

  it('a crashing worker is error and is never reused', async () => {
    const p = readPalletInBackground(file(), opts);
    FakeWorker.all[0].onerror?.({ message: 'OOM' } as ErrorEvent);
    await expect(p).resolves.toMatchObject({ status: 'error', error: 'OOM' });
    expect(FakeWorker.all[0].terminated).toBe(true);
    const p2 = readPalletInBackground(file(), opts);
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1].answer({ success: true, result: fakeResult });
    await expect(p2).resolves.toMatchObject({ status: 'ok' });
  });

  it('reads one at a time and drops beyond queueMax waiting', async () => {
    const p1 = readPalletInBackground(file(), opts); // reading
    const p2 = readPalletInBackground(file(), opts); // waiting 1
    const p3 = readPalletInBackground(file(), opts); // waiting 2
    const p4 = readPalletInBackground(file(), opts); // over queueMax
    await expect(p4).resolves.toMatchObject({ status: 'dropped' });
    const w = FakeWorker.all[0];
    expect(w.posted).toHaveLength(1);
    w.answer({ success: true, result: fakeResult });
    await p1;
    expect(w.posted).toHaveLength(2);
    w.answer({ success: true, result: fakeResult });
    await p2;
    w.answer({ success: true, result: fakeResult });
    await expect(p3).resolves.toMatchObject({ status: 'ok' });
  });

  it('terminates the worker after 60 s idle', async () => {
    const p = readPalletInBackground(file(), opts);
    FakeWorker.all[0].answer({ success: true, result: fakeResult });
    await p;
    expect(FakeWorker.all[0].terminated).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(FakeWorker.all[0].terminated).toBe(true);
  });
});
