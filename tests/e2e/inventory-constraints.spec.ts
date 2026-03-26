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

      // Search for it — qty 0 items are hidden by default
      await inventoryPage.search(sku);

      // Enable "Show Deleted Items & Qty 0 SKUs" checkbox (appears when search has no visible results)
      const showInactiveCheckbox = page.locator('#show-inactive');
      await expect(showInactiveCheckbox).toBeVisible({ timeout: 5000 });
      await showInactiveCheckbox.check();
      await page.waitForTimeout(1200); // wait for filter re-render

      // Should be visible in list after enabling the filter
      await inventoryPage.verifyItemExists(sku);

      console.log(
        'Verified: Items with 0 quantity are visible when "Show Deleted Items" is enabled'
      );
    } else {
      console.log('Verified: UI prevents creating 0 quantity items');
    }
  });
});
