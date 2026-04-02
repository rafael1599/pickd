# Picking Session Flow — Design Document

> Last updated: 2026-04-01
> Status: Approved for implementation
> Context: Research from 9 investigation agents (5 internal codebase, 4 external industry)

## Overview

PickD uses a serial session model: one active picking session per picker at a time.
This document defines the state machine, correction flow, and safety mechanisms.

## State Machine

```
                         IDLE
                          |
                    [user adds items]
                          |
                       BUILDING
                     (UI-only, no DB)
                          |
                  [Start Picking]
                  (generates path,
                   reserves stock,
                   creates DB record)
                          |
                        ACTIVE
                    (picking in progress)
                          |
                  [Mark as Ready]
                  (validates stock,
                   sends to queue)
                          |
               READY_TO_DOUBLE_CHECK
                  (in verification queue,
                   waiting for checker)
                          |
                  [Checker locks it]
                          |
                   DOUBLE_CHECKING
                  (checker verifying items)
                     /       \
          [Complete]          [Reject with notes]
              |                     |
          COMPLETED          NEEDS_CORRECTION
          (terminal)          (back to picker queue,
                               correction view)
                                    |
                             [Picker corrects]
                                    |
                        READY_TO_DOUBLE_CHECK
                          (re-enters queue)
```

### Allowed Transitions

| From                  | To                    | Trigger               | Guard               |
| --------------------- | --------------------- | --------------------- | ------------------- |
| idle                  | building              | User adds first item  | None                |
| building              | active                | Start Picking         | Stock available     |
| active                | ready_to_double_check | Mark as Ready         | All items validated |
| active                | cancelled             | User deletes / expiry | Not completed       |
| ready_to_double_check | double_checking       | Checker locks         | checked_by = null   |
| double_checking       | completed             | Checker approves      | All items checked   |
| double_checking       | needs_correction      | Checker rejects       | Notes required      |
| double_checking       | ready_to_double_check | Checker releases      | Release lock only   |
| needs_correction      | ready_to_double_check | Picker corrects       | Via Correction Mode |

### Forbidden Transitions

- double_checking -> active (eliminated: was returnToBuilding, caused bug-011)
- double_checking -> building (eliminated: same reason)
- completed -> any (terminal, triple-protected)
- Any backward jump that skips a state

## Inline Correction (Double Check View)

**Decision date:** 2026-04-01
**Status:** First attempt implemented and tested — rejected, needs redesign.

### How problem items are detected

Two sources set the `sku_not_found` and `insufficient_stock` flags on cart items:

1. **Watchdog daemon** (`watchdog-pickd/supabase_client.py`) — sets both flags when
   creating orders from PDFs based on `sku_metadata` lookup and inventory availability.
2. **Frontend `processPickingList()`** — sets `insufficient_stock` during "Start Picking"
   when requested qty exceeds available inventory. Does NOT set `sku_not_found`.

These flags are stored in the `picking_lists.items` JSONB and persist through the
entire workflow. The frontend reads them in DoubleCheckView to render problem items
in red and show correction controls.

**Note:** Flags are NOT recalculated when entering double check — they reflect the
state at order creation / start picking time. Stock may have changed since then.

**Test order:** `TEST-001` is a manually-created order in `double_checking` status
with explicit flags for testing the correction UI. Recreate with:
`supabase/seed_test_orders.sql` (requires `create_users.sql` first).

Items:

- `03-4614BK` — OK
- `03-4614ZZ` — `sku_not_found: true` (invented SKU)
- `03-9999XX` — `sku_not_found: true` (nonexistent)
- `03-3764BK` — `insufficient_stock: true` (requests 50, insufficient stock)

### First attempt: Option A — Inline (rejected)

**What was built:**

- Small `[Fix]` button (8px, wrench icon) on problem items in DoubleCheckView
- Tapping Fix opens a panel BELOW the card (not inside it) with:
  - Qty adjuster ([ - ] [ qty ] [ + ]) starting at 0
  - Up to 3 alternatives from `findSimilarSkus()` — no search field
  - Remove Item button
- `handleCorrectItem` in PickingCartDrawer handles swap/adjust_qty/remove actions
- All corrections logged in `picking_list_notes`

**What the design doc originally proposed (not what was built):**

- Prominent [Replace] and [Remove] buttons inside each problem item card
- Full search field to query any SKU in inventory
- Qty selector only AFTER choosing a replacement, defaulting to original qty
- Separate [Adjust Qty] for insufficient_stock items

**Why it was rejected (testing feedback 2026-04-01):**

1. Quantities were confusing — adjuster starts at 0 instead of original pickingQty
2. Only 3 pre-calculated suggestions, often not useful — no way to search freely
3. Fix button shouldn't appear if there are no alternatives
4. Inline controls are too cramped — need a dedicated screen for corrections

### Next approach: Correction Mode (to be designed)

A dedicated view (like Build Order but limited to problem items) where the checker
can search the full inventory and replace/adjust items. See backlog fix-002 for
implementation plan.

### Rules (still valid)

- Correction buttons only appear on problem items (sku_not_found or insufficient_stock)
- All corrections are logged in picking_list_notes
- The checker never leaves the double check flow
- No backward transitions to building mode or active status

### When to Use returnToPicker Instead

For cases where items need to be physically re-picked from the warehouse floor,
the checker uses "Return to Picker" with notes. The picker sees it in their queue.

## Workflow Lock

A boolean ref `isInWorkflowRef` in PickingContext prevents loadSession from
overwriting activeListId while a workflow function is executing.

Protected functions:

- generatePickingPath (sets activeListId after DB insert/update)
- returnToBuilding (changes session state)

Guard in loadSession:

```
if (isInWorkflowRef.current) {
  // Skip — a workflow is in progress, don't overwrite
  return;
}
```

Safety: 30-minute timeout auto-releases the lock.

## Group/Sibling Handling

When an order belongs to a group (combined orders like "878888 / 878882"):

- Locking one sibling locks ALL siblings (checked_by set on all)
- Releasing one sibling releases ALL siblings
- returnToBuilding releases ALL siblings back to ready_to_double_check
- Deleting follows existing group dissolution logic

## Session Loading Priority (loadSession)

On app init / user login, loadSession loads the "best" session:

1. HIGHEST: double_checking where checked_by = user (resume verification)
2. SECOND: active or needs_correction where user_id = user (resume picking)
3. FALLBACK: localStorage cart data

Guard: if isInWorkflowRef is true, skip entirely.

## Auto-Cancel / Expiration

Current: 15min idle + 24hr total -> cancelled
Planned (idea-031): 3 days -> expired (visible, reactivatable with one tap)

## Debounce Safety

The saveToDb debounce (1000ms) in usePickingSync:

- Only fires in sessionMode = 'picking'
- Timer is cancelled when sessionMode changes (cleanup in useEffect return)
- The debounce utility exposes .cancel() for explicit cleanup

## Research Sources

This design is informed by:

- ShipHero mobile picking + Tote QA workflow
- Amazon pack verification (SLAM lines)
- Dynamics 365 quality management for warehouses
- Vendure open-source order state machine (TypeScript)
- Industry standard: serial session model, forward-only transitions
- React patterns: workflow lock, version counter refs, Zustand getState()

## Related Backlog Items

- fix-002: Implementation of these fixes (returnToBuilding + loadSession + group cleanup)
- bug-011: Order disappears when editing from double check with multiple orders
- idea-031: Auto-cancel redesign (expiration with reactivation)
