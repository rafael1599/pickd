import { describe, it, expect } from 'vitest';
import {
  initSessionFromOrders,
  setCandidateProposal,
  confirmActiveBox,
  undoLastConfirmation,
} from '../liveSessionState';
import { batchConfirmPartsCarton } from '../partsBatchHandler';
import type { ProposedBoxCandidate } from '../liveBarcodeScanner';

describe('liveSessionState', () => {
  const rawOrders = [
    {
      id: 'order-881555',
      order_number: '881555',
      status: 'ready_to_double_check',
      items: [
        {
          sku: '03-3989GY',
          qty: 2,
          name: 'Renegade S1 56cm',
          sku_metadata: { is_bike: true, weight_lbs: 30 },
        },
      ],
    },
    {
      id: 'order-881635',
      order_number: '881635',
      status: 'ready_to_double_check',
      items: [
        {
          sku: '03-3989GY',
          qty: 1,
          name: 'Renegade S1 56cm',
          sku_metadata: { is_bike: true, weight_lbs: 30 },
        },
        {
          sku: '12-2501',
          qty: 10,
          name: 'Chainstay 10-pack',
          sku_metadata: { is_bike: false, weight_lbs: 5 },
        },
      ],
    },
  ];

  const candidateA: ProposedBoxCandidate = {
    sku: '03-3989GY',
    rawBarcode: '03-3989GY',
    format: 'code_39',
    serial: 'U226U03779',
    consecutiveFrames: 2,
    confidence: 0.9,
    firstDetectedAt: 1000,
    lastDetectedAt: 1050,
  };

  it('initializes session correctly with multiple orders in group', () => {
    const state = initSessionFromOrders(rawOrders, 'group-xyz');

    expect(state.status).toBe('ready');
    expect(state.orders).toHaveLength(2);
    expect(state.items).toHaveLength(3);
    expect(state.stats.totalBikesRequired).toBe(3); // 2 + 1
    expect(state.stats.totalPartsRequired).toBe(10);
    expect(state.stats.totalBikesConfirmed).toBe(0);
    expect(state.stats.progressPercent).toBe(0);
  });

  it('proposes candidate and confirms box with single tap (Un toque = una caja)', () => {
    let state = initSessionFromOrders(rawOrders, 'group-xyz');

    state = setCandidateProposal(state, candidateA);
    expect(state.status).toBe('active');
    expect(state.activeProposal?.population).toBe('A');
    expect(state.activeProposal?.targetOrderNumber).toBe('881555');

    // Operator confirms box
    const { state: confirmedState, confirmedBox } = confirmActiveBox(state);

    expect(confirmedBox).not.toBeNull();
    expect(confirmedBox?.sku).toBe('03-3989GY');
    expect(confirmedBox?.serial).toBe('U226U03779');
    expect(confirmedBox?.targetOrderNumber).toBe('881555');

    expect(confirmedState.confirmedBoxes).toHaveLength(1);
    expect(confirmedState.knownSerials).toContain('U226U03779');
    expect(confirmedState.activeProposal).toBeNull();
    expect(confirmedState.stats.totalBikesConfirmed).toBe(1);

    // Verify item 1 in order 881555 has verifiedQuantity = 1
    const order1Item = confirmedState.items.find((i) => i.orderId === 'order-881555');
    expect(order1Item?.verifiedQuantity).toBe(1);
  });

  it('warns on duplicate serial on second scan of same serial', () => {
    let state = initSessionFromOrders(rawOrders, 'group-xyz');
    // Confirm first box
    state = setCandidateProposal(state, candidateA);
    state = confirmActiveBox(state).state;

    // Scan same serial again
    state = setCandidateProposal(state, candidateA);
    expect(state.activeProposal?.isDuplicateSerial).toBe(true);
  });

  it('handles undoLastConfirmation accurately reverting ledger and serials', () => {
    let state = initSessionFromOrders(rawOrders, 'group-xyz');
    state = setCandidateProposal(state, candidateA);
    state = confirmActiveBox(state).state;

    expect(state.confirmedBoxes).toHaveLength(1);
    expect(state.stats.totalBikesConfirmed).toBe(1);

    // Undo
    state = undoLastConfirmation(state);

    expect(state.confirmedBoxes).toHaveLength(0);
    expect(state.knownSerials).not.toContain('U226U03779');
    expect(state.stats.totalBikesConfirmed).toBe(0);
    const order1Item = state.items.find((i) => i.orderId === 'order-881555');
    expect(order1Item?.verifiedQuantity).toBe(0);
  });

  it('batch confirms multi-item parts carton with single action (Population C)', () => {
    const state = initSessionFromOrders(rawOrders, 'group-xyz');

    // Batch confirm 10 chainstays in 1 gesture
    const {
      state: batchState,
      confirmedBox,
      confirmedCount,
    } = batchConfirmPartsCarton(state, '12-2501');

    expect(confirmedBox).not.toBeNull();
    expect(confirmedCount).toBe(10);
    expect(batchState.stats.totalPartsConfirmed).toBe(10);

    const partItem = batchState.items.find((i) => i.sku === '12-2501');
    expect(partItem?.verifiedQuantity).toBe(10);
  });
});
