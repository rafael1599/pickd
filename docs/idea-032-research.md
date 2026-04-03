# idea-032 Research: Eliminate Building Mode + Unified Order View

> Date: 2026-04-03
> Status: Research complete, plan audited

## Vision

- InventoryCards show +/- controls inline when items are in cart (no drawer for qty edits)
- DoubleCheckView becomes THE order view (building + verification unified)
- Floating button (PickingCartDrawer) always opens DoubleCheckView, adapts by status:
  - `active`: Edit Order available + "Send to Verify" CTA
  - `double_checking`: checkboxes + "Complete" CTA (as today)
  - `needs_correction`: correction notes + Edit Order
- PickingSessionView eliminated entirely
- OrderBuilderMode eliminated entirely
- checkOrderAvailability moves to SessionInitializationModal
- PDF generation moves to Orders screen (picking summary)
- Correction notes banner moves to DoubleCheckView

## Audit Results

Of 10 PickingSessionView features, only 4 need relocation:

| Feature | Destination | Effort |
|---------|-------------|--------|
| markAsReady (Send to Verify) | DoubleCheckView footer (status=active) | Medium |
| Correction notes banner | DoubleCheckView (status=needs_correction) | Low (30 lines) |
| checkOrderAvailability | SessionInitializationModal | Low |
| PDF generation | Orders screen picking summary | Deferred (already exists in Orders) |

Already covered: pallet viz, cancel order, order/customer edit, +/- controls (via Edit Order + inline cards)
Eliminated: OrderBuilderMode, returnToBuilding, building mode state

## PickingSessionView Dependency Map

### Only imported by: PickingCartDrawer.tsx (line 4, rendered at line 525)

### Functionality inventory

| Feature | Lines | In DoubleCheckView? | Action |
|---------|-------|---------------------|--------|
| Pallet visualization with items | 531-689 | Yes (567-751, different UX) | Already covered |
| Qty +/- controls on items | 628-676 | No (has checkbox toggle) | Edit Order covers this |
| Order number edit + validation | 195-271 | No | Move to generatePickingPath or SessionInitModal |
| Customer name edit | 281-294 | No | Move to Orders sidebar or inline in DoubleCheckView |
| PDF generation trigger | 483-489 | No | Move to Orders screen (picking summary) |
| finalSequence computation | 296-316 | No | Rebuild in Orders if PDF needed there |
| Return to Building button | 390-396 | No | Eliminated (Edit Order replaces) |
| Correction notes timeline | 500-529 | No | Move to DoubleCheckView |
| SlideToConfirm "Send to Verify" | 694-699 | No | Move to DoubleCheckView or summary bar |
| Cancel order (deleteList) | 462-481 | Yes (DoubleCheckHeader L309-321) | Already covered |
| OrderBuilderMode conditional | 323-380 | No | Eliminated |

### Critical functions to preserve

1. **markAsReady()** (usePickingActions.ts L127-302)
   - Validates stock against all active orders
   - Calculates pallets
   - Updates DB: active → double_checking
   - Auto-assigns checked_by = current user
   - Returns listId, transitions to double_checking mode
   - MUST be accessible from DoubleCheckView or summary bar

2. **checkOrderAvailability()** (PickingSessionView L195-248)
   - Checks if order # is already taken by another picker
   - Offers takeover with confirmation
   - Currently runs before markAsReady
   - SHOULD move to generatePickingPath (runs at order creation)

3. **generatePickingPdf()** (pickingPdf.ts L4-132)
   - Creates picking list PDF from finalSequence
   - Used for printing in warehouse
   - BETTER FIT: Orders screen → picking summary tab

4. **Correction notes display** (PickingSessionView L500-529)
   - Shows previous rejection notes from verifier
   - Picker needs this context
   - MUST move to DoubleCheckView when status = needs_correction

## InventoryCard Analysis

### Current state
- File: src/features/inventory/components/InventoryCard.tsx
- Props: sku, quantity, location, onIncrement, onDecrement, onMove, onClick, mode, available, reservedByOthers, etc.
- Does NOT know if item is in cart
- Cart awareness is in InventoryScreen wrapper div (ring-1 ring-accent)
- Touch targets: 36px (below 44px minimum)

### What needs to change
- New props: isInCart, cartQty, onUpdateCartQty, onRemoveFromCart
- "Add" morphs to stepper [−] [qty] [+] on first tap
- In-cart visual: accent border + background tint
- Touch targets: increase to 44px minimum
- Cart matching: sku + warehouse + location (same SKU in different ROWs = separate items)

### Cart data flow today
```
PickingContext stores cartItems
  → usePickingSession() provides cartItems, addToCart, removeFromCart, updateCartQty
  → InventoryScreen reads cartItems to compute isInCart boolean
  → InventoryCard has zero cart awareness (only gets ring on wrapper div)
```

### addToCart validation (usePickingCart L83-141)
- building mode: available = total physical stock (ignores reservations)
- picking mode: available = stock - reservedByOthers
- Blocks if stock <= 0 or fully reserved
- Checks currentInMyCart + 1 > available

### getAvailableStock (usePickingCart L144-161)
- Returns: available, reservedByOthers, totalStock, inMyCart
- Key format: `${sku}|${warehouse}|${location}`

## PickingCartDrawer Analysis

### Current behavior
- Collapsed: floating button at bottom with session text + unit count
  - building: "Reviewing X SKUs" (slate bg)
  - picking: "X Units to Pick" (accent bg)
  - double_checking: "Verifying #ORDER" (orange bg)
- Expanded: renders PickingSessionView OR DoubleCheckView based on currentView

### What changes
- Collapsed button → sticky summary bar (full width, count + CTA)
- Expanded picking view → DoubleCheckView (unified)
- PickingSessionView no longer rendered

## Industry Best Practices

### 1. Button morph (Instacart, Ocado, Amazon Fresh)
"Add" transforms to inline stepper [−][qty][+] on first tap. No navigation, no modal.

### 2. Single-view order building (B2B wholesale)
Same layout for building and reviewing. Filtered to qty > 0 for review mode.
Sticky footer: item count + total qty + "Review Order" CTA.

### 3. Sticky summary bar replaces FAB
Full-width bottom bar with count + CTA. Better than floating button (no content occlusion, shows info).

### 4. Touch targets 44px minimum (Apple HIG, NNGroup)
Current stepper buttons are 36px. Must increase for gloved warehouse use.

### 5. Visual hierarchy for card states
- Default: normal card, "Add" visible
- In-order: accent border, stepper visible, subtle bg tint
- Out of stock: dimmed, dashed border
- Fully reserved: red, disabled
- Picked/Verified: checkmark overlay

### 6. Optimistic updates
+/- must update instantly. Cancel in-flight queries on mutation start.

### 7. Correction notes visibility
When order comes back from verification with notes, picker must see rejection context.

## Database Dependencies

### building is NEVER in DB
- CHECK constraint on picking_lists.status: active, ready_to_double_check, double_checking, needs_correction, completed, cancelled
- building only exists in frontend (localStorage + React state)
- RPC auto_cancel_stale_orders references building but it's dead code (CHECK would prevent insert)
- Index idx_picking_lists_last_activity includes building — dead code

### Dead SQL to clean
1. auto_cancel_stale_orders: remove building block (L166-179 in initial migration)
2. Index: remove building from WHERE clause

## Files Involved (Complete List)

### To eliminate
- OrderBuilderMode.tsx (218 lines)
- PickingSessionView.tsx (703 lines) — after moving needed logic

### To modify heavily
- PickingCartDrawer.tsx — remove PickingSessionView render, change to DoubleCheckView
- InventoryCard.tsx — add cart-aware controls
- InventoryScreen.tsx — pass cart state to cards
- DoubleCheckView.tsx — add correction notes, markAsReady CTA
- PickingContext.tsx — remove building from sessionMode, remove returnToBuilding

### To modify lightly
- usePickingCart.ts — remove building-specific stock logic
- usePickingSync.ts — remove building guard
- usePickingActions.ts — remove returnToBuilding, move checkOrderAvailability
- ViewModeContext.tsx — remove building from ViewMode type

### To clean (DB)
- 1 migration: clean auto_cancel RPC + index dead code

### Tests
- generatePickingPath.test.ts — update mock sessionMode
- correctionActions.test.ts — should still pass (no building refs)
