import { expect, Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class InventoryPage extends BasePage {
    constructor(page: Page) {
        super(page);
    }

    async search(query: string) {
        await this.page.waitForLoadState('networkidle');
        const searchInput = this.page.getByPlaceholder(/search/i);
        await searchInput.clear();
        await searchInput.fill(query);
        // UI filtering delay
        await this.page.waitForTimeout(1200);
    }

    async addItem(data: { sku: string; quantity: number; location: string; warehouse?: string; note?: string }) {
        const addBtn = this.page.locator('button[title="Add New SKU"]');
        await expect(addBtn).toBeVisible({ timeout: 15000 });
        await addBtn.click();

        const modal = this.page.locator('.fixed.inset-0.z-\\[100020\\]');
        await expect(modal).toBeVisible({ timeout: 5000 });

        await this.page.locator('#inventory_sku').fill(data.sku);
        await this.page.locator('#inventory_location').fill(data.location);
        await this.page.locator('#inventory_location').press('Escape');

        if (data.note) {
            await this.page.locator('#item_name').fill(data.note);
            await this.page.locator('#item_name').press('Escape');
        }

        const qtyInput = this.page.locator('#inventory_quantity');
        await qtyInput.click();
        await qtyInput.fill(String(data.quantity));

        if (data.warehouse && data.warehouse !== 'LUDLOW') {
            await this.page.getByRole('button', { name: data.warehouse, exact: true }).click();
        }

        const saveBtn = this.page.getByRole('button', { name: /save/i });
        await expect(saveBtn).toBeEnabled({ timeout: 5000 });
        await saveBtn.click();

        await expect(modal).toBeHidden({ timeout: 10000 });
        // Database sync + local state update buffer
        await this.page.waitForTimeout(1500);
    }

    async clickMoveOnCard(sku: string, location?: string) {
        const card = this.getCard(sku, location);
        await expect(card).toBeVisible({ timeout: 15000 });
        const moveButton = card.getByLabel('Move item');
        await moveButton.click();
    }

    getCard(sku: string, location?: string): Locator {
        const cards = this.page.locator('.bg-card');
        const skuCards = cards.filter({ hasText: sku });

        if (location) {
            const normalizedLoc = location.toUpperCase().trim();
            // Strategy: Look for the location text in the accent-colored div 
            // or any specific badge within a card that identifies as containing the SKU.
            // Using a case-insensitive regex for robustness.
            return skuCards.filter({
                hasText: new RegExp(`^${normalizedLoc}$|\\s${normalizedLoc}\\s|\\b${normalizedLoc}$`, 'i')
            }).first();
        }

        return skuCards.first();
    }

    async verifyItemExists(sku: string, location?: string) {
        const card = this.getCard(sku, location);
        await expect(card).toBeVisible({ timeout: 15000 });
    }

    async verifyItemNotExists(sku: string, location?: string) {
        const card = this.getCard(sku, location);
        await expect(card).toBeHidden({ timeout: 10000 });
    }

    async verifyQuantity(sku: string, expectedQty: number, location?: string) {
        const card = this.getCard(sku, location);
        await expect(card).toBeVisible({ timeout: 15000 });
        // Target the specific big quantity span
        const qtySpan = card.locator('span.text-2xl.font-black');
        await expect(qtySpan).toHaveText(String(expectedQty), { timeout: 20000 });
    }

    getNote(sku: string, location?: string): Locator {
        const card = this.getCard(sku, location);
        // Note is the last tiny font element in the card
        return card.locator('.text-\\[9px\\]').last();
    }

    async reloadAndSearch(sku: string) {
        await this.page.reload({ waitUntil: 'networkidle' });
        await this.page.waitForTimeout(2500); // Wait for potential animations/load
        await this.search(sku);
    }
}
