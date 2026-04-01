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

When a checker finds a problem item (SKU not found, insufficient stock), they can:

1. Tap "Fix" on the problem item card
2. The card expands showing:
   - Qty adjuster (reduce quantity)
   - Up to 3 similar SKU suggestions from inventory (same model, different size/color)
   - "No alternatives found" if nothing matches
3. Selecting a replacement swaps the SKU in the order
4. The correction is logged in picking_list_notes
5. The checker continues verifying without leaving the view

### Similar SKU Matching

Priority order:

1. Same SKU prefix, different color suffix (03-3764BK -> 03-3764RD, 03-3764WH)
2. Same model name, different size (FAULTLINE A1 15 -> FAULTLINE A1 17)
3. Only items with qty > 0 in the same warehouse

Max 3 suggestions. If none found, show "No alternatives found".

### When to Use returnToPicker Instead

For major corrections (many wrong items, order needs full re-pick), the checker uses
"Return to Picker" which sends the order to needs_correction with notes.

## Correction Mode (Picker Side)

When a picker opens an order in needs_correction status:

1. They see the Correction Mode view (not the regular building view)
2. Problem items are highlighted with the checker's notes
3. Picker can: remove items, swap SKUs, adjust quantities
4. When done, the order goes directly to ready_to_double_check
5. The order never returns to "active" or "building" — forward-only

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
