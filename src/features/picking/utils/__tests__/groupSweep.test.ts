import { describe, expect, it } from 'vitest';
import { openableGroupMemberId, partitionGroupSweep, type GroupMemberRow } from '../groupSweep';

const row = (
  id: string,
  status: string,
  group_id: string | null = 'G',
  items: unknown[] = [{ sku: 'X', pickingQty: 1 }]
): GroupMemberRow => ({ id, status, group_id, items, order_number: id });

describe('openableGroupMemberId', () => {
  it('leaves a solo order alone', () => {
    expect(openableGroupMemberId('a', null, [row('a', 'completed', null)])).toBe('a');
  });

  it('keeps the card id when the card is already an openable member', () => {
    const members = [row('open', 'ready_to_double_check'), row('done', 'completed')];
    expect(openableGroupMemberId('open', 'G', members)).toBe('open');
  });

  // The 9 sep 2026 shape: #881394 completed, #881436 still open, one 'general'
  // group, and mergeGroupOrders anchored the card on the completed half.
  it('redirects a completed anchor to the member still being worked', () => {
    const members = [row('881394', 'completed'), row('881436', 'ready_to_double_check')];
    expect(openableGroupMemberId('881394', 'G', members)).toBe('881436');
  });

  it('redirects a cancelled anchor too', () => {
    const members = [row('x', 'cancelled'), row('y', 'double_checking')];
    expect(openableGroupMemberId('x', 'G', members)).toBe('y');
  });

  it('treats a reopened member as openable — that is the Add-On source', () => {
    const members = [row('done', 'completed'), row('back', 'reopened')];
    expect(openableGroupMemberId('done', 'G', members)).toBe('back');
  });

  it('falls back to the card id when the whole group is finished', () => {
    const members = [row('a', 'completed'), row('b', 'completed')];
    expect(openableGroupMemberId('a', 'G', members)).toBe('a');
  });

  it('ignores members of other groups', () => {
    const members = [row('a', 'completed', 'G'), row('other', 'active', 'H')];
    expect(openableGroupMemberId('a', 'G', members)).toBe('a');
  });

  it('does not trust the aggregate status stamped on the card', () => {
    // The board hands the card a `ready_to_double_check` status while its row
    // is completed; only the raw rows passed in decide.
    const members = [row('done', 'completed'), row('open', 'ready_to_double_check')];
    expect(openableGroupMemberId('done', 'G', members)).toBe('open');
  });
});

describe('partitionGroupSweep', () => {
  it('sweeps everything when nothing was tagged (a solo order)', () => {
    const rows = [row('a', 'ready_to_double_check')];
    const { siblings, gatecrashers } = partitionGroupSweep(rows, new Set());
    expect(siblings).toHaveLength(1);
    expect(gatecrashers).toHaveLength(0);
  });

  it('completes the siblings the verifier had loaded', () => {
    const rows = [row('a', 'ready_to_double_check'), row('b', 'double_checking')];
    const { siblings, gatecrashers } = partitionGroupSweep(rows, new Set(['a', 'b', 'anchor']));
    expect(siblings.map((s) => s.id)).toEqual(['a', 'b']);
    expect(gatecrashers).toHaveLength(0);
  });

  // #881394 joined the FedEx group five seconds before the completion and rode
  // out on it with zero lines verified. It must not be completed.
  it('holds back an order that joined the group after the cart was loaded', () => {
    const rows = [row('881385', 'double_checking'), row('881394', 'ready_to_double_check')];
    const { siblings, gatecrashers } = partitionGroupSweep(rows, new Set(['881385', '881421']));
    expect(siblings.map((s) => s.id)).toEqual(['881385']);
    expect(gatecrashers.map((s) => s.id)).toEqual(['881394']);
  });

  it('lets an empty row ride along — it has nothing to deduct', () => {
    const rows = [row('empty', 'ready_to_double_check', 'G', [])];
    const { siblings, gatecrashers } = partitionGroupSweep(rows, new Set(['anchor']));
    expect(siblings.map((s) => s.id)).toEqual(['empty']);
    expect(gatecrashers).toHaveLength(0);
  });

  it('lets a row with a non-array items field ride along', () => {
    const rows = [{ id: 'weird', status: 'active', group_id: 'G', items: null }];
    const { siblings, gatecrashers } = partitionGroupSweep(rows, new Set(['anchor']));
    expect(siblings.map((s) => s.id)).toEqual(['weird']);
    expect(gatecrashers).toHaveLength(0);
  });
});
