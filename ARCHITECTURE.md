# Project Architecture

> Last updated: 2026-03-20

## Overview

PickD (Roman Inv) is a multi-user inventory management and warehouse operations PWA. Built with React 19, TypeScript, and Supabase. Follows **Feature-Sliced Design (FSD)** for modularity.

## Directory Structure

### `src/features/`

Each folder is a self-contained business domain with its own `hooks/`, `components/`, and optionally `api/`, `context/`, `types.ts`.

| Feature | Purpose | Key files |
|---------|---------|-----------|
| **inventory/** | Stock management, CRUD, location capacity | `useInventoryData.ts`, `useInventoryMutations.ts`, `useInventoryLogs.ts`, `useLocationManagement.ts`, `useOptimizationReports.ts` |
| **picking/** | Order fulfillment lifecycle | `usePickingActions.ts` (claim, ready, double-check, complete), `usePickingNotes.ts`, `CorrectionNotesTimeline.tsx` |
| **smart-picking/** | AI invoice scanning, palletization, route optimization | `useOrderProcessing.ts`, `MapBuilder.tsx`, `CamScanner.tsx` |
| **warehouse-management/** | Zone configuration (HOT/WARM/COLD) | Zone editor components |
| **settings/** | App configuration, AI keys, warehouse map | Settings screen |

### `src/context/`

- `AuthContext.tsx` — Supabase auth session
- `PickingContext.tsx` — Active picking session state (shared across picking components)

### `src/components/`

Shared UI components (feature-agnostic):
- `SearchInput.tsx` — Global search
- `ConfirmationModal.tsx` — Standardized dialogs
- `AutocompleteInput.tsx` — Smart autocomplete with metadata (SKU shows qty + location; Location shows item count)
- `orders/PalletLabelsPrinter.tsx` — Shipping label generation with order number, items, weights

### `src/schemas/`

Zod validation schemas. **Must match DB columns exactly.**
- `inventory.schema.ts` — Inventory items, locations, `weight_lbs`
- `skuMetadata.schema.ts` — SKU metadata including weight
- `picking.schema.ts` — Picking list types and statuses

### `src/utils/`

- `pickingLogic.ts` — Path optimization algorithm and palletization (max 13 items, footprint calculation)

### `src/services/`

- `aiScanner.ts` — Multi-provider AI integration (Gemini primary, OpenAI fallback)

### `supabase/`

- `migrations/` — PostgreSQL migrations (source of truth for schema)
- `functions/` — Edge functions (daily snapshots, reports, auto-cancel)

### `scripts/`

- `sync-skills.ps1` — Sync AI skills from `my-agent-skills` repo
- `compare-schemas.js` — Detect local↔prod schema drift
- `sync-local-db.sh` — Pull production data to local

## Core Workflows

### 1. Inventory Mutations (Optimistic Updates)

1. UI updates immediately (0ms latency)
2. RPC call to Supabase (`adjust_inventory_quantity`, `move_inventory_stock`)
3. On failure → automatic rollback to previous state
4. Undo available via `undo_inventory_action` RPC (inventory movements only, not picking)

### 2. Picking Lifecycle

```
idle (UI) → building (UI-only, carrito local, no DB record)
  → active (primer insert en DB via generatePickingPath)
    → ready_to_double_check (esperando verificador)
      → double_checking (verificador trabajando)
        → completed       (terminal — deducción server-side)
        → needs_correction → active (loop con notas de corrección)
      → cancelled         (terminal — manual o auto-cancel)
```

**6 estados en DB:** `active`, `ready_to_double_check`, `double_checking`, `needs_correction`, `completed`, `cancelled`.
`building` es solo estado de UI (carrito en memoria, sin registro en DB).

**Auto-cancel:** building >15min idle, verificación >24hrs sin actividad → `cancelled` + inventario liberado.

- **claimAsPicker**: Transfers order ownership from automation account to human picker
- **Triple-layer protection** prevents completed orders from being reverted (DB filter + UI guard + Realtime sync)
- **Picking notes**: Attach correction notes with timeline audit trail (`needs_correction` loop)
- **Server-side deduction**: `process_picking_list` RPC ensures no race conditions

### 3. Smart Picking (AI)

1. User scans invoice → Gemini extracts SKUs + quantities
2. System validates against inventory in both warehouses
3. If SKU exists in Ludlow AND ATS → warehouse selection modal
4. `processOrder(items, warehousePreferences)` applies selections
5. Items split into pallets (max 13) with route optimization
6. Labels printed via `PalletLabelsPrinter` with weight data

### 4. Weight System

- `weight_lbs` field on inventory items and SKU metadata
- Inline editing in inventory modal
- Integrated into pallet labels for shipping

## Technical Standards

- **Framework**: React 19 with `useMemo`, `useCallback` for optimization
- **Styling**: Tailwind CSS with custom "iOS Glass" design system
- **Database**: Supabase PostgreSQL with Realtime on all major tables, RLS enabled
- **Types**: 100% TypeScript strict mode, no `any`
- **No cross-feature imports** — share via context or utils
- **Git**: Separate commands (no `&&` chaining) for PowerShell compatibility

## Lessons Learned

### Completed Order Regression (2026-03-08)
Users could revert finished orders. Fixed with triple-layer protection: DB `.neq('status', 'completed')` filter, UI button hidden, Realtime `resetSession()`.

### RPC Argument Mismatch
Frontend passing removed parameters caused 400 errors. **Rule**: Always verify `v_` parameter names match the Postgres function signature.

### Schema Drift: `sku_note` → `item_name` (2026-03-09)
Four RPCs referenced a renamed column. **Rule**: Before any column rename, audit all RPCs with `SELECT proname FROM pg_proc WHERE pg_get_functiondef(oid) LIKE '%column_name%'`.

### Z-Index on Mobile
Order dropdown hidden by `overflow-hidden` header. Fixed by removing overflow constraint and boosting z-index to 110.
