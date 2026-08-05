---
description: How to test and enforce Order Lifecycle Progress & Live Board Rules
---

# Order Lifecycle Progress & Live Board Workflow

This workflow documents the architectural rules, progress calculation rules, and test suites for Order Progress, `verified_item_keys`, and Live Board rendering in Pickd.

---

## 🚨 Critical Architectural Rules

### 1. Ready & Active Queue Orders
- Any order in status `'ready_to_double_check'` or `'active'` MUST return `progressPercent = 0%`.
- The progress bar on the Live Board card MUST remain **HIDDEN (0%)** until a verifier opens the order in `DoubleCheckView` and begins verifying items.
- Ingestion from Watcher / PDF / AS400 MUST NEVER display a progress bar on new queue cards.

### 2. Double-Checking Phase
- While in `status === 'double_checking'`, progress is calculated from `verified_item_keys` using flexible suffix matching (`-${sku}-${location}`).
- In-progress orders cap at a maximum of `95%` until all units are verified in `DoubleCheckView`.
- Once all units are verified in `DoubleCheckView` (`verifiedUnits >= totalUnits`), the progress bar reaches **100%**.

### 3. Combined / Group Orders (`group_id`)
- `mergeGroupOrders` resolves status using strict worst-case hierarchy: `needs_correction` > `double_checking` > `ready_to_double_check` > `active` > `completed`.
- A group order NEVER reads as `completed` unless **ALL** member orders are completed.
- When an order belongs to a group, `PickingCartDrawer` MUST update `verified_item_keys` atomically across all sibling orders (`.eq('group_id', groupId)`). Un-checked sibling orders MUST NOT inherit stale verified keys.

### 4. Real-time Synchronization
- `useDoubleCheckList` configures `staleTime: 0` so Supabase Postgres Realtime invalidations trigger instant UI refetches across all open browser windows.

---

## 🧪 Test Suites & Verification

### 1. Continuous Vitest Integration Tests
Automated regression test suite containing 6 scenarios across single, multi-pallet, and group orders.
- **Location**: `src/features/picking/components/board/__tests__/orderLifecycleMatrix.test.ts`
- **Execution Command**:
  ```bash
  npm test -- --run
  ```

### 2. Live Database Simulation Script
Standalone script to simulate and audit all 6 order types across all 6 lifecycle phases against database data.
- **Location**: `scripts/simulate_order_lifecycles.ts`
- **Execution Command**:
  ```bash
  npx tsx scripts/simulate_order_lifecycles.ts
  ```

### 3. Live Board Card Audit Script
Script to fetch all current cards on the Live Board and verify zero progress bar anomalies.
- **Location**: `scripts/verify_all_board_cards.ts`
- **Execution Command**:
  ```bash
  npx tsx scripts/verify_all_board_cards.ts
  ```
