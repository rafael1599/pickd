/**
 * What an order's note asks of the floor — read once, the same everywhere.
 *
 * Two kinds of free text reach the ship station: the AS400 Order Comments
 * (`picking_lists.notes`) and what people type (`picking_list_notes`). Both
 * carry instructions somebody has to act on — "DO NOT SHIP DEALER PICK UP",
 * "HOLD FOR ADDS", "SHIP W/ 881424" — and, next to them, billing boilerplate the
 * floor never needs: "FREE FREIGHT", "NET 60", "FF N30 W/FLA" were 168 of the 422
 * AS400 notes between June and September 2026.
 *
 * **Signals, not one type.** #881400 "HOLD FOR ADDS PICK-UP ORDER" is a pickup AND
 * a hold, and a single type would lose one of them. The sign paints the strongest
 * signal (`noteTone`); what stops a shipment is `blockingReason`.
 *
 * - **"SHIP W/ 881424"** names another order: the instruction is to travel
 *   together, and it holds only until the two are combined (881473 and 881475
 *   shipped the same day as their partner).
 * - **"SHIP WITH REN"** names a model: the order waits for bikes that have not
 *   arrived. That is a hold, labelled with the model.
 *
 * Built from the 477 notes of Jun–Sep 2026 (backlog idea-179, research §9). The
 * SQL mirror arrives with the hold column; both sides must pass the case table in
 * `__tests__/orderNoteSignals.test.ts`.
 */

export type NoteTone = 'pickup' | 'hold' | 'ship_with' | 'delivery' | 'note';

export interface NoteSignals {
  /** The note without PickD's own appendages; '' when nothing is left. */
  text: string;
  pickup: boolean;
  /** Why it waits — 'ADDS' | 'REN' | 'CONF' | 'PAY' | a model | 'HOLD' — or null. */
  hold: string | null;
  /** Order numbers it has to travel with. */
  shipWith: string[];
  /** Any ship-together instruction, named or not ("SHIP WITH PARTS ORDER"). */
  shipsTogether: boolean;
  delivery: boolean;
}

/** Strongest first: what the sign shows on top, and in what colour. */
export const NOTE_TONE_ORDER: readonly NoteTone[] = [
  'pickup',
  'hold',
  'ship_with',
  'delivery',
  'note',
];

/**
 * PickD writes into the AS400 note too: a cancel appends ' [User Cancelled]' (or
 * leaves 'User Cancelled' when there was nothing), the auto-cancel RPCs append
 * '[System: …]', and a manual fix left '[Completed manually …]'. 52 rows carried
 * one by September. They describe PickD's own history, not what the office asked.
 */
export function stripPickdAppendages(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/\s*\[(?:System|User|Completed manually)[^\]]*\]/gi, '')
    .replace(/^\s*User Cancelled\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PICKUP = /pick\s*-?\s*up|pikcup|will\s*call|drop\s*-?\s*off/i;
/** "this order is not a pick up, wrong notes were inputed here" (#881353). */
const PICKUP_NEGATED = /\bnot\s+(?:a\s+)?(?:pick\s*-?\s*up|pickup)/gi;

const HOLD = /\bhold\b|\bwait(?:ing)?\b|pending\s+payment|do\s*n[o']?t\s+ship/i;

/** Labels by what the order waits for, in order of precedence. */
const HOLD_LABELS: ReadonlyArray<[RegExp, string]> = [
  [/\badd(?:s|\s*-?\s*ons?)?\b/i, 'ADDS'],
  [/\bren(?:egades?)?\b/i, 'REN'],
  [/\bconf(?:irm(?:ation)?)?\b/i, 'CONF'],
  [/\bpayment\b|\bcc\s*info\b|\bcredit\s*card\b/i, 'PAY'],
];

/** Words after "SHIP WITH" that name a document, a warehouse or nothing, not a bike. */
const NOT_A_MODEL = new Set([
  'FL',
  'FLA',
  'PS',
  'ORDER',
  'ORDERS',
  'PARTS',
  'PART',
  'THE',
  'A',
  'AN',
  'AND',
  'MISSING',
  'ALLOCATIONS',
]);

/** Model words a note may name without "SHIP" in front ("WITH HUDSON E1S"). */
const WITH_MODEL =
  /\b(?:with|w\/)\s*(hudson|cit(?:izen)?\s*\d?|renegades?|ren|allegro|lasers?|ventura|divides?|helix|komodo|all\s+access)\b/i;
const SHIP_WITH_WORD = /\bship\s*(?:with|w\s*\/?)\s*([a-z][a-z0-9]*(?:\s+access)?)/i;
const HOLD_FOR_WORD = /\bhold\s+(?:for|with)\s+([a-z][a-z0-9]*)/i;

function modelLabel(word: string): string | null {
  const w = word.toUpperCase().replace(/\s+/g, ' ').trim();
  if (!w || NOT_A_MODEL.has(w)) return null;
  if (/^CIT/.test(w)) return 'CITIZEN';
  if (/^REN/.test(w)) return 'REN';
  if (w === 'LASERS') return 'LASER';
  return w;
}

/** Where a ship-together instruction starts; every 6-digit order number after it is a partner. */
const SHIP_WITH_CONTEXT =
  /\bship\s*(?:with|w\s*\/?)|\bw\/|\bwith\b|\badds?\s+(?:on\s+)?(?:to|for)\b|\binvoice\s*w\//i;

const DELIVERY =
  /\bclosed\b|no\s+deliver|call\s+(?:\w+\s+)?before|\bdeliver(?:y|ies)?\b|call\s+\d+\s*min|between\s+\d|appointment|\bappt\b|lift\s*gate|residential|\busps\b|\bups\b|ship\s+today|ship\s+to\s+[a-z]|\bto\s+[a-z]+\s+location\b|\basap\b|\brush\b|\burgent\b/i;

/**
 * Billing boilerplate: what is left after removing it decides whether the note
 * says anything to the floor. "FREIGH $75.00" and "REIGHT $65.00" are real typos.
 */
const BILLING =
  /free\s*freight|f?reigh?t?\s*\$\s*[\d.,]*|freigh?t\s*\$?\s*[\d.,]*|\bff\b|\bnet\s*\d+|\bn\d{2,3}\b|\bterms\b|prepaid|\bf\.?o\.?b\.?\b|\bach\b|\bacct\b|\baccount\b|credit\s*card|\bcharge\b|buy-?\s*in|\bpromo\b|good\s+to\s+go|\bpt\s+i+\b|\bpartial\b|parts?\s+orders?\b|pricing|discount|premier|\bdevo\b|program|\bdeal\b|backyard|backdoor|rental|opening\s+order|parts?\s+(?:orders?\s+)?over|over\s+\$?\d+|half\s+off|level\s+\d|tier\s+\d|w\/\s*fla?\b|\d+\s*bikes?|\bbikes?\b|\$[\d.,]+|\d+%|\bnew\s+dealer\b|\bplus\s+shipping\b|\bep\s+purchase\b|\binvoice\b|\bpartner\b|[&+\-/,.:#]/gi;

const PO_NUMBER = /\bp\.?o\.?\s*#/i;

export function readOrderNote(raw: string | null | undefined): NoteSignals {
  const text = stripPickdAppendages(raw);
  if (!text) {
    return { text, pickup: false, hold: null, shipWith: [], shipsTogether: false, delivery: false };
  }

  const pickup = PICKUP.test(text.replace(PICKUP_NEGATED, ' '));

  // A model after "SHIP WITH" is a hold for that model ("SHIP WITH REN").
  const shipWord = SHIP_WITH_WORD.exec(text)?.[1];
  const shipModel = shipWord ? modelLabel(shipWord) : null;
  const withModel = WITH_MODEL.exec(text)?.[1];
  const waitsForModel = shipModel ?? (withModel ? modelLabel(withModel) : null);

  let hold: string | null = null;
  // "DO NOT SHIP" on a pickup is the pickup, not a hold.
  const holdText = pickup ? text.replace(/do\s*n[o']?t\s+ship/gi, ' ') : text;
  if (HOLD.test(holdText) || waitsForModel) {
    hold =
      HOLD_LABELS.find(([re]) => re.test(holdText))?.[1] ??
      waitsForModel ??
      (() => {
        const word = HOLD_FOR_WORD.exec(holdText)?.[1];
        return (word && modelLabel(word)) || 'HOLD';
      })();
  }

  const context = SHIP_WITH_CONTEXT.exec(text);
  const shipWith = context ? [...new Set(text.slice(context.index).match(/\b\d{6}\b/g) ?? [])] : [];
  const shipsTogether =
    shipWith.length > 0 || /\bship\s*(?:with|w\s*\/?)\s*(?!fla?\b)[a-z]/i.test(text);

  return { text, pickup, hold, shipWith, shipsTogether, delivery: DELIVERY.test(text) };
}

/** True when the note is only billing boilerplate — nothing for the floor. */
export function isBillingOnly(signals: NoteSignals): boolean {
  if (!signals.text) return false;
  if (noteSignalsTone(signals) !== 'note') return false;
  if (PO_NUMBER.test(signals.text)) return false;
  const leftover = signals.text.replace(BILLING, ' ').replace(/[^a-z]/gi, '');
  return leftover.length < 3;
}

function noteSignalsTone(s: NoteSignals): NoteTone {
  if (s.pickup) return 'pickup';
  if (s.hold) return 'hold';
  if (s.shipsTogether) return 'ship_with';
  if (s.delivery) return 'delivery';
  return 'note';
}

/** The colour of the note on the sign, or null when there is nothing to show. */
export function noteTone(signals: NoteSignals): NoteTone | null {
  if (!signals.text || isBillingOnly(signals)) return null;
  return noteSignalsTone(signals);
}

/** One or two words, in figures: 'PICK UP', 'HOLD · ADDS', 'SHIP W/ 881424'. */
export function noteLabel(signals: NoteSignals): string {
  switch (noteTone(signals)) {
    case 'pickup':
      return 'PICK UP';
    case 'hold':
      return signals.hold && signals.hold !== 'HOLD' ? `HOLD · ${signals.hold}` : 'HOLD';
    case 'ship_with':
      return signals.shipWith.length > 0 ? `SHIP W/ ${signals.shipWith.join(', ')}` : 'SHIP WITH';
    case 'delivery':
      return 'DELIVERY';
    default:
      return 'NOTE';
  }
}

/**
 * Why this order should not go out on its own right now, or null.
 *
 * `together` holds the order numbers already in the same shipment (its group);
 * a "SHIP W/ 881424" stops blocking once 881424 is one of them. A pickup is
 * reported too: it leaves when the customer comes, not on a truck.
 */
export function blockingReason(
  signals: NoteSignals,
  together: ReadonlySet<string> = new Set()
): string | null {
  if (!signals.text) return null;
  if (signals.pickup) return 'PICK UP';
  if (signals.hold) return signals.hold === 'HOLD' ? 'HOLD' : `HOLD · ${signals.hold}`;
  const missing = signals.shipWith.filter((n) => !together.has(n));
  if (missing.length > 0) return `SHIP W/ ${missing.join(', ')}`;
  return null;
}

/** A reason not to ship, with the note that says it. */
export interface BlockingLine {
  reason: string;
  text: string;
  orderNumber: string | null;
  tone: NoteTone;
}

/**
 * Every reason an order should not go out on its own, strongest first, one line
 * per distinct reason. `together` is the order numbers already in the shipment.
 * This is what the ship list's chip and the ship confirm read.
 */
export function blockingLines(
  entries: readonly OrderNoteEntry[],
  together: ReadonlySet<string> = new Set()
): BlockingLine[] {
  const lines: BlockingLine[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const reason = blockingReason(entry.signals, together);
    if (!reason || seen.has(reason)) continue;
    seen.add(reason);
    lines.push({ reason, text: entry.text, orderNumber: entry.orderNumber, tone: entry.tone });
  }
  // The chip shows the first line, so within a tone the one that says what it
  // waits for ('HOLD · ADDS') goes before a bare 'HOLD'. Stable otherwise.
  const rank = (l: BlockingLine) =>
    NOTE_TONE_ORDER.indexOf(l.tone) * 2 + (l.reason.includes('·') ? 0 : 1);
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i)
    .map(({ l }) => l);
}

/** A note on an order, ready for the sign: who wrote it and what it asks. */
export interface OrderNoteEntry {
  text: string;
  signals: NoteSignals;
  tone: NoteTone;
  /** The order it belongs to, on a combined card. */
  orderNumber: string | null;
  /** Null for the AS400 note. */
  author: string | null;
  /** ISO time; null for the AS400 note (it predates everything typed on the order). */
  at: string | null;
}

export interface AS400NoteSource {
  orderNumber: string | null;
  notes: string | null;
}

export interface TypedNoteSource {
  message: string;
  orderNumber?: string | null;
  author?: string | null;
  at?: string | null;
}

/**
 * Every note an order shows, strongest first. The AS400 note of each member of a
 * combined order is its own line — the card used to read only the anchor's, and
 * 24 of 35 combined groups lost a note that way. Typed notes are expected to be
 * the human ones (system notes filtered out by the caller with `isHumanNote`).
 * Within a tone, the newest typed note goes first and the AS400 note last.
 */
export function orderNoteEntries(
  as400: readonly AS400NoteSource[],
  typed: readonly TypedNoteSource[]
): OrderNoteEntry[] {
  const entries: OrderNoteEntry[] = [];
  const seen = new Set<string>();
  for (const src of as400) {
    const signals = readOrderNote(src.notes);
    const tone = noteTone(signals);
    if (!tone) continue;
    // Identical AS400 notes across members say one thing ("FREE FREIGHT" aside).
    const key = `as400:${signals.text.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      text: signals.text,
      signals,
      tone,
      orderNumber: src.orderNumber,
      author: null,
      at: null,
    });
  }
  for (const note of typed) {
    const signals = readOrderNote(note.message);
    const tone = noteTone(signals);
    if (!tone) continue;
    entries.push({
      text: signals.text,
      signals,
      tone,
      orderNumber: note.orderNumber ?? null,
      author: note.author ?? null,
      at: note.at ?? null,
    });
  }
  const rank = (t: NoteTone) => NOTE_TONE_ORDER.indexOf(t);
  return entries.sort((a, b) => {
    if (rank(a.tone) !== rank(b.tone)) return rank(a.tone) - rank(b.tone);
    if (a.at && b.at) return b.at.localeCompare(a.at);
    if (a.at) return -1;
    if (b.at) return 1;
    return 0;
  });
}
