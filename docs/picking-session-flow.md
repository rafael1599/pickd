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

## Inline Correction (Double Check View) — Design Decision: Option A

**Decision date:** 2026-04-01
**Chosen approach:** Inline Replace + Remove buttons on problem items, with search
expansion inside the card. No navigation away from double check.

### Flow for problem items (sku_not_found or insufficient_stock)

Each problem item card shows two buttons: [Replace] and [Remove].

**Step 1 — Problem item (collapsed):**

    ┌─────────────────────────────────────────────┐
    │ RED  03-4614ZZ          1u                  │
    │ FAULTLINE A1 V2 15 PHANTOM PURPLE           │
    │ SKU NOT FOUND                               │
    │                                             │
    │   [ Replace ]  [ Remove ]                   │
    └─────────────────────────────────────────────┘

**Step 2 — Tap Replace, card expands with search:**

    ┌─────────────────────────────────────────────┐
    │ RED  03-4614ZZ          1u                  │
    │ FAULTLINE A1 V2 15 PHANTOM PURPLE           │
    │ SKU NOT FOUND                               │
    │                                             │
    │ ┌─ REPLACE WITH: ───────────────────────┐   │
    │ │ Search [SKU or name...            ]   │   │
    │ │                                       │   │
    │ │  03-4614RD  FAULTLINE A1 GARNET  7u   │   │
    │ │  03-4614WH  FAULTLINE A1 WHITE   3u   │   │
    │ │  03-4615BK  FAULTLINE A1 17 BLK  5u   │   │
    │ │                                       │   │
    │ │  (results update as you type)         │   │
    │ └───────────────────────────────────────┘   │
    │                                             │
    │   [ Cancel ]                                │
    └─────────────────────────────────────────────┘

- Search field queries inventory (same warehouse, qty > 0)
- Pre-populated with suggestions from findSimilarSkus if available
- User can type freely to search any SKU in inventory
- Results update as user types (debounced)

**Step 3 — Tap a result, qty selector appears (no qty before choosing):**

    ┌─────────────────────────────────────────────┐
    │ OK  03-4614RD           ?u                  │
    │ FAULTLINE A1 V2 15 GARNET   (7 available)  │
    │ ROW 10                                      │
    │                                             │
    │   How many?   [ - ]  [ 1 ]  [ + ]           │
    │                                             │
    │   [ Confirm ]    [ Change ]                 │
    └─────────────────────────────────────────────┘

- Qty selector only appears AFTER choosing replacement
- Default qty = original pickingQty (or max available, whichever is less)
- Confirm swaps the item, logs the correction, collapses the card
- Change goes back to the search step

### For insufficient_stock items

Same flow but also shows [Adjust Qty] button (no need to replace, just lower the qty):

    ┌─────────────────────────────────────────────┐
    │ RED  03-3764BK          50u                 │
    │ HELIX A2 16 GLOSS BLACK (only 2 in stock)  │
    │ INSUFFICIENT STOCK                          │
    │                                             │
    │   [ Replace ]  [ Adjust Qty ]  [ Remove ]   │
    └─────────────────────────────────────────────┘

Adjust Qty shows inline: [ - ] [ 2 ] [ + ] [ Confirm ]

### Rules

- Replace and Remove buttons only appear on problem items (red)
- Normal items have no correction buttons
- Qty selector only appears AFTER choosing a replacement item
- All corrections are logged in picking_list_notes
- The checker never leaves the double check view
- No backward transitions (no building mode, no active status change)

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
