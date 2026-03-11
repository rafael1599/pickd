import { test, expect } from '../fixtures/test-base';
import { BasePage } from '../pages';

test.setTimeout(90000);

test.describe('Distribution Auto-Adjustment on Deduction', () => {
    test.beforeEach(async ({ inventoryPage }) => {
        await inventoryPage.goto('/');
    });

    /**
     * DB-level test: Verify adjust_distribution is called when quantity is deducted
     * via adjust_inventory_quantity RPC.
     */
    test('should adjust distribution when quantity is deducted via RPC', async ({ supabaseAdmin }) => {
        const sku = BasePage.generateTestId('TEST-DIST');
        const warehouse = 'LUDLOW';
        const location = 'LOC-DIST-RPC';

        // 1. Insert sku_metadata + inventory item with distribution
        await supabaseAdmin.from('sku_metadata').upsert({ sku }, { onConflict: 'sku' });

        const { data: inserted, error: insertErr } = await supabaseAdmin
            .from('inventory')
            .insert({
                sku,
                warehouse,
                location,
                quantity: 100,
                is_active: true,
                distribution: [
                    { type: 'PALLET', count: 2, units_each: 30 },   // 60u
                    { type: 'LINE', count: 3, units_each: 5 },      // 15u
                    { type: 'TOWER', count: 1, units_each: 25 },    // 25u
                    // 100 total
                ],
            })
            .select()
            .single();

        expect(insertErr).toBeNull();
        expect(inserted).toBeTruthy();

        // 2. Deduct 35 units via RPC (should consume: 1 PALLET(30) + 1 LINE(5) = 35)
        const { error: rpcErr } = await supabaseAdmin.rpc('adjust_inventory_quantity', {
            p_sku: sku,
            p_warehouse: warehouse,
            p_location: location,
            p_delta: -35,
            p_performed_by: 'test-runner',
            p_user_id: '00000000-0000-0000-0000-000000000001',
        });

        expect(rpcErr).toBeNull();

        // 3. Verify the item state
        const { data: item } = await supabaseAdmin
            .from('inventory')
            .select('quantity, distribution')
            .eq('sku', sku)
            .eq('warehouse', warehouse)
            .eq('location', location)
            .single();

        expect(item).toBeTruthy();
        expect(item!.quantity).toBe(65);

        // Distribution should have been adjusted:
        // Original: PALLET(2×30=60), LINE(3×5=15), TOWER(1×25=25) = 100
        // Deduct 35: PALLETs consumed first (both 30u each, sorted ASC):
        //   - Remove 1 full PALLET(30), pending=5
        //   - Break remaining PALLET(30): residual=25 → PALLET(1×25)
        // Result: PALLET(1×25), LINE(3×5=15), TOWER(1×25) = 65
        const dist = item!.distribution as any[];
        expect(dist).toBeTruthy();
        expect(dist.length).toBeGreaterThan(0);

        const totalAfter = dist.reduce((sum: number, d: any) => sum + d.count * d.units_each, 0);
        expect(totalAfter).toBe(65);

        // Verify priority order was respected: PALLETs consumed first
        const pallets = dist.filter((d: any) => d.type === 'PALLET');
        const palletTotal = pallets.reduce((s: number, d: any) => s + d.count * d.units_each, 0);
        expect(palletTotal).toBe(25); // residual from broken pallet

        const lines = dist.filter((d: any) => d.type === 'LINE');
        const lineTotal = lines.reduce((s: number, d: any) => s + d.count * d.units_each, 0);
        expect(lineTotal).toBe(15); // untouched (3×5)

        const towers = dist.filter((d: any) => d.type === 'TOWER');
        const towerTotal = towers.reduce((s: number, d: any) => s + d.count * d.units_each, 0);
        expect(towerTotal).toBe(25); // untouched
    });

    /**
     * DB-level test: Verify partial group breaking creates residual entry.
     */
    test('should break a group and create residual when partially consumed', async ({ supabaseAdmin }) => {
        const sku = BasePage.generateTestId('TEST-BREAK');
        const warehouse = 'LUDLOW';
        const location = 'LOC-DIST-BREAK';

        await supabaseAdmin.from('sku_metadata').upsert({ sku }, { onConflict: 'sku' });

        const { error: insertErr } = await supabaseAdmin
            .from('inventory')
            .insert({
                sku,
                warehouse,
                location,
                quantity: 30,
                is_active: true,
                distribution: [
                    { type: 'PALLET', count: 1, units_each: 30 },
                ],
            });

        expect(insertErr).toBeNull();

        // Deduct 15 from a 30-unit pallet → should break into residual pallet of 15
        const { error: rpcErr } = await supabaseAdmin.rpc('adjust_inventory_quantity', {
            p_sku: sku,
            p_warehouse: warehouse,
            p_location: location,
            p_delta: -15,
            p_performed_by: 'test-runner',
            p_user_id: '00000000-0000-0000-0000-000000000001',
        });

        expect(rpcErr).toBeNull();

        const { data: item } = await supabaseAdmin
            .from('inventory')
            .select('quantity, distribution')
            .eq('sku', sku)
            .eq('warehouse', warehouse)
            .eq('location', location)
            .single();

        expect(item!.quantity).toBe(15);

        const dist = item!.distribution as any[];
        expect(dist).toBeTruthy();

        // Should have 1 entry: PALLET with count=1, units_each=15 (the residual)
        expect(dist.length).toBe(1);
        expect(dist[0].type).toBe('PALLET');
        expect(dist[0].count).toBe(1);
        expect(dist[0].units_each).toBe(15);
    });

    /**
     * DB-level test: Verify type priority order PALLET → LINE → TOWER → OTHER.
     */
    test('should consume types in priority order: PALLET first, then LINE, etc.', async ({ supabaseAdmin }) => {
        const sku = BasePage.generateTestId('TEST-ORDER');
        const warehouse = 'LUDLOW';
        const location = 'LOC-DIST-ORDER';

        await supabaseAdmin.from('sku_metadata').upsert({ sku }, { onConflict: 'sku' });

        const { error: insertErr } = await supabaseAdmin
            .from('inventory')
            .insert({
                sku,
                warehouse,
                location,
                quantity: 20,
                is_active: true,
                distribution: [
                    { type: 'TOWER', count: 1, units_each: 10 },
                    { type: 'PALLET', count: 1, units_each: 10 },
                ],
            });

        expect(insertErr).toBeNull();

        // Deduct 10 — should consume PALLET(10) first, leaving TOWER(10) untouched
        const { error: rpcErr } = await supabaseAdmin.rpc('adjust_inventory_quantity', {
            p_sku: sku,
            p_warehouse: warehouse,
            p_location: location,
            p_delta: -10,
            p_performed_by: 'test-runner',
            p_user_id: '00000000-0000-0000-0000-000000000001',
        });

        expect(rpcErr).toBeNull();

        const { data: item } = await supabaseAdmin
            .from('inventory')
            .select('quantity, distribution')
            .eq('sku', sku)
            .eq('warehouse', warehouse)
            .eq('location', location)
            .single();

        expect(item!.quantity).toBe(10);

        const dist = item!.distribution as any[];
        expect(dist.length).toBe(1);
        expect(dist[0].type).toBe('TOWER');
        expect(dist[0].units_each).toBe(10);
    });

    /**
     * DB-level test: Within same type, smallest units_each consumed first.
     */
    test('should consume smallest units_each first within same type', async ({ supabaseAdmin }) => {
        const sku = BasePage.generateTestId('TEST-SMALL');
        const warehouse = 'LUDLOW';
        const location = 'LOC-DIST-SMALL';

        await supabaseAdmin.from('sku_metadata').upsert({ sku }, { onConflict: 'sku' });

        const { error: insertErr } = await supabaseAdmin
            .from('inventory')
            .insert({
                sku,
                warehouse,
                location,
                quantity: 50,
                is_active: true,
                distribution: [
                    { type: 'PALLET', count: 1, units_each: 20 },
                    { type: 'PALLET', count: 1, units_each: 30 },
                ],
            });

        expect(insertErr).toBeNull();

        // Deduct 20 — should consume the smaller PALLET(20) first, keep PALLET(30)
        const { error: rpcErr } = await supabaseAdmin.rpc('adjust_inventory_quantity', {
            p_sku: sku,
            p_warehouse: warehouse,
            p_location: location,
            p_delta: -20,
            p_performed_by: 'test-runner',
            p_user_id: '00000000-0000-0000-0000-000000000001',
        });

        expect(rpcErr).toBeNull();

        const { data: item } = await supabaseAdmin
            .from('inventory')
            .select('quantity, distribution')
            .eq('sku', sku)
            .eq('warehouse', warehouse)
            .eq('location', location)
            .single();

        expect(item!.quantity).toBe(30);

        const dist = item!.distribution as any[];
        expect(dist.length).toBe(1);
        expect(dist[0].type).toBe('PALLET');
        expect(dist[0].units_each).toBe(30);
    });

    /**
     * DB-level test: Label preservation on remaining groups.
     */
    test('should preserve label on remaining distribution entries', async ({ supabaseAdmin }) => {
        const sku = BasePage.generateTestId('TEST-LABEL');
        const warehouse = 'LUDLOW';
        const location = 'LOC-DIST-LABEL';

        await supabaseAdmin.from('sku_metadata').upsert({ sku }, { onConflict: 'sku' });

        const { error: insertErr } = await supabaseAdmin
            .from('inventory')
            .insert({
                sku,
                warehouse,
                location,
                quantity: 40,
                is_active: true,
                distribution: [
                    { type: 'PALLET', count: 1, units_each: 10 },
                    { type: 'PALLET', count: 1, units_each: 30, label: 'Big Pallet A' },
                ],
            });

        expect(insertErr).toBeNull();

        // Deduct 10 — should consume smaller pallet, labeled one stays
        const { error: rpcErr } = await supabaseAdmin.rpc('adjust_inventory_quantity', {
            p_sku: sku,
            p_warehouse: warehouse,
            p_location: location,
            p_delta: -10,
            p_performed_by: 'test-runner',
            p_user_id: '00000000-0000-0000-0000-000000000001',
        });

        expect(rpcErr).toBeNull();

        const { data: item } = await supabaseAdmin
            .from('inventory')
            .select('quantity, distribution')
            .eq('sku', sku)
            .eq('warehouse', warehouse)
            .eq('location', location)
            .single();

        expect(item!.quantity).toBe(30);

        const dist = item!.distribution as any[];
        expect(dist.length).toBe(1);
        expect(dist[0].type).toBe('PALLET');
        expect(dist[0].units_each).toBe(30);
        expect(dist[0].label).toBe('Big Pallet A');
    });

    /**
     * DB-level test: Deducting more than distribution total should empty distribution.
     */
    test('should handle deduction exceeding distribution total gracefully', async ({ supabaseAdmin }) => {
        const sku = BasePage.generateTestId('TEST-OVER');
        const warehouse = 'LUDLOW';
        const location = 'LOC-DIST-OVER';

        await supabaseAdmin.from('sku_metadata').upsert({ sku }, { onConflict: 'sku' });

        const { error: insertErr } = await supabaseAdmin
            .from('inventory')
            .insert({
                sku,
                warehouse,
                location,
                quantity: 50,  // quantity > distribution total (30)
                is_active: true,
                distribution: [
                    { type: 'LINE', count: 3, units_each: 10 },  // 30u in dist
                ],
            });

        expect(insertErr).toBeNull();

        // Deduct 40 — distribution only covers 30, so dist empties, qty goes to 10
        const { error: rpcErr } = await supabaseAdmin.rpc('adjust_inventory_quantity', {
            p_sku: sku,
            p_warehouse: warehouse,
            p_location: location,
            p_delta: -40,
            p_performed_by: 'test-runner',
            p_user_id: '00000000-0000-0000-0000-000000000001',
        });

        expect(rpcErr).toBeNull();

        const { data: item } = await supabaseAdmin
            .from('inventory')
            .select('quantity, distribution')
            .eq('sku', sku)
            .eq('warehouse', warehouse)
            .eq('location', location)
            .single();

        expect(item!.quantity).toBe(10);

        const dist = item!.distribution as any[];
        // Distribution should be empty since we deducted more than distribution total
        expect(dist.length).toBe(0);
    });

    /**
     * UI test: Edit quantity down and verify distribution adjusts in the modal.
     * Skipped: UI search/navigation needs adjustment to find dynamically inserted items.
     */
    test.skip('should show updated distribution in modal after quantity edit', async ({
        inventoryPage, supabaseAdmin, page
    }) => {
        const sku = BasePage.generateTestId('TEST-UI-DIST');
        const warehouse = 'LUDLOW';
        const location = 'LOC-UI-DIST';

        // Setup: Insert item with distribution via DB
        await supabaseAdmin.from('sku_metadata').upsert({ sku }, { onConflict: 'sku' });

        await supabaseAdmin.from('inventory').insert({
            sku,
            warehouse,
            location,
            quantity: 60,
            is_active: true,
            distribution: [
                { type: 'PALLET', count: 2, units_each: 30 },  // 60u total
            ],
        });

        // Navigate and find the item
        await inventoryPage.reloadAndSearch(sku);
        await inventoryPage.verifyItemExists(sku, location);

        // Click card to open edit modal
        const card = inventoryPage.getCard(sku, location);
        await card.click();

        // Wait for modal
        const modal = page.locator('.fixed.inset-0');
        await expect(modal).toBeVisible({ timeout: 5000 });

        // Change quantity from 60 to 30 (deduct 30)
        const qtyInput = page.locator('#inventory_quantity');
        await qtyInput.click();
        await qtyInput.fill('30');

        // Save
        const saveBtn = page.getByRole('button', { name: /update/i });
        await expect(saveBtn).toBeEnabled({ timeout: 5000 });
        await saveBtn.click();

        // Wait for modal to close
        await expect(modal).toBeHidden({ timeout: 10000 });
        await page.waitForTimeout(2000);

        // Verify in DB that distribution was adjusted
        const { data: item } = await supabaseAdmin
            .from('inventory')
            .select('quantity, distribution')
            .eq('sku', sku)
            .eq('warehouse', warehouse)
            .eq('location', location)
            .single();

        expect(item!.quantity).toBe(30);

        const dist = item!.distribution as any[];
        expect(dist).toBeTruthy();

        const totalDist = dist.reduce((sum: number, d: any) => sum + d.count * d.units_each, 0);
        expect(totalDist).toBe(30);

        // Should have consumed 1 pallet (30), leaving 1 pallet(30)
        expect(dist.length).toBe(1);
        expect(dist[0].type).toBe('PALLET');
        expect(dist[0].count).toBe(1);
        expect(dist[0].units_each).toBe(30);
    });
});
