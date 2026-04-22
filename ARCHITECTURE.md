# Project Architecture

> Last updated: 2026-04-16

## Overview

PickD (Roman Inv) is a multi-user inventory management and warehouse operations PWA. Built with React 19, TypeScript, and Supabase. Follows **Feature-Sliced Design (FSD)** for modularity. Shares its production database with **pickd-2d** (see `JAMIS/SHARED-DB-CONTRACT.md`).

## Directory Structure

### `src/features/`

Each folder is a self-contained business domain with its own `hooks/`, `components/`, and optionally `api/`, `context/`, `types.ts`.

| Feature                   | Purpose                                                           | Key files                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **auth/**                 | Login + Supabase session management                               | `LoginScreen.tsx`, `AuthContext`                                                                                                               |
| **inventory/**            | Stock CRUD, cycle counts, location capacity, photos               | `useInventoryData/Mutations/Logs.ts`, `useLocationManagement.ts`, `CycleCountHistoryScreen`, `StockCountScreen`, `ItemDetailView`, `PhotoHero` |
| **picking/**              | Order fulfillment lifecycle + Verification Board                  | `usePickingActions.ts`, `usePickingNotes.ts`, `ReasonPicker`, `components/board/*` (multi-zone kanban), `useWaitingConflicts`                  |
| **projects/**             | Task kanban (future / in_progress / done) + photo gallery         | `ProjectsScreen`, `useProjectTasks`, `useGalleryPhotos`, `useTaskPhotos`, `PhotoGallery`, `TaskDetailModal`, `TrashView`                       |
| **reports/**              | Daily Activity Report (manual + computed sections, public viewer) | `ActivityReportScreen`, `useActivityReport`, `useDailyReport`, `useSaveDailyReportManual`, `ActivityReportView`, `PickdReportViewer`           |
| **labels/**               | Label Studio for SKU labels with QR codes                         | `LabelStudioScreen`, `LabelGeneratorScreen`, `UnifiedLabelForm`, `HistoryMode`, `PublicTagView` (`asset_tags` table)                           |
| **fedex-returns/**        | FedEx return platform tracking with barcode scanner               | `useFedExReturns`, `useBarcodeScanner`                                                                                                         |
| **shopping-list/**        | Shared "things to buy" list with PDF export                       | `ShoppingListScreen`, `useShoppingList`, `generateShoppingListPdf.ts`                                                                          |
| **warehouse-management/** | Zone configuration (HOT / WARM / COLD)                            | Zone editor components                                                                                                                         |
| **settings/**             | App configuration, AI keys, warehouse map                         | Settings screen                                                                                                                                |

### `src/context/`

- `AuthContext.tsx` — Supabase auth session
- `PickingContext.tsx` — Active picking session state (shared across picking components)
- `ModalContext` — Modal Manager (`useModal()` + `ModalProvider` in LayoutMain). All critical modals must register here. See `docs/modal-pattern.md`.

### `src/components/`

Shared UI components (feature-agnostic):

- `SearchInput.tsx` — Global search
- `ConfirmationModal.tsx` — Standardized dialogs
- `AutocompleteInput.tsx` — Smart autocomplete with metadata (SKU shows qty + location; Location shows item count)
- `orders/PalletLabelsPrinter.tsx` — Shipping label generation with order number, items, weights
- `StagingBanner.tsx` — Yellow "STAGING" banner shown automatically on non-prod hostnames

### `src/schemas/`

Zod validation schemas. **Must match DB columns exactly** (source of truth: `supabase/migrations/`).

### `src/integrations/supabase/types.ts` and `src/lib/database.types.ts`

Generated types from the live DB schema. Regenerate after every migration.

### `src/utils/`

- `pickingLogic.ts` — Path optimization algorithm and palletization (max 13 items, footprint calculation)
- `distributionCalculator.ts` — Smart bike SKU distribution (`isBikeSku()`, `calculateBikeDistribution()`): TOWER×30, LINE×5, LINE×remainder
- `photoUpload.service.ts` — `compressImage()` (1200px + 200px thumbnail, WebP) before upload to R2

### `supabase/`

- `migrations/` — PostgreSQL migrations (source of truth for schema)
- `functions/` — Edge functions:
  - `upload-photo` — R2 upload with internal JWT validation (gateway must use `verify_jwt = false`)
  - `cleanup-gallery-trash` — Daily purge of soft-deleted photos past 14-day window (06:00 UTC)
  - `daily-snapshot` — Inventory snapshot for accuracy tracking
  - `daily-report-snapshot` — Activity Report snapshot at 05:15 UTC
  - `auto-cancel-orders` — Cancels stale picking lists
  - `manage-users` — Admin user management

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

`inventory.sublocation` (idea-024): position within a ROW (A–F). CHECK constraints `^[A-Z]{1,3}$` and only for `location ILIKE 'ROW%'`. Auto-cleared to NULL on move to non-ROW.

### 2. Picking Lifecycle

```
idle (UI) → active (DB — generatePickingPath, reserves stock)
  → ready_to_double_check → double_checking
    → completed (terminal) | needs_correction → active (loop)
  → cancelled (terminal — manual or auto-cancel)
completed → reopened (Reopen Order — requires reason)
  → completed (re-complete with inventory delta) | cancelled (cancel reopen — restore snapshot)
```

**7 DB states:** `active`, `ready_to_double_check`, `double_checking`, `needs_correction`, `completed`, `cancelled`, `reopened`. Completed orders have triple-layer protection (DB filter + UI guard + Realtime sync). Reopened orders carry a snapshot for delta calculation and auto-cancel after 2h if abandoned.

`building` mode was removed (idea-032). `OrderBuilderMode`, `PickingSessionView`, and `returnToBuilding()` are gone — Edit Order mode (CorrectionModeView) replaces them. InventoryCards show inline +/- in picking mode.

**Corrections with reason (idea-043):** All correction actions (remove, swap, adjust_qty, add) require a reason via `ReasonPicker`. Notes are auto-formatted ("Removed SKU: Out of stock"). `CorrectionAction.reason?: string`. Items with `insufficient_stock` pre-select "Out of stock".

**Long-Waiting Orders (idea-053):** Orders awaiting inventory (days/weeks/months) live in `needs_correction` with `is_waiting_inventory = true`. Admin toggles via `mark_picking_list_waiting` / `unmark_picking_list_waiting` RPCs. Verification queue hides them by default. Cross-customer SKU conflicts detected on DoubleCheckView open (`useWaitingConflicts`) and resolved via `take_over_sku_from_waiting` RPC or by editing the order.

**Verification Board (idea-055):** Full-screen overlay with multi-zone kanban — Priority (auto by status), FedEx/Regular lanes (drag to reclassify `shipping_type`), In Progress Projects (read-only), Recently Completed (drag = reopen), Waiting (collapsible). Auto-classification: item >50 lbs or ≥5 items → Regular, else → FedEx. `shipping_type` column on `picking_lists` (NULL = auto). Components in `src/features/picking/components/board/`.

### 3. Weight System

- `weight_lbs` field on inventory items and SKU metadata
- Inline editing in inventory modal
- Integrated into pallet labels for shipping

### 4. Photo System (R2 + Edge Functions)

- **Storage:** Cloudflare R2 (`inventory-jamisbikes` bucket)
- **Two modes:** SKU photos (`photos/{sku}.webp`) and gallery photos (`photos/gallery/{uuid}.webp`)
- **Edge function:** `upload-photo` validates JWT internally — Supabase gateway must have `verify_jwt = false` in `supabase/config.toml`
- **Client compression:** `compressImage()` in `photoUpload.service.ts` (1200px main + 200px thumbnail, WebP)
- **Gallery photos** can be assigned to tasks via drag-and-drop (many-to-many via `task_photos` junction)
- **Soft delete** with 14-day trash window; `cleanup-gallery-trash` cron at 06:00 UTC

### 5. Daily Activity Report

- **Two layers:** snapshot (`daily_reports.data_manual` + `data_computed`) and live queries (tasks + photos)
- **Tasks reconstructed historically** via `task_state_changes` audit log (NY timezone bounds)
- **Photos shown inline** as thumbnails per task
- **Cron snapshot** at 05:15 UTC via `daily-report-snapshot` edge function
- **Public viewer:** `/pickd-report` route serves prebuilt HTML reports from `public/reports/daily/` via iframe

### 6. Label Studio (asset_tags)

- Per-unit physical traceability for bikes (PK-000001 sequence)
- QR encoding: `short_code|sku`
- Lifecycle: `printed` → `in_stock` → `allocated` → `picked` → `shipped` (or `lost`)
- 4×6" landscape labels with Side A/B
- `move_inventory_stock` keeps `possible_locations text[]` in sync

## Technical Standards

- **Framework:** React 19 with `useMemo`, `useCallback` for optimization
- **Styling:** Tailwind CSS with custom "iOS Glass" design system
- **Database:** Supabase PostgreSQL with Realtime on all major tables, RLS enabled
- **Types:** 100% TypeScript strict mode, no `any`
- **No cross-feature imports** — share via context or utils
- **Modals:** Always via Modal Manager (`useModal()`); never inline-owned by the caller
- **PostgREST selects:** Verify every column in explicit `.select()` exists in prod (HTTP 400 otherwise)
- **New DB columns:** Update 4 places — migration, Zod schema, generated types, query selects
- **Tests:** Run `pnpm vitest run` before every deploy
- **Git:** Separate commands (no `&&` chaining) for PowerShell compatibility
- **Branches:** `main` → prod (`roman-app.vercel.app`), `develop` → preview (shares prod DB; migrations must be additive)

## Lessons Learned

### Completed Order Regression (2026-03-08)

Users could revert finished orders. Fixed with triple-layer protection: DB `.neq('status', 'completed')` filter, UI button hidden, Realtime `resetSession()`.

### RPC Argument Mismatch

Frontend passing removed parameters caused 400 errors. **Rule:** Always verify `v_` parameter names match the Postgres function signature.

### Schema Drift: `sku_note` → `item_name` (2026-03-09)

Four RPCs referenced a renamed column. **Rule:** Before any column rename, audit all RPCs with `SELECT proname FROM pg_proc WHERE pg_get_functiondef(oid) LIKE '%column_name%'`.

### Z-Index on Mobile

Order dropdown hidden by `overflow-hidden` header. Fixed by removing overflow constraint and boosting z-index to 110.

### Function Overload Ambiguity (2026-03-25)

`CREATE OR REPLACE FUNCTION` with a new parameter creates a **second** function (overload) instead of replacing. **Rule:** Always `DROP FUNCTION IF EXISTS` with the old signature before `CREATE OR REPLACE` when adding/removing parameters.

### Realtime Race Conditions in Long Workflows (2026-04-13)

Long-Waiting Orders sometimes had cross-customer SKU conflicts when a SKU was reserved for waiting order A but a new order B needed it. Solved with `WaitingConflictModal` that detects conflicts at DoubleCheckView open time and offers Take Over / Edit Order / Proceed Anyway.

### Edge Function JWT Verification (2026-04-15)

`upload-photo` does its own JWT validation via `supabase.auth.getUser(token)`. Supabase's gateway also verifies JWTs by default, causing double-verification 401s. After the first incident (gallery photos saving as blob URLs because uploads failed silently), set `verify_jwt = false` in `supabase/config.toml` and always deploy with the flag preserved. See CLAUDE.md "Fotos (R2 + Edge Functions)".

### Sortable DnD Glitches (2026-04-15)

`@dnd-kit/sortable`'s drop animation caused visible "round trip" movement on drop. Switched to plain `useDraggable` + `useDroppable` with custom drop indicators (line above/below cards) and instant DOM reordering. No animations on drop = no glitches.
