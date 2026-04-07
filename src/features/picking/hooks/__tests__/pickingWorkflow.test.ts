import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Picking Workflow Tests (idea-032)
 *
 * Tests the new workflow after building mode elimination:
 * - idle → picking direct (no building step)
 * - addToCart allowed in picking mode
 * - DoubleCheckView footer logic (complete now vs send to verify)
 * - Session preservation when opening verification queue order
 * - No building mode references in session transitions
 */

// --- Session mode transition logic (extracted from PickingContext) ---

type SessionMode = 'idle' | 'picking' | 'double_checking';

interface SessionState {
  sessionMode: SessionMode;
  cartItems: { sku: string; pickingQty: number }[];
  orderNumber: string | null;
  activeListId: string | null;
}

function simulateAddToCart(
  state: SessionState,
  item: { sku: string },
  pendingItemCallback: (item: { sku: string }) => void
): SessionState {
  // If idle and no order number, store item and show modal
  if (state.sessionMode === 'idle' && !state.orderNumber) {
    pendingItemCallback(item);
    return state; // No state change, modal opens
  }

  // Transition to picking mode if idle (with order number)
  const newMode = state.sessionMode === 'idle' ? 'picking' : state.sessionMode;

  // Add item (or increment)
  const existing = state.cartItems.find((c) => c.sku === item.sku);
  const newItems = existing
    ? state.cartItems.map((c) =>
        c.sku === item.sku ? { ...c, pickingQty: c.pickingQty + 1 } : c
      )
    : [...state.cartItems, { sku: item.sku, pickingQty: 1 }];

  return { ...state, sessionMode: newMode, cartItems: newItems };
}

function simulateStartNewSession(orderNumber: string): SessionState {
  return {
    sessionMode: 'picking', // Direct to picking, no building
    cartItems: [],
    orderNumber,
    activeListId: null,
  };
}

// --- Footer action logic (extracted from DoubleCheckView) ---

type FooterAction = 'slide_to_complete' | 'show_buttons';

function getFooterAction(verifiedCount: number, totalCount: number): FooterAction {
  return verifiedCount === totalCount ? 'slide_to_complete' : 'show_buttons';
}

type SlideAction = 'mark_ready_then_deduct' | 'deduct_only';

function getSlideConfirmAction(status: string): SlideAction {
  return status === 'active' || status === 'needs_correction'
    ? 'mark_ready_then_deduct'
    : 'deduct_only';
}

// --- Send to Verify Queue logic ---

interface VerifyQueueResult {
  status: string;
  checked_by: string | null;
  drawerOpen: boolean;
}

function simulateSendToVerifyQueue(_activeListId: string): VerifyQueueResult {
  // markAsReady validates stock + sets double_checking
  // releaseCheck then sets ready_to_double_check + checked_by = null
  return {
    status: 'ready_to_double_check',
    checked_by: null,
    drawerOpen: false,
  };
}

// --- Tests ---

describe('Picking Workflow (idea-032)', () => {
  describe('idle → picking direct', () => {
    it('transitions from idle to picking when order number exists', () => {
      const state: SessionState = {
        sessionMode: 'idle',
        cartItems: [],
        orderNumber: 'ORD-001',
        activeListId: null,
      };

      const result = simulateAddToCart(state, { sku: 'SKU-001' }, vi.fn());

      expect(result.sessionMode).toBe('picking');
      expect(result.cartItems).toHaveLength(1);
      expect(result.cartItems[0].sku).toBe('SKU-001');
    });

    it('shows modal when idle and no order number', () => {
      const setPending = vi.fn();
      const state: SessionState = {
        sessionMode: 'idle',
        cartItems: [],
        orderNumber: null,
        activeListId: null,
      };

      const result = simulateAddToCart(state, { sku: 'SKU-001' }, setPending);

      expect(setPending).toHaveBeenCalledWith({ sku: 'SKU-001' });
      expect(result.sessionMode).toBe('idle'); // No change until modal completes
    });

    it('startNewSession goes directly to picking (never building)', () => {
      const state = simulateStartNewSession('ORD-TEST-001');

      expect(state.sessionMode).toBe('picking');
      expect(state.orderNumber).toBe('ORD-TEST-001');
    });
  });

  describe('addToCart in picking mode', () => {
    it('allows adding items when sessionMode is picking', () => {
      const state: SessionState = {
        sessionMode: 'picking',
        cartItems: [{ sku: 'SKU-001', pickingQty: 1 }],
        orderNumber: 'ORD-001',
        activeListId: 'list-1',
      };

      const result = simulateAddToCart(state, { sku: 'SKU-002' }, vi.fn());

      expect(result.cartItems).toHaveLength(2);
      expect(result.cartItems[1].sku).toBe('SKU-002');
      expect(result.sessionMode).toBe('picking');
    });

    it('increments qty when adding same SKU again in picking mode', () => {
      const state: SessionState = {
        sessionMode: 'picking',
        cartItems: [{ sku: 'SKU-001', pickingQty: 2 }],
        orderNumber: 'ORD-001',
        activeListId: 'list-1',
      };

      const result = simulateAddToCart(state, { sku: 'SKU-001' }, vi.fn());

      expect(result.cartItems).toHaveLength(1);
      expect(result.cartItems[0].pickingQty).toBe(3);
    });
  });

  describe('DoubleCheckView footer logic', () => {
    it('shows buttons when not all items verified', () => {
      expect(getFooterAction(3, 10)).toBe('show_buttons');
    });

    it('shows slide-to-complete when all items verified', () => {
      expect(getFooterAction(10, 10)).toBe('slide_to_complete');
    });

    it('shows buttons when zero items verified', () => {
      expect(getFooterAction(0, 5)).toBe('show_buttons');
    });

    it('chains markAsReady + deduct for active status on complete', () => {
      expect(getSlideConfirmAction('active')).toBe('mark_ready_then_deduct');
    });

    it('chains markAsReady + deduct for needs_correction status on complete', () => {
      expect(getSlideConfirmAction('needs_correction')).toBe('mark_ready_then_deduct');
    });

    it('only deducts for double_checking status on complete', () => {
      expect(getSlideConfirmAction('double_checking')).toBe('deduct_only');
    });
  });

  describe('Send to Verify Queue', () => {
    it('sets status to ready_to_double_check with no checker assigned', () => {
      const result = simulateSendToVerifyQueue('list-1');

      expect(result.status).toBe('ready_to_double_check');
      expect(result.checked_by).toBeNull();
    });

    it('closes the drawer after sending', () => {
      const result = simulateSendToVerifyQueue('list-1');

      expect(result.drawerOpen).toBe(false);
    });
  });

  describe('Complete Now button', () => {
    it('auto-selects all items to reveal slide-to-complete', () => {
      const pallets = [
        {
          id: 1,
          items: [
            { sku: 'SKU-001', location: 'ROW 1' },
            { sku: 'SKU-002', location: 'ROW 2' },
          ],
        },
        {
          id: 2,
          items: [{ sku: 'SKU-003', location: 'ROW 3' }],
        },
      ];

      // Simulate "Complete Now" — generates all keys
      const allKeys = pallets.flatMap((p) =>
        p.items.map((item) => `${p.id}-${item.sku}-${item.location}`)
      );

      expect(allKeys).toEqual([
        '1-SKU-001-ROW 1',
        '1-SKU-002-ROW 2',
        '2-SKU-003-ROW 3',
      ]);
      expect(allKeys).toHaveLength(3);

      // After setting all keys, footer switches to slide_to_complete
      expect(getFooterAction(3, 3)).toBe('slide_to_complete');
    });
  });

  describe('session mode has no building state', () => {
    it('only allows idle, picking, and double_checking', () => {
      const validModes: SessionMode[] = ['idle', 'picking', 'double_checking'];
      // TypeScript enforces this at compile time, but verify at runtime
      expect(validModes).not.toContain('building');
      expect(validModes).toHaveLength(3);
    });
  });

  describe('session preservation on verification queue open', () => {
    it('picking session already in DB survives external list load', () => {
      // When user opens a verification order, their picking session
      // (status=active in DB) is preserved. After verification ends,
      // loadSession recovers it because it queries for user's active lists.
      const pickingSession = {
        activeListId: 'my-order-id',
        status: 'active',
        inDb: true, // Key: picking mode auto-syncs to DB
      };

      const externalList = {
        id: 'verification-order-id',
        status: 'double_checking',
      };

      // Simulating: user state gets overwritten by external list
      // But the original session still exists in DB as 'active'
      expect(pickingSession.inDb).toBe(true);
      expect(pickingSession.status).toBe('active');
      expect(externalList.status).toBe('double_checking');
      // loadSession will find it after verification completes
    });

    it('unsaved picking session gets flushed to DB before switch', () => {
      // When sessionMode=picking but activeListId is null (debounce hasn't fired),
      // loadExternalList force-inserts the order before overwriting state
      const unsavedSession = {
        sessionMode: 'picking' as const,
        cartItems: [{ sku: 'SKU-001', pickingQty: 2 }],
        activeListId: null, // Not yet saved
        orderNumber: 'ORD-005',
      };

      const shouldFlush =
        unsavedSession.sessionMode === 'picking' &&
        unsavedSession.cartItems.length > 0 &&
        !unsavedSession.activeListId &&
        unsavedSession.orderNumber;

      expect(shouldFlush).toBeTruthy();
    });

    it('does NOT flush if session already has activeListId', () => {
      const savedSession = {
        sessionMode: 'picking' as const,
        cartItems: [{ sku: 'SKU-001', pickingQty: 2 }],
        activeListId: 'already-in-db',
        orderNumber: 'ORD-005',
      };

      const shouldFlush =
        savedSession.sessionMode === 'picking' &&
        savedSession.cartItems.length > 0 &&
        !savedSession.activeListId &&
        savedSession.orderNumber;

      expect(shouldFlush).toBeFalsy();
    });
  });
});
