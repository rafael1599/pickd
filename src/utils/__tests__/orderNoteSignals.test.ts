import { describe, expect, it } from 'vitest';
import {
  blockingLines,
  blockingReason,
  latestNoteEntries,
  noteLabel,
  noteTone,
  orderNoteEntries,
  readOrderNote,
  stripPickdAppendages,
} from '../orderNoteSignals';

/**
 * The case table. Every string is a real note from prod (AS400 Order Comments or
 * typed on an order), Jun–Sep 2026, unless marked. The SQL mirror that comes with
 * the hold column has to agree with every row.
 */
const TONES: Array<[string, ReturnType<typeof noteTone>]> = [
  // PICK UP
  ['DO NOT SHIP DEALER PICK UP', 'pickup'],
  ['DO NOT SHIP HAMISH DROP OFF', 'pickup'],
  ['CUST PICKUP TODAY', 'pickup'],
  ['DO NOT SHIP. HP TO PICKUPTUES 7/21', 'pickup'],
  ['DO NOT SHIP HAMISH PIKCUP', 'pickup'],
  ['SAMPLE BIKE - PICKUP AND FLASH FIRMWARE', 'pickup'],
  ['DO NOT SHIP. JOSE TO PICKUP AND PROVIDE CHECK', 'pickup'],
  ['HOLD FOR ADDS PICK-UP ORDER', 'pickup'], // #881400: a pickup AND a hold
  // HOLD
  ['HOLD FOR ADDS', 'hold'],
  ['HOLD FOR CONFIRM', 'hold'],
  ['HOLD', 'hold'],
  ['DO NOT SHIP. HOLD FOR ADD', 'hold'],
  ['ORDER HOLD PENDING PAYMENT', 'hold'],
  ['PLEASE HOLD FOR PREORDER ADDS', 'hold'],
  ['PLEASE BUILD AND HOLD FORMICHELE THX', 'hold'],
  ['SHIP WITH REN', 'hold'],
  ['SHIP W/CITIZEN 2 S/T', 'hold'],
  ['WAITING FOR ADDS', 'hold'],
  ['Hold for missing bike', 'hold'],
  // SHIP WITH (another order)
  ['SHIP W/ 881424', 'ship_with'],
  ['SHIP WITH 881418', 'ship_with'],
  ['SHIP WPS#881210 FF', 'ship_with'],
  ['SHIP W/880108 & 880110 FF', 'ship_with'],
  ['SHIP WITH ORDER 457414', 'ship_with'],
  ['W/ 880173', 'ship_with'],
  ['ADDS FOR 880936', 'ship_with'],
  ['FF 10+ PROMO SHIP W/PS#880644', 'ship_with'],
  ['NET 30 SHIP WITH PARTS ORDER', 'ship_with'],
  // DELIVERY
  ['FF N60 CLOSED MONDAY NO DELIVERIES', 'delivery'],
  ['DELIVER FRIDAY CALL 30MIN BEFORE DELIVER', 'delivery'],
  ['FREIGHT 13.05 PLEASE SHIP USPS', 'delivery'],
  ['MONDAY, 8/10/26 BETWEEN 11AM & 12PM', 'delivery'],
  ['SHIP TO FRANKLIN', 'delivery'],
  // NOTE
  ['JAMES TO ASSEMBLE', 'note'],
  ['PO# 4501236083', 'note'],
  ['OKAY TO SHIP', 'note'],
  ['WARRANTY N/C', 'note'],
  ['PAYMENT VIA CC REQUESTED', 'note'],
  ['Hamish picked it up', 'note'],
  ['this order is not a pick up, wrong notes were inputed here.', 'note'], // #881353
  // Billing only: nothing for the floor
  ['FREE FREIGHT', null],
  ['FF NET60', null],
  ['NET 60 - FREE FREIGHT', null],
  ['FREIGHT $65.00', null],
  ['FREIGH $75.00', null],
  ['REIGHT $65.00', null],
  ['FF N30 W/FLA', null],
  ['ACH', null],
  ['FF PARTS OVER $100', null],
  ['FF 10 BIKE BACKYARD', null],
  ['EP PURCHASE', null],
  // Empty, or only what PickD appended
  ['User Cancelled', null],
  ['', null],
];

/**
 * The hold label, row for row the table that validates `order_note_hold` in
 * supabase/migrations/20260911161528_door_keeps_holds.sql. Change both or neither.
 */
const HOLD_CASES: Array<[string, string | null]> = [
  ['HOLD FOR ADDS', 'ADDS'],
  ['HOLD FOR ADDS MONDAY', 'ADDS'],
  ['DO NOT SHIP. HOLD FOR ADD', 'ADDS'],
  ['PLEASE HOLD FOR PREORDER ADDS', 'ADDS'],
  ['WAITING FOR ADDS', 'ADDS'],
  ['HOLD FOR ADDS PICK-UP ORDER', 'ADDS'],
  ['HOLD FOR ADDS [User Cancelled]', 'ADDS'],
  ['SHIP WITH REN', 'REN'],
  ['SHIP WITH REN PO# JAM61A', 'REN'],
  ['Ship with Renegades', 'REN'],
  ['HOLD FOR CONFIRM', 'CONF'],
  ['HOLD FOR CONFIRMATION', 'CONF'],
  ['ORDER HOLD PENDING PAYMENT', 'PAY'],
  ['EP 20% OFF HOLD FOR CC INFO', 'PAY'],
  ['HOLD WITH CITIZEN 2 STS', 'CITIZEN'],
  ['HOLD FOR CITIZEN 2 S/T', 'CITIZEN'],
  ['SHIP W/CITIZEN 2 S/T', 'CITIZEN'],
  ['SHIP W/ HUDSON E1 HOLD', 'HUDSON'],
  ['SHIP W/LASERS', 'LASER'],
  ['SAMPLE BIKES ----SHIP WITH VENTURA!', 'VENTURA'],
  ['SHIP W/ ALL ACCESS BIKE', 'ALL ACCESS'],
  ['HOLD FOR DIVIDES', 'DIVIDES'],
  ['HOLD TO SHIP WITH ALLOCATIONS', 'HOLD'],
  ['HOLD', 'HOLD'],
  ['PLEASE BUILD AND HOLD FORMICHELE THX', 'HOLD'],
  ['Hold for missing bike', 'HOLD'],
  ['DO NOT SHIP BEFORE 8/25', 'HOLD'],
  ['DO NOT SHIP DEALER PICK UP', null],
  ['DO NOT SHIP HAMISH DROP OFF', null],
  ['SHIP W/ 881424', null],
  ['SHIP WITH 881418', null],
  ['SHIP W/ 881416,881348', null],
  ['SHIP WITH ORDER 457414', null],
  ['NET 30 SHIP WITH PARTS ORDER', null],
  ['OKAY TO SHIP', null],
  ['FREE FREIGHT', null],
  ['CLOSED MONDAYS', null],
  ['this order is not a pick up, wrong notes were inputed here.', null],
  ['User Cancelled', null],
  ['', null],
];

describe('hold — the table the SQL mirror is validated against', () => {
  it.each(HOLD_CASES)('%s → %s', (note, hold) => {
    expect(readOrderNote(note).hold).toBe(hold);
  });
});

describe('noteTone — the case table', () => {
  it.each(TONES)('%s → %s', (note, tone) => {
    expect(noteTone(readOrderNote(note))).toBe(tone);
  });
});

describe('readOrderNote', () => {
  it('reads a pickup that is also a hold as both (#881400)', () => {
    const s = readOrderNote('HOLD FOR ADDS PICK-UP ORDER');
    expect(s.pickup).toBe(true);
    expect(s.hold).toBe('ADDS');
  });

  it('does not call "DO NOT SHIP" on a pickup a hold', () => {
    expect(readOrderNote('DO NOT SHIP DEALER PICK UP').hold).toBeNull();
  });

  it('labels a hold by what it waits for', () => {
    expect(readOrderNote('HOLD FOR ADDS MONDAY').hold).toBe('ADDS');
    expect(readOrderNote('HOLD FOR CONFIRMATION').hold).toBe('CONF');
    expect(readOrderNote('EP 20% OFF HOLD FOR CC INFO').hold).toBe('PAY');
    expect(readOrderNote('SHIP WITH REN PO# JAM61A').hold).toBe('REN');
    expect(readOrderNote('HOLD WITH CITIZEN 2 STS').hold).toBe('CITIZEN');
    expect(readOrderNote('HOLD FOR CITIZEN 2 S/T').hold).toBe('CITIZEN');
    expect(readOrderNote('SHIP W/ HUDSON E1 HOLD').hold).toBe('HUDSON');
    expect(readOrderNote('HOLD FOR DIVIDES').hold).toBe('DIVIDES');
    expect(readOrderNote('HOLD TO SHIP WITH ALLOCATIONS').hold).toBe('HOLD');
  });

  it('takes a model after SHIP WITH as a hold, an order number as a partner', () => {
    expect(readOrderNote('SHIP WITH REN')).toMatchObject({ hold: 'REN', shipWith: [] });
    expect(readOrderNote('SHIP W/ 881424')).toMatchObject({ hold: null, shipWith: ['881424'] });
    // The first build read the ITH of WITH as a model: HOLD · ITH.
    expect(readOrderNote('SHIP WITH 881418')).toMatchObject({ hold: null, shipWith: ['881418'] });
  });

  it('collects every partner a note names, once', () => {
    expect(readOrderNote('SHIP W/ 881416,881348').shipWith).toEqual(['881416', '881348']);
    expect(readOrderNote('SHIP W/ 880751 & 880750').shipWith).toEqual(['880751', '880750']);
    expect(readOrderNote('HP TO PICKUP 7/28 WITH #880914').shipWith).toEqual(['880914']);
    expect(readOrderNote('DO NOT SHIP DEALER PICK UP W/PS#880423').shipWith).toEqual(['880423']);
    expect(readOrderNote('ADD TO 880984 AND SHIP FF').shipWith).toEqual(['880984']);
  });

  it('does not read an order number that is only a reference as a partner', () => {
    expect(readOrderNote('REPLACMENT PARTS FOR ORDER 880462').shipWith).toEqual([]);
    expect(readOrderNote('MIS-SHIP 881159').shipWith).toEqual([]);
    expect(readOrderNote('PO# 4501236086').shipWith).toEqual([]);
  });
});

describe('stripPickdAppendages', () => {
  it('removes what PickD wrote into the AS400 note, and nothing else', () => {
    expect(
      stripPickdAppendages(
        'ADD ON TO HUDSON E1 PRE-ORDER [System: Auto-cancelled due to 24h verification timeout] [Completed manually — photos copied from 880649]'
      )
    ).toBe('ADD ON TO HUDSON E1 PRE-ORDER');
    expect(stripPickdAppendages('HOLD FOR ADDS [User Cancelled]')).toBe('HOLD FOR ADDS');
    expect(stripPickdAppendages('User Cancelled')).toBe('');
    expect(stripPickdAppendages('  SHIP W/  881424 ')).toBe('SHIP W/ 881424');
  });
});

describe('noteLabel', () => {
  it('says it in one or two words', () => {
    expect(noteLabel(readOrderNote('DO NOT SHIP DEALER PICK UP'))).toBe('PICK UP');
    expect(noteLabel(readOrderNote('HOLD FOR ADDS'))).toBe('HOLD · ADDS');
    expect(noteLabel(readOrderNote('HOLD'))).toBe('HOLD');
    expect(noteLabel(readOrderNote('SHIP W/ 881424'))).toBe('SHIP W/ 881424');
    expect(noteLabel(readOrderNote('NET 30 SHIP WITH PARTS ORDER'))).toBe('SHIP WITH');
    expect(noteLabel(readOrderNote('CLOSED MONDAYS'))).toBe('DELIVERY');
    expect(noteLabel(readOrderNote('JAMES TO ASSEMBLE'))).toBe('NOTE');
  });
});

describe('blockingReason', () => {
  it('stops a pickup and a hold', () => {
    expect(blockingReason(readOrderNote('DO NOT SHIP. HP PICKUP FRI'))).toBe('PICK UP');
    expect(blockingReason(readOrderNote('PLEASE HOLD FOR PREORDER ADDS'))).toBe('HOLD · ADDS');
    expect(blockingReason(readOrderNote('HOLD'))).toBe('HOLD');
  });

  it('stops a SHIP W/ only until the partner is in the same shipment', () => {
    const note = readOrderNote('SHIP W/ 881416,881348');
    expect(blockingReason(note)).toBe('SHIP W/ 881416, 881348');
    expect(blockingReason(note, new Set(['881416']))).toBe('SHIP W/ 881348');
    expect(blockingReason(note, new Set(['881416', '881348']))).toBeNull();
  });

  it('lets through what only informs', () => {
    expect(blockingReason(readOrderNote('CLOSED MONDAYS'))).toBeNull();
    expect(blockingReason(readOrderNote('FREE FREIGHT'))).toBeNull();
    expect(blockingReason(readOrderNote('NET 30 SHIP WITH PARTS ORDER'))).toBeNull();
    expect(blockingReason(readOrderNote(null))).toBeNull();
  });
});

describe('blockingLines', () => {
  it('lists each reason once, strongest first, with the note that says it', () => {
    // #881400 carries a pickup and a hold in one note; a typed note repeats the hold.
    const entries = orderNoteEntries(
      [{ orderNumber: '881400', notes: 'HOLD FOR ADDS PICK-UP ORDER' }],
      [{ message: 'WAITING FOR ADDS', author: 'Jed', at: '2026-09-10T15:00:00Z' }]
    );
    expect(blockingLines(entries)).toEqual([
      {
        reason: 'PICK UP',
        text: 'HOLD FOR ADDS PICK-UP ORDER',
        orderNumber: '881400',
        tone: 'pickup',
      },
      { reason: 'HOLD · ADDS', text: 'WAITING FOR ADDS', orderNumber: null, tone: 'hold' },
    ]);
  });

  it('puts the hold that says what it waits for before a bare one', () => {
    const entries = orderNoteEntries(
      [{ orderNumber: '881347', notes: 'PLEASE HOLD FOR PREORDER ADDS' }],
      [{ message: 'Waiting for James to locate the Hudson', at: '2026-09-10T15:00:00Z' }]
    );
    expect(blockingLines(entries).map((l) => l.reason)).toEqual(['HOLD · ADDS', 'HOLD']);
  });

  it('is empty when the order can go', () => {
    const entries = orderNoteEntries([{ orderNumber: '881466', notes: 'FREE FREIGHT' }], []);
    expect(blockingLines(entries)).toEqual([]);
  });

  it('clears a SHIP W/ once the partner is in the same shipment', () => {
    const entries = orderNoteEntries(
      [{ orderNumber: '881485', notes: 'SHIP W/ 881416,881348' }],
      []
    );
    expect(blockingLines(entries, new Set(['881485', '881416', '881348']))).toEqual([]);
  });
});

describe('orderNoteEntries', () => {
  it('puts the strongest note first, whoever wrote it', () => {
    const entries = orderNoteEntries(
      [{ orderNumber: '881448', notes: 'DO NOT SHIP. HP PICKUP FRI' }],
      [{ message: 'James found it', author: 'Jed', at: '2026-09-10T16:00:00Z' }]
    );
    expect(entries.map((e) => [e.tone, e.text])).toEqual([
      ['pickup', 'DO NOT SHIP. HP PICKUP FRI'],
      ['note', 'James found it'],
    ]);
  });

  it('gives each member of a combined order its own AS400 line', () => {
    // Group 881373 / 881347 / 881415 (10 Sep): the card read only the anchor's.
    const entries = orderNoteEntries(
      [
        { orderNumber: '881347', notes: 'PLEASE HOLD FOR PREORDER ADDS' },
        { orderNumber: '881373', notes: 'SHIP WITH ORDER 457414' },
        { orderNumber: '881415', notes: 'SHIP WITH REN' },
      ],
      []
    );
    expect(entries.map((e) => [e.orderNumber, e.tone])).toEqual([
      ['881347', 'hold'],
      ['881415', 'hold'],
      ['881373', 'ship_with'],
    ]);
  });

  it('drops billing, empty and repeated AS400 lines', () => {
    const entries = orderNoteEntries(
      [
        { orderNumber: '881001', notes: 'FREE FREIGHT' },
        { orderNumber: '881002', notes: 'HOLD FOR ADDS' },
        { orderNumber: '881003', notes: 'HOLD FOR ADDS' },
        { orderNumber: '881004', notes: null },
      ],
      [{ message: 'FF NET 60' }]
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ orderNumber: '881002', tone: 'hold' });
  });

  it('orders typed notes of the same tone newest first, the AS400 note after them', () => {
    const entries = orderNoteEntries(
      [{ orderNumber: '881309', notes: 'JAMES TO ASSEMBLE' }],
      [
        { message: 'Couldnt find S/D, ask James Friday', at: '2026-09-09T10:00:00Z' },
        { message: 'James helped me find', at: '2026-09-10T10:00:00Z' },
      ]
    );
    expect(entries.map((e) => e.text)).toEqual([
      'James helped me find',
      'Couldnt find S/D, ask James Friday',
      'JAMES TO ASSEMBLE',
    ]);
  });
});

describe('latestNoteEntries — the sign shows the two newest (Rafael, 11 Sep 2026)', () => {
  const entries = orderNoteEntries(
    [{ orderNumber: '881400', notes: 'HOLD FOR ADDS PICK-UP ORDER' }],
    [
      { message: 'JAMES TO ASSEMBLE', author: 'Rafael', at: '2026-09-10T15:00:00Z' },
      { message: 'CALL BEFORE DELIVERY', author: 'Carine', at: '2026-09-11T13:00:00Z' },
      { message: 'Label the S/D box', author: 'James', at: '2026-09-09T18:00:00Z' },
    ]
  );

  it('newest first, whatever the tone', () => {
    // orderNoteEntries puts the pickup first; the sign goes by time.
    expect(entries[0].tone).toBe('pickup');
    expect(latestNoteEntries(entries, 2).map((e) => e.text)).toEqual([
      'CALL BEFORE DELIVERY',
      'JAMES TO ASSEMBLE',
    ]);
  });

  it('the AS400 note came with the order, so it is the oldest', () => {
    expect(latestNoteEntries(entries, 4).map((e) => e.text)).toEqual([
      'CALL BEFORE DELIVERY',
      'JAMES TO ASSEMBLE',
      'Label the S/D box',
      'HOLD FOR ADDS PICK-UP ORDER',
    ]);
  });

  it('an order with only its AS400 notes keeps their order', () => {
    const only = orderNoteEntries(
      [
        { orderNumber: '881347', notes: 'CLOSED MONDAYS NO DELIVERIES' },
        { orderNumber: '881348', notes: 'JAMES TO ASSEMBLE' },
      ],
      []
    );
    expect(latestNoteEntries(only, 2).map((e) => e.orderNumber)).toEqual(['881347', '881348']);
  });
});
