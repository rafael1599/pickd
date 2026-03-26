import { expect, Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class InventoryPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /** The full-screen detail view portal */
  private get detailView() {
    return this.page.locator('.fixed.inset-0.z-\\[100020\\]');
  }

  async search(query: string) {
    await this.page.waitForLoadState('networkidle');
    const searchInput = this.page.getByPlaceholder(/search/i);
    await searchInput.clear();
    await searchInput.fill(query);
    // UI filtering delay
    await this.page.waitForTimeout(1200);
  }

  /** Opens the Add Item detail view */
  async openAddModal() {
    const addBtn = this.page.locator('button[title="Add New SKU"]');
    await expect(addBtn).toBeVisible({ timeout: 15000 });
    await addBtn.click();
    await expect(this.detailView).toBeVisible({ timeout: 5000 });
  }

  /** Checks if negative quantity is blocked (Create button disabled or qty resets to 0) */
  async verifyNegativeQuantityBlocked(): Promise<boolean> {
    // In the new QuantityControl, tap the number to enter edit mode
    const qtyButton = this.detailView.locator('button').filter({ hasText: /^0$/ }).first();
    if (await qtyButton.isVisible()) {
      await qtyButton.click();
    }

    // Try typing a negative number in the quantity input
    const qtyInput = this.detailView.locator('input[type="number"][inputmode="numeric"]').first();
    if (await qtyInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await qtyInput.fill('-5');
      await qtyInput.press('Enter');
    }

    // QuantityControl rejects negative values and resets to previous (0).
    // Wait for the stepper to return to display mode showing "0".
    await this.page.waitForTimeout(300);
    const resetButton = this.detailView.locator('button').filter({ hasText: /^0$/ }).first();
    const wasReset = await resetButton.isVisible({ timeout: 2000 }).catch(() => false);
    return wasReset;
  }

  async addItem(data: {
    sku: string;
    quantity: number;
    location: string;
    warehouse?: string;
    note?: string;
  }) {
    await this.openAddModal();

    // Fill SKU
    await this.page.locator('#detail_sku').fill(data.sku);
    await this.page.locator('#detail_sku').press('Escape');

    // Fill Location
    await this.page.locator('#detail_location').fill(data.location);
    await this.page.locator('#detail_location').press('Escape');

    // Fill Note (uses TappableField with forceEdit — find input by placeholder)
    if (data.note) {
      const nameInput = this.detailView.getByPlaceholder(/desk frame/i);
      await nameInput.fill(data.note);
    }

    // Set quantity via the stepper: tap the "0" button to enter edit, then type
    if (data.quantity > 0) {
      const qtyButton = this.detailView.locator('button').filter({ hasText: /^0$/ }).first();
      await qtyButton.click();
      const qtyInput = this.detailView.locator('input[type="number"][inputmode="numeric"]').first();
      await expect(qtyInput).toBeVisible({ timeout: 2000 });
      await qtyInput.fill(String(data.quantity));
      await qtyInput.press('Enter');
    }

    // Click Create button
    const createBtn = this.page.getByRole('button', { name: /create/i });
    await expect(createBtn).toBeEnabled({ timeout: 5000 });
    await createBtn.click();

    await expect(this.detailView).toBeHidden({ timeout: 10000 });
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
    if (location) {
      const normalizedLoc = location.toUpperCase().trim();
      // Location is rendered as an h3 group header above the cards (not inside .bg-card).
      // Find the section (div.space-y-4) that contains the h3 with this location,
      // then locate the card with the matching SKU inside that section.
      const section = this.page.locator('div.space-y-4').filter({
        has: this.page.locator('h3', { hasText: normalizedLoc }),
      });
      return section.locator('.bg-card').filter({ hasText: sku }).first();
    }

    return this.page.locator('.bg-card').filter({ hasText: sku }).first();
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
    // Note/detail uses bg-main + text-muted + text-[9px] (distinct from other text-[9px] elements)
    return card.locator('.bg-main.text-muted.text-\\[9px\\]').first();
  }

  async reloadAndSearch(sku: string) {
    await this.page.reload({ waitUntil: 'networkidle' });
    // Wait for React hydration
    await this.page.waitForTimeout(2000);

    // Force-invalidate TanStack Query cache.
    // The app uses staleTime: Infinity and relies on websockets for updates.
    // After reload, IndexedDB restores stale cache that never refetches.
    // window.queryClient is exposed in query-client.ts for E2E testing.
    await this.page.evaluate(() => {
      const qc = (window as unknown as Record<string, { invalidateQueries: () => Promise<void> }>)
        .queryClient;
      if (qc) return qc.invalidateQueries();
    });

    // Wait for refetch to complete + cards to render
    await this.page.waitForTimeout(3000);
    await this.page.locator('.bg-card').first().waitFor({ state: 'visible', timeout: 15000 });
    await this.search(sku);
  }
}
