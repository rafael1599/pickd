import { test, expect } from '../fixtures/test-base';
import { BasePage } from '../pages';

test.setTimeout(60000);

test.describe('Inventory Constraints & Integrity', () => {
  test.beforeEach(async ({ inventoryPage }) => {
    await inventoryPage.goto('/');
  });

  // UI Constraint: Prevent Negative Stock Input
  test('should prevent entering negative quantity in Add Item modal', async ({
    page,
    inventoryPage,
  }) => {
    await inventoryPage.openAddModal();

    // Fill basic info using new ItemDetailView selectors
    await page.locator('#detail_sku').fill('TEST-NEG-STOCK');
    await page.locator('#detail_sku').press('Escape');
    await page.locator('#detail_location').fill('A-01');
    await page.locator('#detail_location').press('Escape');

    // Verify validation blocks save
    const isBlocked = await inventoryPage.verifyNegativeQuantityBlocked();
    expect(isBlocked).toBe(true);
  });

  // Zero Stock Visibility/Cleanup
  test('should handle zero quantity items correctly (cleanup logic)', async ({
    page,
    inventoryPage,
  }) => {
    const sku = BasePage.generateTestId('TEST-ZERO');

    await inventoryPage.openAddModal();

    await page.locator('#detail_sku').fill(sku);
    await page.locator('#detail_sku').press('Escape');
    await page.locator('#detail_location').fill('A-01');
    await page.locator('#detail_location').press('Escape');
    // Quantity defaults to 0 in the stepper, no need to fill

    const createButton = page.getByRole('button', { name: /create/i });

    // If allowed to save
    if (await createButton.isEnabled()) {
      await createButton.click();

      // Wait for detail view close
      const detailView = page.locator('.fixed.inset-0.z-\\[100020\\]');
      await expect(detailView).toBeHidden({ timeout: 10000 });
      await inventoryPage.waitForNetworkIdle();

      // Search for it
      await inventoryPage.search(sku);

      // Should be visible in list
      await inventoryPage.verifyItemExists(sku);

      console.log('Verified: Items created with 0 quantity are now visible in stock view');
    } else {
      console.log('Verified: UI prevents creating 0 quantity items');
    }
  });
});
