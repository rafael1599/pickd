import { test as base, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { InventoryPage, MovementModal, HistoryPage } from '../pages';
import 'dotenv/config';

type MyFixtures = {
    inventoryPage: InventoryPage;
    movementModal: MovementModal;
    historyPage: HistoryPage;
    dbCleanup: void;
    supabaseAdmin: SupabaseClient;
};

export const test = base.extend<MyFixtures>({
    // ⚠️ SAFETY: This fixture ONLY cleans up test-created data (prefixed with 'TEST-').
    // It will REFUSE to run against production to prevent accidental data loss.
    // NEVER delete all rows from tables — always scope to test data only.
    dbCleanup: [async ({ }, use) => {
        const supabaseUrl = process.env.VITE_SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !serviceRoleKey) {
            console.warn('⚠️ [Fixture] Database cleanup skipped: Supabase URL/Key missing');
            await use();
            return;
        }

        // 🛑 BLOCK PRODUCTION — never run destructive operations against prod
        const isProduction = supabaseUrl.includes('xexkttehzpxtviebglei')
            || (!supabaseUrl.includes('localhost') && !supabaseUrl.includes('127.0.0.1'));

        if (isProduction) {
            console.warn('🛑 [Fixture] Database cleanup BLOCKED — refusing to run against production!');
            console.warn(`   URL: ${supabaseUrl}`);
            await use();
            return;
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey);

        try {
            // Only delete TEST data (scoped by prefixes)
            await supabase.from('inventory_logs').delete().or('sku.ilike.TEST-%,sku.ilike.GHOST-%,sku.ilike.FIX-%,sku.ilike.DURABLE-%,sku.ilike.SKU-ADD%,sku.ilike.STAFF-%,sku.ilike.UNDO-RPC-%,sku.ilike.LIFO-%');
            await supabase.from('inventory').delete().or('sku.ilike.TEST-%,sku.ilike.GHOST-%,sku.ilike.FIX-%,sku.ilike.DURABLE-%,sku.ilike.SKU-ADD%,sku.ilike.STAFF-%,sku.ilike.UNDO-RPC-%,sku.ilike.LIFO-%');

            console.log('✅ [Fixture] Test data cleaned up (TEST-* only)');
        } catch (err) {
            console.error('❌ [Fixture] Database cleanup failed:', err);
        }

        await use();
    }, { auto: true }],

    inventoryPage: async ({ page }, use) => {
        page.on('console', msg => {
            console.log(`[BROWSER] ${msg.type().toUpperCase()}: ${msg.text()}`);
        });
        const inventoryPage = new InventoryPage(page);
        await use(inventoryPage);
    },

    movementModal: async ({ page }, use) => {
        const movementModal = new MovementModal(page);
        await use(movementModal);
    },
    historyPage: async ({ page }, use) => {
        const historyPage = new HistoryPage(page);
        await use(historyPage);
    },

    supabaseAdmin: async ({ }, use) => {
        const supabaseUrl = process.env.VITE_SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase URL/Key missing');
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        await use(supabase);
    },
});

export { expect };
