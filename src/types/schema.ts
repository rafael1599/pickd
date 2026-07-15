import type { Database } from '../integrations/supabase/types';

/**
 * Convenience helper to extract the type of a specific table row from the public schema.
 */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

/**
 * Convenience helper to extract the insert type for a specific table.
 */
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];

/**
 * Convenience helper to extract the update type for a specific table.
 */
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];

/**
 * Convenience helper for public enums.
 */
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T];

// --- Specific Domain Aliases ---

export type Profile = Tables<'profiles'>;
export type Inventory = Tables<'inventory'>;
export type InventoryLog = Tables<'inventory_logs'>;
export type PickingList = Tables<'picking_lists'>;

export type Location = Tables<'locations'>;
export type SKUMetadata = Tables<'sku_metadata'>;
export type Customer = Tables<'customers'>;
