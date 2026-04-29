import { supabase } from '../../../lib/supabase';
import { BaseService, AppError } from '../../../services/base.service';
import {
  InventoryItemSchema as inventorySchema,
  type InventoryItem as InventoryModel,
  InventoryItemInputSchema,
  type InventoryItemInput,
  type DistributionItem,
} from '../../../schemas/inventory.schema';
import { type Location } from '../../../schemas/location.schema';
import { type InventoryLogInput } from '../../../schemas/log.schema';
import { type Database } from '../../../integrations/supabase/types';
import { type z } from 'zod';

/** DB-level Update type for the inventory table */
type InventoryUpdate = Database['public']['Tables']['inventory']['Update'];

export interface InventoryServiceContext {
  isAdmin: boolean;
  userInfo: { performed_by: string; user_id?: string };
  trackLog: (
    logData: InventoryLogInput,
    userInfo: { performed_by: string; user_id?: string }
  ) => Promise<string | null>;
  onLocationCreated?: (newLoc: Location) => void;
}

interface ResolvedLocation {
  name: string;
  id: string | null;
  isNew: boolean;
}

/**
 * Service to handle inventory-specific business logic.
 * Extends BaseService to inherit standard CRUD operations.
 */
class InventoryService extends BaseService<
  'inventory',
  InventoryModel,
  InventoryItemInput,
  InventoryItemInput
> {
  constructor() {
    super(supabase, 'inventory', () => ({ schema: inventorySchema as z.ZodType<InventoryModel> }));
  }

  /**
   * Logs individual PHYSICAL_DISTRIBUTION entries for each distribution row that changed.
   * Compares old vs new distribution arrays and fires one log per added/removed/modified row.
   */
  private async logDistributionChanges(
    oldDist: DistributionItem[],
    newDist: DistributionItem[],
    item: {
      id: number | string;
      sku: string;
      warehouse: string;
      location: string | null | undefined;
      location_id: string | null | undefined;
      quantity: number;
    },
    ctx: InventoryServiceContext
  ) {
    const { userInfo, trackLog } = ctx;
    const key = (d: DistributionItem) => `${d.type}|${d.count}|${d.units_each}|${d.label || ''}`;
    const oldKeys = new Map<string, DistributionItem>();
    oldDist.forEach((d) => oldKeys.set(key(d), d));
    const newKeys = new Map<string, DistributionItem>();
    newDist.forEach((d) => newKeys.set(key(d), d));

    // Collect changes: added rows (in new but not old), removed rows (in old but not new)
    const changes: { action: 'added' | 'removed'; row: DistributionItem }[] = [];
    for (const [k, row] of newKeys) {
      if (!oldKeys.has(k)) changes.push({ action: 'added', row });
    }
    for (const [k, row] of oldKeys) {
      if (!newKeys.has(k)) changes.push({ action: 'removed', row });
    }

    console.log(
      `[InventoryService] Distribution diff — old: ${JSON.stringify(oldDist)}, new: ${JSON.stringify(newDist)}, changes: ${changes.length}`
    );

    if (changes.length === 0) return;

    for (const change of changes) {
      console.log(
        `[InventoryService] Logging PHYSICAL_DISTRIBUTION: ${change.action} ${change.row.count} ${change.row.type} × ${change.row.units_each}u`
      );
      try {
        await trackLog(
          {
            sku: item.sku,
            from_warehouse: item.warehouse,
            from_location: item.location || undefined,
            to_warehouse: item.warehouse,
            to_location: item.location || undefined,
            quantity_change: 0,
            prev_quantity: item.quantity,
            new_quantity: item.quantity,
            action_type: 'PHYSICAL_DISTRIBUTION',
            item_id: String(item.id),
            location_id: item.location_id,
            snapshot_before: {
              change: change.action,
              type: change.row.type,
              count: change.row.count,
              units_each: change.row.units_each,
              label: change.row.label || null,
              distribution_before: oldDist,
              distribution_after: newDist,
            },
          },
          userInfo
        );
      } catch (logError) {
        console.warn(
          '[InventoryService] PHYSICAL_DISTRIBUTION log failed, but operation succeeded.',
          logError
        );
      }
    }
  }

  /**
   * Resolves a location name, mapping numeric inputs ("9") to standard format ("Row 9").
   * Encapsulated as private to preserve domain logic.
   */
  private resolveLocationName(
    locations: Location[],
    warehouse: string,
    inputLocation: string
  ): ResolvedLocation {
    if (!inputLocation || inputLocation.trim() === '') return { name: '', id: null, isNew: false };

    // Force UPPERCASE and TRIM
    const normalizedInput = inputLocation.trim().toUpperCase();

    // 1. Check if match exists (case-insensitive search, but we will return UPPERCASED)
    const exactMatch = locations.find(
      (l) => l.warehouse === warehouse && l.location.toUpperCase() === normalizedInput
    );

    if (exactMatch) {
      return { name: exactMatch.location.toUpperCase(), id: exactMatch.id, isNew: false };
    }

    // 2. Business Rule: Mapping numeric "9" to "ROW 9"
    const isNumeric = /^\d+$/.test(normalizedInput);
    if (isNumeric) {
      const rowLocation = `ROW ${normalizedInput}`;
      const rowMatch = locations.find(
        (l) => l.warehouse === warehouse && l.location.toUpperCase() === rowLocation
      );

      if (rowMatch) {
        return { name: rowMatch.location.toUpperCase(), id: rowMatch.id, isNew: false };
      }

      const existsInArray = locations.some(
        (l) => l.warehouse === warehouse && l.location.toUpperCase() === rowLocation
      );

      return { name: rowLocation, id: null, isNew: !existsInArray };
    }

    return { name: normalizedInput, id: null, isNew: true };
  }

  /**
   * Ensures a location exists, creating it if necessary with resilient race-condition handling.
   */
  private async ensureLocationExists(
    warehouse: string,
    locationName: string,
    locations: Location[],
    ctx: { isAdmin: boolean; onLocationCreated?: (newLoc: Location) => void }
  ): Promise<{ id: string | null; name: string }> {
    const { onLocationCreated } = ctx;

    const resolved = this.resolveLocationName(locations, warehouse, locationName);

    if (!resolved.isNew) {
      return { id: resolved.id, name: resolved.name };
    }

    // REMOVED STRICT CHECK: User requested removing overhead.
    // if (!isAdmin) {
    //     throw new AppError(`Unauthorized: Only administrators can create new locations ("${resolved.name}").`, 403);
    // }

    try {
      const { data: newLoc, error } = await this.supabase
        .from('locations')
        .insert([
          {
            warehouse,
            location: resolved.name,
            max_capacity: 550,
            zone: 'UNASSIGNED',
            is_active: true,
          },
        ])
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          // Unique Violation
          const { data: recoveredLoc } = await this.supabase
            .from('locations')
            .select('id')
            .eq('warehouse', warehouse)
            .eq('location', resolved.name)
            .single();

          if (recoveredLoc) {
            return { id: recoveredLoc.id, name: resolved.name };
          }
          throw error;
        }
        throw error;
      }

      if (newLoc) {
        if (onLocationCreated) onLocationCreated(newLoc as Location);
        return { id: newLoc.id, name: resolved.name };
      }
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : 'Failed to resolve location';
      const code = (err as { code?: string | number })?.code;
      throw new AppError(message, code ?? 500, err);
    }

    return { id: null, name: resolved.name };
  }

  /**
   * Orchestrates adding stock to a SKU, handling dynamic location creation and merges.
   */
  async addItem(
    warehouse: string,
    newItem: InventoryItemInput & { isReversal?: boolean; force_id?: string | number },
    locations: Location[],
    ctx: InventoryServiceContext
  ) {
    const { userInfo, trackLog } = ctx;

    // 1. Zod Validation (Includes Coercion for numbers)
    const validatedInput = InventoryItemInputSchema.parse(newItem);
    const qty = validatedInput.quantity;

    // 2. HARDENING: Resolve destination before touching stock
    const destination = await this.ensureLocationExists(
      warehouse,
      validatedInput.location || '',
      locations,
      ctx
    );

    // 3. Process Inventory Persistence (UPSERT logic via BaseService)
    const { data: existingItemData } = await this.supabase
      .from(this.table)
      .select('*')
      .eq('sku', validatedInput.sku)
      .eq('warehouse', warehouse)
      .eq('location', destination.name)
      .maybeSingle();

    if (existingItemData) {
      const existingItem = this.validate(existingItemData);
      const newTotal = (existingItem.quantity || 0) + qty;

      // Concatenated Description Merge: Join with ' | ' if both exist
      const incomingNote = validatedInput.item_name?.trim();
      const existingNote = existingItem.item_name?.trim();
      const updatedNote =
        incomingNote && existingNote && incomingNote !== existingNote
          ? `${existingNote} | ${incomingNote}`
          : incomingNote || existingNote;

      if (!existingItem.id || isNaN(Number(existingItem.id))) {
        console.error('Critical Error: Invalid ID on existing item during merge', { existingItem });
        throw new AppError(`Operation aborted: Invalid ID for consolidation.`, 400);
      }

      await this.update(existingItem.id, {
        quantity: newTotal,
        location_id: destination.id,
        item_name: updatedNote,
        is_active: newTotal > 0 ? true : existingItem.is_active, // Automatic Reactivation
      } as InventoryUpdate as InventoryItemInput);

      try {
        await trackLog(
          {
            sku: validatedInput.sku,
            from_warehouse: warehouse,
            from_location: destination.name,
            to_warehouse: warehouse,
            to_location: destination.name,
            quantity_change: qty, // New explicit delta
            prev_quantity: existingItem.quantity || 0,
            new_quantity: newTotal,
            action_type: 'ADD',
            item_id: String(existingItem.id),
            location_id: destination.id,
            snapshot_before: {
              id: existingItem.id,
              sku: existingItem.sku,
              quantity: existingItem.quantity,
              location_id: existingItem.location_id,
              location: existingItem.location,
              warehouse: existingItem.warehouse,
            },
            is_reversed: newItem.isReversal || false,
          },
          userInfo
        );
      } catch (logError) {
        console.warn(
          '[InventoryService] Log failed for existing item merge, but update succeeded.',
          logError
        );
      }

      return { action: 'updated', id: existingItem.id };
    }

    // 4. Prepare Cleanup
    const { isReversal: _IS_REV, force_id: _FORCE_ID, ...cleanInput } = validatedInput;

    const itemToInsert: InventoryItemInput & { id?: string | number; is_active?: boolean } = {
      ...cleanInput,
      warehouse: warehouse as InventoryItemInput['warehouse'],
      location: destination.name,
      location_id: destination.id,
      is_active: true,
      internal_note: validatedInput.internal_note || null,
      distribution: validatedInput.distribution || [],
    };

    if (newItem.force_id) {
      itemToInsert.id = newItem.force_id;
    }

    // 5. PRE-FLIGHT: Ensure SKU Metadata exists (Foreign Key Defense)
    // This is critical for non-admin users adding new SKUs, as they might skip UI metadata creation.
    try {
      const { data: meta } = await this.supabase
        .from('sku_metadata')
        .select('sku')
        .eq('sku', itemToInsert.sku)
        .maybeSingle();

      if (!meta) {
        console.log(
          `[InventoryService] SKU ${itemToInsert.sku} not found in metadata. Creating shell entry...`
        );
        // Default dims for unregistered SKUs: standard bike box ~55×8.5×30.5", 45 lbs.
        // e-bikes and children's bikes should be adjusted manually after ingest.
        await this.supabase.from('sku_metadata').upsert(
          [
            {
              sku: itemToInsert.sku,
              length_in: 55,
              width_in: 8.5,
              height_in: 30.5,
              weight_lbs: 45,
            },
          ],
          { onConflict: 'sku' }
        );
      }
    } catch (metaErr) {
      console.warn(
        '[InventoryService] Metadata pre-flight check failed, attempting insert anyway...',
        metaErr
      );
    }

    // 6. Insert New Item
    const inserted = await this.create(itemToInsert);

    console.log(`[InventoryService] Item ${newItem.force_id ? 'RESTORED' : 'CREATED'}:`, {
      sku: inserted.sku,
      UUID: inserted.id,
      isReversal: newItem.isReversal || false,
    });

    try {
      await trackLog(
        {
          sku: validatedInput.sku,
          from_warehouse: warehouse,
          from_location: destination.name,
          to_warehouse: warehouse,
          to_location: destination.name,
          quantity_change: qty,
          prev_quantity: 0,
          new_quantity: qty,
          action_type: 'ADD',
          item_id: String(inserted.id),
          location_id: destination.id,
          snapshot_before: null, // New item, no previous state
          is_reversed: newItem.isReversal || false,
        },
        userInfo
      );
    } catch (logError) {
      console.warn('[InventoryService] Log failed for new item, but creation succeeded.', logError);
    }

    return { action: 'inserted', id: inserted.id };
  }

  /**
   * Updates an inventory item, handling identity changes (merges) and quantity overrides.
   *
   * Hybrid Logic:
   * - Case A (In-place): Only quantity changes -> Overwrite (Input is absolute truth).
   * - Case B (Movement): SKU/Wh/Loc change + Collision -> Consolidate (Add origin to target) and Delete origin.
   */
  async updateItem(
    originalItem: InventoryModel,
    updatedFormData: InventoryItemInput & { isReversal?: boolean },
    locations: Location[],
    ctx: InventoryServiceContext
  ) {
    const { userInfo, trackLog } = ctx;

    // 1. Validate input
    const validatedInput = InventoryItemInputSchema.parse(updatedFormData);
    const newSku = validatedInput.sku;
    const targetWarehouse = validatedInput.warehouse;
    const newQty = validatedInput.quantity;

    // 2. Resolve target location
    const destination = await this.ensureLocationExists(
      targetWarehouse,
      validatedInput.location || '',
      locations,
      ctx
    );
    const targetLocation = destination.name;
    const targetLocationId = destination.id;

    // 3. Identity & Collision Detection
    const hasSkuChanged = newSku !== originalItem.sku;
    const hasTargetChanged =
      targetWarehouse !== originalItem.warehouse ||
      targetLocation.trim().toUpperCase() !== (originalItem.location || '').trim().toUpperCase();

    if (hasSkuChanged || hasTargetChanged) {
      // Check for collision at destination
      const { data: collisionData } = await this.supabase
        .from(this.table)
        .select('*')
        .eq('sku', newSku)
        .eq('warehouse', targetWarehouse)
        .eq('location', targetLocation)
        .neq('id', originalItem.id)
        .maybeSingle();

      if (collisionData) {
        // COLLISION DETECTED
        if (hasSkuChanged) {
          // CASE 1: ILLEGAL RENAME
          // Cannot rename to a SKU that already exists in the target location
          throw new AppError(
            `Cannot rename to "${newSku}" because that SKU already exists in ${targetLocation}. To merge, move the item instead of renaming.`,
            409
          );
        }

        // CASE 2: VALID MERGE (Location Change)
        const targetItem = this.validate(collisionData);
        const consolidatedQty = (targetItem.quantity || 0) + originalItem.quantity;

        // Concatenated Description Merge: Join with ' | ' if both exist
        const incomingNote = validatedInput.item_name?.trim();
        const existingNote = targetItem.item_name?.trim();
        const updatedNote =
          incomingNote && existingNote && incomingNote !== existingNote
            ? `${existingNote} | ${incomingNote}`
            : incomingNote || existingNote;

        if (!targetItem.id || isNaN(Number(targetItem.id))) {
          console.error('Critical Error: Invalid Target ID during collision merge', { targetItem });
          throw new AppError(`Operation aborted: Invalid destination ID.`, 400);
        }

        // Update Target (handles reactivation and normalization)
        await this.update(targetItem.id, {
          quantity: consolidatedQty,
          location_id: targetLocationId,
          item_name: updatedNote,
          is_active: consolidatedQty > 0 ? true : targetItem.is_active,
          distribution: validatedInput.distribution || [],
        } as InventoryUpdate as InventoryItemInput);

        // Check Zero Stock Persistence rule for origin
        // If we are merging, we effectively DELETE the origin.
        // In soft-delete mode, we should just set quantity to 0 and is_active to true?
        // No, a manual merge/move should probably deactivate the source if it's 0.
        await this.update(originalItem.id, {
          quantity: 0,
          is_active: true, // Keep persistent but with 0 stock
        } as InventoryUpdate as InventoryItemInput);

        // Log as MOVE (Merge)
        try {
          await trackLog(
            {
              sku: newSku,
              from_warehouse: originalItem.warehouse,
              from_location: originalItem.location || undefined,
              to_warehouse: targetWarehouse,
              to_location: targetLocation,
              to_location_id: targetLocationId,
              quantity_change: -originalItem.quantity, // Log as deduction from source
              prev_quantity: originalItem.quantity,
              new_quantity: 0,
              action_type: 'MOVE',
              item_id: String(originalItem.id), // Source is the primary subject for resurrection
              location_id: originalItem.location_id,
              snapshot_before: {
                id: originalItem.id,
                sku: originalItem.sku,
                quantity: originalItem.quantity,
                location_id: originalItem.location_id,
                location: originalItem.location,
                warehouse: originalItem.warehouse,
              },
              is_reversed: updatedFormData.isReversal || false,
            },
            userInfo
          );
        } catch (logError) {
          console.warn(
            '[InventoryService] Log failed for collision move, but operations succeeded.',
            logError
          );
        }

        // Log distribution changes (one log per added/removed row)
        const oldDistCase2: DistributionItem[] = Array.isArray(originalItem.distribution)
          ? originalItem.distribution
          : [];
        const newDistCase2 = validatedInput.distribution || [];
        await this.logDistributionChanges(
          oldDistCase2,
          newDistCase2,
          {
            id: targetItem.id,
            sku: newSku,
            warehouse: targetWarehouse,
            location: targetLocation,
            location_id: targetLocationId,
            quantity: consolidatedQty,
          },
          ctx
        );

        return { action: 'consolidated', id: targetItem.id };
      }

      // CASE 3: NO COLLISION (Standard Move/Rename)
      await this.update(originalItem.id, {
        sku: newSku,
        warehouse: targetWarehouse,
        location: targetLocation,
        location_id: targetLocationId,
        quantity: newQty, // Absolute truth
        item_name: validatedInput.item_name,
        status: validatedInput.status || originalItem.status,
        is_active: newQty > 0 ? true : originalItem.is_active,
        distribution: validatedInput.distribution || [],
        sublocation: targetLocation.toUpperCase().startsWith('ROW')
          ? validatedInput.sublocation || null
          : null,
      } as InventoryUpdate as InventoryItemInput);

      const isRename = hasSkuChanged;
      const actionType = isRename ? 'EDIT' : 'MOVE';

      // For MOVE events emit the same audit shape as CASE 2 (collision):
      // quantity_change = -source_qty, new_quantity = 0. This makes
      // `Math.abs(quantity_change)` mean "units moved" uniformly across
      // both branches — see docs/inventory-log-shapes.md and the helper
      // in src/features/inventory/utils/inventoryLogShape.ts.
      // RENAME (EDIT) keeps row-state semantics (prev/new on actual qty).
      const logQuantityChange =
        actionType === 'MOVE' ? -originalItem.quantity : newQty - originalItem.quantity;
      const logNewQuantity = actionType === 'MOVE' ? 0 : newQty;

      try {
        await trackLog(
          {
            sku: newSku,
            from_warehouse: originalItem.warehouse,
            from_location: originalItem.location || undefined,
            to_warehouse: targetWarehouse,
            to_location: targetLocation,
            to_location_id: targetLocationId,
            quantity_change: logQuantityChange,
            prev_quantity: originalItem.quantity,
            new_quantity: logNewQuantity,
            action_type: actionType,
            previous_sku: isRename ? originalItem.sku : undefined,
            item_id: String(originalItem.id),
            location_id: originalItem.location_id, // Source location ID
            snapshot_before: {
              id: originalItem.id,
              sku: originalItem.sku,
              quantity: originalItem.quantity,
              location_id: originalItem.location_id,
              location: originalItem.location,
              warehouse: originalItem.warehouse,
            },
            is_reversed: updatedFormData.isReversal || false,
          },
          userInfo
        );
      } catch (logError) {
        console.warn(
          '[InventoryService] Log failed for standard move/rename, but operation succeeded.',
          logError
        );
      }

      // Log distribution changes (one log per added/removed row)
      const oldDistCase3: DistributionItem[] = Array.isArray(originalItem.distribution)
        ? originalItem.distribution
        : [];
      const newDistCase3 = validatedInput.distribution || [];
      await this.logDistributionChanges(
        oldDistCase3,
        newDistCase3,
        {
          id: originalItem.id,
          sku: newSku,
          warehouse: targetWarehouse,
          location: targetLocation,
          location_id: targetLocationId,
          quantity: newQty,
        },
        ctx
      );

      return { action: isRename ? 'renamed' : 'moved', id: originalItem.id };
    }

    // IN-PLACE EDIT SCENARIO (Only Quantity or Note)
    await this.update(originalItem.id, {
      quantity: newQty,
      location: targetLocation, // Normalized (UPPERCASE)
      location_id: targetLocationId,
      item_name: validatedInput.item_name,
      status: validatedInput.status || originalItem.status,
      is_active: newQty > 0 ? true : originalItem.is_active,
      internal_note: validatedInput.internal_note,
      distribution: validatedInput.distribution || [],
      sublocation: targetLocation.toUpperCase().startsWith('ROW')
        ? validatedInput.sublocation || null
        : null,
    } as InventoryUpdate as InventoryItemInput);

    try {
      await trackLog(
        {
          sku: originalItem.sku,
          from_warehouse: originalItem.warehouse,
          from_location: originalItem.location || undefined,
          to_warehouse: originalItem.warehouse,
          to_location: originalItem.location || undefined,
          quantity_change: newQty - originalItem.quantity,
          prev_quantity: originalItem.quantity,
          new_quantity: newQty,
          action_type: 'EDIT',
          item_id: String(originalItem.id),
          location_id: originalItem.location_id,
          snapshot_before: {
            id: originalItem.id,
            sku: originalItem.sku,
            quantity: originalItem.quantity,
            location_id: originalItem.location_id,
            location: originalItem.location,
            warehouse: originalItem.warehouse,
          },
          is_reversed: updatedFormData.isReversal || false,
        },
        userInfo
      );
    } catch (logError) {
      console.warn(
        '[InventoryService] Log failed for in-place edit, but operation succeeded.',
        logError
      );
    }

    // Log distribution changes (one log per added/removed row)
    const oldDistInPlace: DistributionItem[] = Array.isArray(originalItem.distribution)
      ? originalItem.distribution
      : [];
    const newDistInPlace = validatedInput.distribution || [];
    await this.logDistributionChanges(
      oldDistInPlace,
      newDistInPlace,
      {
        id: originalItem.id,
        sku: originalItem.sku,
        warehouse: originalItem.warehouse,
        location: originalItem.location,
        location_id: originalItem.location_id,
        quantity: newQty,
      },
      ctx
    );

    return { action: 'updated', id: originalItem.id };
  }

  /**
   * Permanently removes an item from inventory.
   */
  async deleteItem(item: InventoryModel, ctx: InventoryServiceContext) {
    const { userInfo, trackLog } = ctx;

    if (!item.id || isNaN(Number(item.id))) {
      console.error('Critical Error: Attempted delete on invalid item ID', { item });
      throw new AppError(`Operation aborted: Invalid ID for deletion.`, 400);
    }

    await this.delete(item.id);

    try {
      await trackLog(
        {
          sku: item.sku,
          from_warehouse: item.warehouse,
          from_location: item.location || undefined,
          to_warehouse: item.warehouse,
          to_location: item.location || undefined,
          quantity_change: -item.quantity,
          prev_quantity: item.quantity,
          new_quantity: 0,
          action_type: 'DELETE',
          item_id: String(item.id),
          location_id: item.location_id,
          snapshot_before: {
            id: item.id,
            sku: item.sku,
            quantity: item.quantity,
            location_id: item.location_id,
            location: item.location,
            warehouse: item.warehouse,
          },
        },
        userInfo
      );
    } catch (logError) {
      console.warn(
        '[InventoryService] Log failed for deletion, but operation succeeded.',
        logError
      );
    }
  }

  /**
   * Moving stock from one place to another.
   * Internally leverages updateItem/addItem patterns but specialized for transfer semantics.
   */
  async moveItem(
    sourceItem: InventoryModel,
    targetWarehouse: string,
    targetLocation: string,
    qty: number,
    ctx: InventoryServiceContext,
    internalNote?: string | null,
    targetSublocation?: string[] | null
  ) {
    const { userInfo } = ctx;

    // Use the atomic RPC for moving stock
    // This avoids race conditions and leverages server-side validation/normalization
    const { data, error } = await this.supabase.rpc('move_inventory_stock', {
      p_sku: sourceItem.sku,
      p_from_warehouse: sourceItem.warehouse,
      p_from_location: sourceItem.location || '',
      p_to_warehouse: targetWarehouse,
      p_to_location: targetLocation,
      p_qty: qty,
      p_performed_by: userInfo.performed_by,
      p_user_id: userInfo.user_id,
      p_user_role: 'staff',
      ...(internalNote !== undefined && { p_internal_note: internalNote ?? undefined }),
      ...(targetSublocation !== undefined && { p_sublocation: targetSublocation ?? undefined }),
    });

    if (error) {
      console.error('[InventoryService] RPC move failed:', error);
      // Translate common DB errors to AppErrors
      if (error.message?.includes('Insufficient source stock')) {
        throw new AppError(`Stock mismatch: Insufficient stock in source to move ${qty}.`, 409);
      }
      throw new AppError(error.message || 'Failed to move inventory item', 500, error);
    }

    return { action: 'moved', data };
  }

  /**
   * Fetches inventory items with advanced filtering, search, and pagination.
   */
  async getWithFilters({
    search = '',
    page = 0,
    limit = 100,
  }: {
    search?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ data: InventoryModel[]; count: number | null }> {
    const baseQuery = this.supabase
      .from(this.table)
      .select('*', { count: 'exact' })
      .gt('quantity', 0)
      .order('warehouse', { ascending: false })
      .order('location', { ascending: true })
      .order('sku', { ascending: true });

    const filteredQuery = search
      ? baseQuery.or(`sku.ilike.%${search}%,location.ilike.%${search}%`)
      : baseQuery;

    const from = page * limit;
    const { data, error, count } = await filteredQuery.range(from, from + limit - 1);

    if (error) this.handleError(error);

    return {
      data: this.validateArray(data),
      count,
    };
  }

  /**
   * Checks if an item exists at the given coordinates.
   * Useful for real-time validation in UI.
   */
  async checkExistence(
    sku: string,
    locationName: string,
    warehouse: string,
    excludeId?: string | number
  ): Promise<boolean> {
    if (!sku || (!locationName && locationName !== '') || !warehouse) return false;

    let query = this.supabase
      .from(this.table)
      .select('id')
      .eq('sku', sku)
      .eq('warehouse', warehouse)
      .eq('location', locationName);

    if (excludeId) {
      query = query.neq('id', Number(excludeId));
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error('Error checking existence:', error);
      return false;
    }

    return !!data;
  }
}

export const inventoryService = new InventoryService();
