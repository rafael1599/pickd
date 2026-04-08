/**
 * Mutation Registry — TanStack-canonical offline mutation persistence.
 *
 * When mutations are serialized to IndexedDB, their `mutationFn` is lost
 * (functions can't be serialized). On hydration, `setMutationDefaults`
 * re-attaches the correct function so `resumePausedMutations()` works.
 *
 * Each mutation's variables must be self-contained — closures don't survive
 * serialization. We use a `_ctx` field in variables to carry user context.
 */
import { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { inventoryService } from '../features/inventory/api/inventory.service';
import { type InventoryItem, type InventoryItemInput } from '../schemas/inventory.schema';

// ─── Types ────────────────────────────────────────────────────────────

/** User context that travels WITH the mutation variables for hydration safety. */
export interface MutationUserContext {
  performed_by: string;
  user_id?: string;
  user_role: string;
}

// ─── Registry ─────────────────────────────────────────────────────────

/**
 * Registers `setMutationDefaults` for every inventory mutation key.
 * Must be called ONCE before PersistQueryClientProvider renders,
 * so that hydrated mutations from IndexedDB can find their `mutationFn`.
 */
export function registerMutationDefaults(queryClient: QueryClient): void {
  // ── updateQuantity (RPC-based) ────────────────────────────────────
  queryClient.setMutationDefaults(['inventory', 'updateQuantity'], {
    mutationFn: async (vars: {
      sku: string;
      resolvedWarehouse: string;
      location?: string;
      finalDelta: number;
      listId?: string;
      orderNumber?: string;
      _ctx?: MutationUserContext;
    }) => {
      console.log(
        `[MutationRegistry][updateQuantity] Executing resumed mutation for SKU: ${vars.sku}`,
        vars
      );
      const ctx = vars._ctx;
      const { data, error } = await supabase.rpc('adjust_inventory_quantity', {
        p_sku: vars.sku,
        p_warehouse: vars.resolvedWarehouse,
        p_location: vars.location || '',
        p_delta: vars.finalDelta,
        p_performed_by: ctx?.performed_by || 'System (resumed)',
        p_user_id: ctx?.user_id || '',
        p_user_role: ctx?.user_role || 'staff',
        p_list_id: vars.listId,
        p_order_number: vars.orderNumber,
      });
      if (error) {
        console.error(`[MutationRegistry][updateQuantity] RPC Error for SKU: ${vars.sku}`, error);
        throw error;
      }
      console.log(`[MutationRegistry][updateQuantity] RPC Success for SKU: ${vars.sku}`, data);
      return data;
    },
  });

  // ── addItem (service-based) ───────────────────────────────────────
  queryClient.setMutationDefaults(['inventory', 'addItem'], {
    mutationFn: async (vars: {
      warehouse: string;
      newItem: InventoryItemInput & { isReversal?: boolean; force_id?: string | number };
      _ctx?: MutationUserContext;
    }) => {
      const ctx = vars._ctx;
      // Service addItem accepts (warehouse, newItem, locations, serviceContext)
      // On hydration we don't have local `locations`, pass empty — service handles gracefully.
      return inventoryService.addItem(vars.warehouse, vars.newItem, [], {
        isAdmin: true, // conservative: allow the resumed mutation to complete
        userInfo: {
          performed_by: ctx?.performed_by || 'System (resumed)',
          user_id: ctx?.user_id,
        },
        trackLog: async () => null, // Logs already created optimistically; skip on resume
        onLocationCreated: () => {},
      });
    },
  });

  // ── updateItem (service-based) ────────────────────────────────────
  queryClient.setMutationDefaults(['inventory', 'updateItem'], {
    mutationFn: async (vars: {
      originalItem: InventoryItem;
      updatedFormData: InventoryItemInput & { isReversal?: boolean };
      _ctx?: MutationUserContext;
    }) => {
      const ctx = vars._ctx;
      return inventoryService.updateItem(vars.originalItem, vars.updatedFormData, [], {
        isAdmin: true,
        userInfo: {
          performed_by: ctx?.performed_by || 'System (resumed)',
          user_id: ctx?.user_id,
        },
        trackLog: async () => null,
        onLocationCreated: () => {},
      });
    },
  });

  // ── moveItem (service-based) ──────────────────────────────────────
  queryClient.setMutationDefaults(['inventory', 'moveItem'], {
    mutationFn: async (vars: {
      sourceItem: InventoryItem;
      targetWarehouse: string;
      targetLocation: string;
      qty: number;
      isReversal?: boolean;
      optimistic_id?: string;
      _ctx?: MutationUserContext;
    }) => {
      const ctx = vars._ctx;
      return inventoryService.moveItem(
        vars.sourceItem,
        vars.targetWarehouse,
        vars.targetLocation,
        vars.qty,
        {
          isAdmin: true,
          userInfo: {
            performed_by: ctx?.performed_by || 'System (resumed)',
            user_id: ctx?.user_id,
          },
          trackLog: async () => null,
          onLocationCreated: () => {},
        }
      );
    },
  });

  // ── deleteItem (RPC-based) ────────────────────────────────────────
  queryClient.setMutationDefaults(['inventory', 'deleteItem'], {
    mutationFn: async (vars: {
      warehouse: string;
      sku: string;
      location?: string | null;
      optimistic_id?: string;
      _itemId?: number; // Enriched at mutation time for hydration safety
      _ctx?: MutationUserContext;
    }) => {
      if (!vars._itemId) {
        // If we don't have the item ID (hydrated mutation), look it up
        const { data } = await supabase
          .from('inventory')
          .select('id')
          .eq('sku', vars.sku)
          .eq('warehouse', vars.warehouse)
          .eq('location', vars.location || '')
          .single();
        if (!data) throw new Error('Item not found for resumed deletion');
        vars._itemId = data.id;
      }

      const ctx = vars._ctx;
      const { error } = await supabase.rpc('delete_inventory_item', {
        p_item_id: vars._itemId,
        p_performed_by: ctx?.performed_by || 'System (resumed)',
        p_user_id: ctx?.user_id,
      });
      if (error) throw error;
      return true;
    },
  });

  // ── processPickingList (RPC-based) ────────────────────────────────
  queryClient.setMutationDefaults(['inventory', 'processPickingList'], {
    mutationFn: async (vars: {
      listId: string;
      palletsQty?: number;
      totalUnits?: number;
      _ctx?: MutationUserContext;
    }) => {
      const ctx = vars._ctx;
      const { data, error } = await supabase.rpc('process_picking_list', {
        p_list_id: vars.listId,
        p_performed_by: ctx?.performed_by || 'System (resumed)',
        p_user_id: ctx?.user_id,
        p_pallets_qty: vars.palletsQty,
        p_total_units: vars.totalUnits,
        p_user_role: ctx?.user_role || 'staff',
      });
      if (error) throw error;
      return data;
    },
  });

  // ── recompletePickingList (RPC-based) ─────────────────────────────
  queryClient.setMutationDefaults(['picking', 'recompleteList'], {
    mutationFn: async (vars: {
      listId: string;
      palletsQty?: number;
      totalUnits?: number;
      _ctx?: MutationUserContext;
    }) => {
      const ctx = vars._ctx;
      const { data, error } = await supabase.rpc('recomplete_picking_list', {
        p_list_id: vars.listId,
        p_performed_by: ctx?.performed_by || 'System (resumed)',
        p_user_id: ctx?.user_id || '',
        p_pallets_qty: vars.palletsQty,
        p_total_units: vars.totalUnits,
        p_user_role: ctx?.user_role || 'staff',
      });
      if (error) throw error;
      return data;
    },
  });

  // MutationRegistry: 7 defaults registered
}
