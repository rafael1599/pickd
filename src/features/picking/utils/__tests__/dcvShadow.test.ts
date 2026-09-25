import { describe, expect, it } from 'vitest';
import {
  SHADOW_FLAG_OFF,
  decideSampled,
  describeDevice,
  groupLinesSnapshot,
  parseShadowFlag,
  shadowRunsFor,
  skuChannel,
  toShadowBoxes,
} from '../dcvShadow';
import type { MultiBoxClientResult } from '../../../../lib/recognition/recognizeMultiBoxClient';

describe('parseShadowFlag', () => {
  it('is off for a missing, disabled or malformed row', () => {
    expect(parseShadowFlag(null)).toEqual(SHADOW_FLAG_OFF);
    expect(parseShadowFlag({ enabled: false, config: { sample_rate: 1 } })).toEqual(
      SHADOW_FLAG_OFF
    );
    expect(parseShadowFlag({ enabled: 'true', config: {} })).toEqual(SHADOW_FLAG_OFF);
  });

  it('reads the config and clamps it', () => {
    expect(
      parseShadowFlag({
        enabled: true,
        config: { sample_rate: 3, timeout_ms: 10, queue_max: 99, upload_r2000: false },
      })
    ).toEqual({
      enabled: true,
      sampleRate: 1,
      timeoutMs: 5000,
      queueMax: 10,
      uploadR2000: false,
      onlyUsers: null,
    });
    expect(parseShadowFlag({ enabled: true, config: null })).toMatchObject({
      enabled: true,
      sampleRate: 0,
      timeoutMs: 60_000,
      queueMax: 3,
      uploadR2000: true,
    });
  });
});

describe('shadowRunsFor', () => {
  it('runs for everyone without only_users, and only for the listed ones with it', () => {
    const on = parseShadowFlag({ enabled: true, config: {} });
    expect(shadowRunsFor(on, 'u1')).toBe(true);
    const one = parseShadowFlag({ enabled: true, config: { only_users: ['u1', 7] } });
    expect(one.onlyUsers).toEqual(['u1']);
    expect(shadowRunsFor(one, 'u1')).toBe(true);
    expect(shadowRunsFor(one, 'u2')).toBe(false);
    expect(shadowRunsFor(one, null)).toBe(false);
  });

  it('an empty list is nobody, and off is off', () => {
    expect(
      shadowRunsFor(parseShadowFlag({ enabled: true, config: { only_users: [] } }), 'u1')
    ).toBe(false);
    expect(shadowRunsFor(SHADOW_FLAG_OFF, 'u1')).toBe(false);
  });
});

describe('decideSampled', () => {
  it('draws per call against the rate', () => {
    expect(decideSampled(0.25, () => 0.1)).toBe(true);
    expect(decideSampled(0.25, () => 0.25)).toBe(false);
    expect(decideSampled(0, () => 0)).toBe(false);
  });
});

describe('skuChannel', () => {
  it('names the channel from the provenance string', () => {
    expect(skuChannel('ocr:pp-ocrv6')).toBe('ocr');
    expect(skuChannel('barcode:Code39')).toBe('barcode');
    expect(skuChannel('factory_qr:QRCode')).toBe('qr');
    expect(skuChannel('ninguno')).toBe('none');
  });
});

const box = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    bbox: { x: 100, y: 200, width: 300, height: 50 },
    sku: {
      photoValue: '03-3768BL',
      catalogValue: null,
      source: 'ocr:pp-ocrv6',
      status: 'photo_only',
    },
    model: { photoValue: 'CODA S2', catalogValue: null, source: 'ocr', status: 'photo_only' },
    size: { photoValue: null, catalogValue: null, source: 'ninguno', status: 'unresolved' },
    color: { photoValue: null, catalogValue: null, source: 'ninguno', status: 'unresolved' },
    upc: { value: null, source: 'ninguno' },
    gtin: { value: '00012345678905', source: 'ocr' },
    barcodeCount: 1,
    rawCluster: {
      items: [
        { text: 'FEDEX CUSTOMER NAME', confidence: 0.9 },
        { text: '03-3768BL', confidence: 0.8 },
      ],
    },
    ...over,
  }) as never;

describe('toShadowBoxes', () => {
  it('keeps label fields, never the raw OCR text', () => {
    const result = {
      image: { width: 3840, height: 2160, rotationUsed: 0 },
      boxes: [box()],
    } as unknown as MultiBoxClientResult;
    const [b] = toShadowBoxes(result);
    expect(b).toEqual({
      sku: '03-3768BL',
      source: 'ocr:pp-ocrv6',
      channel: 'ocr',
      confidence: 0.85,
      bbox: { x: 100, y: 200, w: 300, h: 50 },
      model: 'CODA S2',
      size: null,
      color: null,
      upc: null,
      gtin: '00012345678905',
      barcodes: 1,
    });
    expect(JSON.stringify(b)).not.toContain('FEDEX CUSTOMER');
  });

  it('maps a rotated read back to the photo frame', () => {
    const result = {
      image: { width: 1000, height: 800, rotationUsed: 90 },
      boxes: [box({ bbox: { x: 10, y: 20, width: 30, height: 40 } })],
    } as unknown as MultiBoxClientResult;
    // rotation 90: x ← y, y ← H − (x + w)
    expect(toShadowBoxes(result)[0].bbox).toEqual({ x: 20, y: 760, w: 40, h: 30 });
  });

  it('has no bbox when the photo did not report its size', () => {
    const result = { image: {}, boxes: [box()] } as unknown as MultiBoxClientResult;
    expect(toShadowBoxes(result)[0].bbox).toBeNull();
  });
});

describe('groupLinesSnapshot', () => {
  it('sums by order and SKU, and falls back to the open order', () => {
    expect(
      groupLinesSnapshot(
        [
          { sku: '03-3768BL', pickingQty: 2, source_list_id: 'a' },
          { sku: '03-3768BL', pickingQty: 3, source_list_id: 'a' },
          { sku: '03-3768BL', pickingQty: 1, source_list_id: 'b' },
          { sku: '01-0288', pickingQty: 1 },
        ],
        'open'
      )
    ).toEqual([
      { list_id: 'a', sku: '03-3768BL', qty: 5 },
      { list_id: 'b', sku: '03-3768BL', qty: 1 },
      { list_id: 'open', sku: '01-0288', qty: 1 },
    ]);
  });
});

describe('describeDevice', () => {
  it('prefers the client-hints model', async () => {
    const d = await describeDevice({
      userAgent: 'Mozilla/5.0 (Linux; Android 10; K)',
      hardwareConcurrency: 8,
      deviceMemory: 8,
      userAgentData: {
        platform: 'Android',
        getHighEntropyValues: async () => ({ model: 'SM-S938U', platform: 'Android' }),
      },
    });
    expect(d).toMatchObject({ label: 'SM-S938U', memory_gb: 8, cores: 8 });
  });

  it('falls back to the UA without hints', async () => {
    const d = await describeDevice({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });
    expect(d).toMatchObject({ label: 'iPhone', memory_gb: null, cores: null });
  });
});
