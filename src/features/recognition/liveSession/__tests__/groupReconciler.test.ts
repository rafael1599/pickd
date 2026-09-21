import { describe, it, expect } from 'vitest';
import {
  reconcileCandidate,
  normalizeSkuForCompare,
  type SessionItemLedger,
} from '../groupReconciler';
import type { ProposedBoxCandidate } from '../liveBarcodeScanner';

describe('groupReconciler', () => {
  const mockItems: SessionItemLedger[] = [
    {
      id: 'order-1-item-1',
      orderId: 'order-1',
      orderNumber: '881555',
      sku: '03-3989GY',
      name: 'Renegade S1 56cm',
      quantity: 2,
      verifiedQuantity: 0,
      isBike: true,
    },
    {
      id: 'order-2-item-1',
      orderId: 'order-2',
      orderNumber: '881635',
      sku: '03-3989GY',
      name: 'Renegade S1 56cm',
      quantity: 1,
      verifiedQuantity: 0,
      isBike: true,
    },
    {
      id: 'order-2-item-2',
      orderId: 'order-2',
      orderNumber: '881635',
      sku: '12-2501',
      name: 'Chainstay 10-pack',
      quantity: 10,
      verifiedQuantity: 0,
      isBike: false,
    },
  ];

  const createCandidate = (sku: string, serial?: string | null): ProposedBoxCandidate => ({
    sku,
    rawBarcode: sku,
    format: 'code_39',
    serial: serial || null,
    consecutiveFrames: 2,
    confidence: 0.9,
    firstDetectedAt: 1000,
    lastDetectedAt: 1050,
  });

  it('correctly normalizes SKUs for comparison', () => {
    expect(normalizeSkuForCompare('03-3989GY')).toBe('033989GY');
    expect(normalizeSkuForCompare('03-3989-GY')).toBe('033989GY');
    expect(normalizeSkuForCompare('  03 3989gy ')).toBe('033989GY');
  });

  it('matches Population A (valid bike in group) and attributes to first open order', () => {
    const candidate = createCandidate('03-3989GY', 'U226U03779');
    const result = reconcileCandidate(candidate, mockItems, new Set());

    expect(result.population).toBe('A');
    expect(result.targetOrderNumber).toBe('881555');
    expect(result.isDuplicateSerial).toBe(false);
    expect(result.isExcess).toBe(false);
  });

  it('identifies Population B (Alien Box) when SKU does not belong to the group', () => {
    const candidate = createCandidate('99-9999ZZ');
    const result = reconcileCandidate(candidate, mockItems, new Set());

    expect(result.population).toBe('B');
    expect(result.matchedItem).toBeNull();
    expect(result.targetOrderNumber).toBeNull();
    expect(result.statusMessage).toContain('ALERTA CAJA AJENA');
  });

  it('identifies Population C (Parts / Repuestos) when is_bike is false', () => {
    const candidate = createCandidate('12-2501');
    const result = reconcileCandidate(candidate, mockItems, new Set());

    expect(result.population).toBe('C');
    expect(result.targetOrderNumber).toBe('881635');
    expect(result.matchedItem?.isBike).toBe(false);
  });

  it('flags duplicate serial warning without blocking assignment', () => {
    const candidate = createCandidate('03-3989GY', 'U226U03779');
    const knownSerials = new Set(['U226U03779']);

    const result = reconcileCandidate(candidate, mockItems, knownSerials);

    expect(result.population).toBe('A');
    expect(result.isDuplicateSerial).toBe(true);
    expect(result.statusMessage).toContain('Posible duplicado: serial ya contado');
  });

  it('flags COMPLETED_IN_GROUP when all required units for this bike SKU are satisfied', () => {
    const fulfilledItems: SessionItemLedger[] = mockItems.map((item) =>
      item.sku === '03-3989GY' ? { ...item, verifiedQuantity: item.quantity } : item
    );

    const candidate = createCandidate('03-3989GY', 'U226U09999');
    const result = reconcileCandidate(candidate, fulfilledItems, new Set());

    expect(result.population).toBe('COMPLETED_IN_GROUP');
    expect(result.isExcess).toBe(true);
  });

  it('classifies candidate with no resolved SKU as UNIDENTIFIED, never Alien Box (B)', () => {
    const candidate: ProposedBoxCandidate = {
      sku: null,
      rawBarcode: '845436999999',
      format: 'upc_a',
      upc: '845436999999',
      serial: null,
      consecutiveFrames: 2,
      confidence: 0.8,
      firstDetectedAt: 1000,
      lastDetectedAt: 1050,
    };

    const result = reconcileCandidate(candidate, mockItems, new Set());

    expect(result.population).toBe('UNIDENTIFIED');
    expect(result.matchedItem).toBeNull();
    expect(result.targetOrderNumber).toBeNull();
    expect(result.statusMessage).toContain('SKU no identificado en catálogo');
  });

  it('classifies candidate with conflict as CONFLICT', () => {
    const candidate: ProposedBoxCandidate = {
      sku: null,
      rawBarcode: '845436088143',
      format: 'upc_a',
      upc: '845436088143',
      conflict: 'Conflicto entre canales: Barras/Catálogo (03-4005-MN) ≠ OCR (03-3845BL)',
      serial: null,
      consecutiveFrames: 2,
      confidence: 0.8,
      firstDetectedAt: 1000,
      lastDetectedAt: 1050,
    };

    const result = reconcileCandidate(candidate, mockItems, new Set());

    expect(result.population).toBe('CONFLICT');
    expect(result.matchedItem).toBeNull();
    expect(result.statusMessage).toContain('CONFLICTO DE IDENTIDAD');
  });
});
