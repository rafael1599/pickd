import { describe, it, expect, vi } from 'vitest';
import { inventoryService } from '../inventory.service';
import { mockSupabase } from '../../../../test/mocks/supabase';

describe('InventoryService', () => {
    describe('checkExistence', () => {
        it('should return true if item exists at coordinates', async () => {
            // Setup mock result
            mockSupabase.maybeSingle.mockResolvedValue({
                data: { id: 123 },
                error: null
            });

            const exists = await inventoryService.checkExistence(
                'SKU-TEST',
                'Row 1',
                'LUDLOW'
            );

            expect(mockSupabase.from).toHaveBeenCalledWith('inventory');
            expect(mockSupabase.eq).toHaveBeenCalledWith('sku', 'SKU-TEST');
            expect(mockSupabase.eq).toHaveBeenCalledWith('warehouse', 'LUDLOW');
            expect(mockSupabase.eq).toHaveBeenCalledWith('location', 'Row 1');
            expect(exists).toBe(true);
        });

        it('should return false if item does not exist', async () => {
            mockSupabase.maybeSingle.mockResolvedValue({
                data: null,
                error: null
            });

            const exists = await inventoryService.checkExistence(
                'SKU-NONE',
                'Row 2',
                'ATS'
            );

            expect(exists).toBe(false);
        });
    });

    describe('updateItem', () => {
        const mockCtx: any = {
            userInfo: { performed_by: 'Test User', user_id: '123' },
            trackLog: vi.fn().mockResolvedValue(null)
        };

        const mockLocations: any[] = [
            { id: 'loc-1', warehouse: 'LUDLOW', location: 'Row 1' },
            { id: 'loc-2', warehouse: 'LUDLOW', location: 'Row 2' }
        ];

        const originalItem: any = {
            id: 101, // Must be number per schema
            sku: 'SKU-A',
            warehouse: 'LUDLOW',
            location: 'Row 1',
            quantity: 5,
            item_name: 'Vieja',
            created_at: new Date().toISOString()
        };

        it('should throw Conflict error if renaming to an existing SKU in target location', async () => {
            // Setup: Target location has SKU-B already
            // Mock ensureLocationExists first (implicitly handled by mockLocations logic in service, but let's be safe)

            mockSupabase.maybeSingle.mockResolvedValue({
                data: {
                    id: 999,
                    sku: 'SKU-B',
                    location: 'Row 1',
                    warehouse: 'LUDLOW',
                    quantity: 1,
                    created_at: new Date().toISOString()
                },
                error: null
            });

            const updatedData: any = {
                sku: 'SKU-B',
                warehouse: 'LUDLOW',
                location: 'Row 1',
                quantity: 5
            };

            await expect(inventoryService.updateItem(originalItem, updatedData, mockLocations, mockCtx))
                .rejects.toThrow(/Cannot rename to "SKU-B"/);

            expect(mockSupabase.update).not.toHaveBeenCalled();
            expect(mockSupabase.delete).not.toHaveBeenCalled();
        });

        it('should merge quantities and updated note if incoming has content', async () => {
            // Setup: Target has SKU-A, Qty 10, Note "Original"
            mockSupabase.maybeSingle.mockResolvedValue({
                data: {
                    id: 202,
                    sku: 'SKU-A',
                    location: 'Row 2',
                    quantity: 10,
                    item_name: 'Original',
                    warehouse: 'LUDLOW',
                    created_at: new Date().toISOString()
                },
                error: null
            });

            const updatedData: any = {
                sku: 'SKU-A',
                warehouse: 'LUDLOW',
                location: 'Row 2',
                quantity: 5,
                item_name: 'NUEVA DESCRIPCIÓN'
            };

            const result = await inventoryService.updateItem(originalItem, updatedData, mockLocations, mockCtx);

            expect(result.action).toBe('consolidated');
            // Verify quantity sum (10 + 5) and note overwrite
            expect(mockSupabase.update).toHaveBeenCalledWith({
                quantity: 15,
                location_id: 'loc-2',
                item_name: 'Original | NUEVA DESCRIPCIÓN',
                is_active: true,
                distribution: []
            });
            // Verify that we targeted the correct ID for update and delete
            expect(mockSupabase.eq).toHaveBeenCalledWith('id', 202);
            expect(mockSupabase.eq).toHaveBeenCalledWith('id', 101);

            // Verify that we updated the source item to 0 quantity instead of deleting
            expect(mockSupabase.update).toHaveBeenCalledWith({
                quantity: 0,
                is_active: true
            });
        });

        it('should protect and preserve existing note if incoming is empty/spaces', async () => {
            // Setup: Target has SKU-A, Note "Descripción Valiosa"
            mockSupabase.maybeSingle.mockResolvedValue({
                data: {
                    id: 303,
                    sku: 'SKU-A',
                    location: 'Row 2',
                    quantity: 10,
                    item_name: 'Descripción Valiosa',
                    warehouse: 'LUDLOW',
                    created_at: new Date().toISOString()
                },
                error: null
            });

            const updatedData: any = {
                sku: 'SKU-A',
                warehouse: 'LUDLOW',
                location: 'Row 2',
                quantity: 5,
                item_name: '   ' // Empty spaces
            };

            await inventoryService.updateItem(originalItem, updatedData, mockLocations, mockCtx);

            // Verify note was preserved
            expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
                item_name: 'Descripción Valiosa'
            }));
        });
    });
});
