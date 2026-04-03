# Picking Session Flow — Design Document

> Last updated: 2026-04-03
> Status: Approved for implementation
> Context: Research from 9 investigation agents (5 internal codebase, 4 external industry)

## Overview

PickD uses a serial session model: one active picking session per picker at a time.
This document defines the state machine, correction flow, and safety mechanisms.

> **⚠️ EN PROCESO:** `building` mode está siendo eliminado (idea-032). El flujo anterior
> era `idle → building → active`. El nuevo flujo es `idle → active` directo, con Edit
> Order mode reemplazando las funciones de building (agregar/editar/eliminar items).
> `OrderBuilderMode.tsx` y `returnToBuilding()` serán eliminados.

## State Machine

```
                         IDLE
                          |
                    [user taps item]
                    (SessionInitModal:
                     order #, customer)
                          |
                  [Start Picking]
                  (generatePickingPath:
                   validates stock,
                   reserves inventory,
                   creates DB record)
                          |
                        ACTIVE
                    (picking in progress,
                     +/- controls enabled,
                     Edit Order available)
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
                  (checker verifying items,
                   Edit Order available)
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
| idle                  | active                | Start Picking         | Stock available     |
| active                | ready_to_double_check | Mark as Ready         | All items validated |
| active                | cancelled             | User deletes / expiry | Not completed       |
| ready_to_double_check | double_checking       | Checker locks         | checked_by = null   |
| double_checking       | completed             | Checker approves      | All items checked   |
| double_checking       | needs_correction      | Checker rejects       | Notes required      |
| double_checking       | ready_to_double_check | Checker releases      | Release lock only   |
| needs_correction      | ready_to_double_check | Picker corrects       | Via Correction Mode |

### Forbidden Transitions

- completed -> any (terminal, triple-protected)
- Any backward jump that skips a state

### Eliminated transitions (historical)

- idle -> building (eliminated: building mode removed, idea-032)
- building -> active (eliminated: replaced by idle -> active)
- double_checking -> active (eliminated: was returnToBuilding, caused bug-011)
- double_checking -> building (eliminated: same reason)

## Edit Order (Double Check View)

**Decision date:** 2026-04-02
**Status:** Implemented and tested. Replaces rejected inline correction (2026-04-01).

### How problem items are detected

Two sources set the `sku_not_found` and `insufficient_stock` flags on cart items:

1. **Watchdog daemon** (`watchdog-pickd/supabase_client.py`) — sets both flags when
   creating orders from PDFs based on `sku_metadata` lookup and inventory availability.
2. **Frontend `processPickingList()`** — sets `insufficient_stock` during "Start Picking"
   when requested qty exceeds available inventory. Does NOT set `sku_not_found`.

These flags are stored in the `picking_lists.items` JSONB and persist through the
entire workflow. DoubleCheckView renders problem items in red with badges (UNREG,
LOW STOCK) and shows real stock from DB via server-side query.

**Note:** Flags are NOT recalculated when entering double check — they reflect the
state at order creation / start picking time. Stock may have changed since then.
The `insufficient_stock` flag is cleared when the checker adjusts the quantity.

**Test order:** `TEST-001` is a manually-created order in `double_checking` status
with explicit flags for testing. Recreate with:
`supabase/seed_test_orders.sql` (requires `create_users.sql` first).

Items:

- `03-4614BK` — OK
- `03-4614ZZ` — `sku_not_found: true` (invented SKU variant)
- `03-9999XX` — `sku_not_found: true` (nonexistent, no alternatives)
- `03-3764BK` — `insufficient_stock: true` (requests 50, ~2 in stock)
- `03-4616ZR` — `sku_not_found: true` (invented variant of 4616)

### History: Inline correction (rejected 2026-04-01)

First attempt used inline Fix button + panel in DoubleCheckView. Rejected because:
qty started at 0, only 3 suggestions, no search, button was 8px. See git history
for details (`0d54948`, `27d2b8b`).

### Current implementation: Edit Order Mode

**Component:** `CorrectionModeView.tsx` (657 lines, refactored with shared sub-components)

**Access:** "Edit Order" banner always visible in DoubleCheckView. Shows issue count
if there are problems, otherwise neutral style. Opens full-screen overlay (`z-30`).

**Layout:**

- Header: "Edit Order" + order number
- Summary badge: "2 issues · 5 items total" or "No issues · 3 items total"
- Problem items listed first (red SKU, UNREG/LOW STOCK badges)
- Divider "Other Items"
- Normal items listed below (white SKU, no badges)
- [+ Add Item] button at bottom

**Actions available on ALL items (problem and normal):**

- **Replace** — search panel with `findSimilarSkus()` suggestions + full server-side
  search (bikes + parts in parallel via `inventoryApi.fetchInventoryWithMetadata`).
  Selecting a result shows confirmation with qty input (defaults to original qty).
- **Adjust Qty** — numeric input with auto-select. Shows "Ordered: N | Available: N"
  (stock queried from DB). No artificial limits — user enters what they actually have.
- **Remove** — inline confirmation ("Remove SKU from order?")

**Add Item flow:**

- [+ Add Item] opens search panel (same server-side search)
- Select result → qty input → "Add to Order"
- If SKU already in cart, quantities merge
- Logged as "Extra item: SKU, qty N"

**Data flow:**

1. User action → `onCorrectItem(CorrectionAction)` → `handleCorrectItem` in PickingCartDrawer
2. Updates `picking_lists.items` in DB via Supabase
3. Updates local `cartItems` state via `setCartItems` (bypasses mode guards)
4. Logs action to `picking_list_notes`
5. Toast confirmation
6. Realtime subscription propagates to other clients

**CorrectionAction types:**

```typescript
type CorrectionAction =
  | { type: 'swap'; originalSku; replacement: { sku; location; warehouse; item_name } }
  | { type: 'adjust_qty'; sku; newQty }
  | { type: 'remove'; sku }
  | { type: 'add'; item: { sku; location; warehouse; item_name; pickingQty } };
```

### Rules

- Edit Order is accessible for ANY order in double check, not just those with problems
- **⚠️ EN PROCESO:** Edit Order será accesible también desde picking mode (no solo double check)
- All corrections are logged in picking_list_notes with descriptive messages
- The checker never leaves the double check flow (status stays `double_checking`)
- `adjust_qty` clears the `insufficient_stock` flag
- `swap` clears both `sku_not_found` and `insufficient_stock` flags
- Added items get clean flags (`sku_not_found: false, insufficient_stock: false`)

### When to Use returnToPicker Instead

For cases where items need to be physically re-picked from the warehouse floor,
the checker uses "Return to Picker" with notes. The picker sees it in their queue.

## Workflow Lock

A boolean ref `isInWorkflowRef` in PickingContext prevents loadSession from
overwriting activeListId while a workflow function is executing.

Protected functions:

- generatePickingPath (sets activeListId after DB insert/update)
- ~~returnToBuilding (changes session state)~~ **⚠️ EN PROCESO: será eliminado**

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
- ~~returnToBuilding releases ALL siblings back to ready_to_double_check~~ **⚠️ EN PROCESO: será reemplazado por Edit Order**
- Deleting follows existing group dissolution logic

## Session Loading Priority (loadSession)

On app init / user login, loadSession loads the "best" session:

1. HIGHEST: double_checking where checked_by = user (resume verification)
2. SECOND: active or needs_correction where user_id = user (resume picking)
3. FALLBACK: localStorage cart data

Guard: if isInWorkflowRef is true, skip entirely.

## Auto-Cancel / Expiration

Current: 24hr total -> cancelled (⚠️ EN PROCESO: 15min building idle rule será eliminada con building mode)
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
