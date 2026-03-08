# Project Architecture & Documentation

## Overview
Roman Inv is an inventory management PWA built with React 19, TypeScript, and Supabase. It follows a **Feature-Sliced Design (FSD)** inspired architecture to ensure modularity and scalability.

## Directory Structure

### `src/features/`
This is the heart of the application. Each folder represents a distinct business domain.
- **`inventory/`**: Logic for managing stock, editing items, and location Capacity.
  - `hooks/useInventoryData.ts`: Core data fetching using React Query.
  - `hooks/useInventoryMutations.ts`: Inventory operations (Add, Edit, Move, Delete).
- **`picking/`**: Manages the order fulfillment process.
  - `context/PickingContext.tsx`: Manages the active picking session state.
  - `hooks/usePickingActions.ts`: Business logic for transitions (Ready -> Double Check -> Completed).
- **`smart-picking/`**: AI features (Gemini/OpenAI) for invoice processing.
- **`warehouse-management/`**: 3D Visualization of the warehouse and zone configuration.

### `src/context/`
Global contexts that provide shared state across multiple features.
- `AuthContext.tsx`: Supabase authentication session management.
- `PickingContext.tsx`: (Redirects to internal feature context) Manages active order state.

### `src/components/`
Reusable UI components that are agnostic to specific business logic.
- `SearchInput.tsx`: Global search component used across the app.
- `ConfirmationModal.tsx`: Standardized confirmation dialogs.

### `src/schemas/`
Zod validation schemas used for both frontend forms and backend data integrity.
- `inventory.schema.ts`: Unified schema for inventory items and locations.

### `src/utils/`
Stateless utility functions.
- `pickingLogic.ts`: Algorithms for path optimization and palletization.

## Core Workflows

### 1. Inventory Mutation Flow
The system uses **Optimistic Updates** via React Query. When a user adjusts stock:
1. The UI updates immediately (0ms latency).
2. An RPC call (`adjust_inventory_quantity`) is sent to Supabase.
3. If the call fails, the UI rolls back to the previous state automatically.

### 2. Picking & Verification
1. **Building**: User adds items to a cart.
2. **Ready**: Order is locked in the database with status `ready_to_double_check`.
3. **Double Check**: Another user (or the same) verifies the physical items.
4. **Completion**: Inventory is deducted server-side via `process_picking_list` to prevent race conditions.

## Technical Standards
- **Framework**: React 19 (using `useMemo`, `useCallback` for optimization).
- **Styling**: Tailwind CSS with a custom "iOS Glass" design system.
- **Database**: Supabase PostgreSQL with Realtime enabled for all major tables.
- **Types**: 100% TypeScript. Avoid `any` where possible.
