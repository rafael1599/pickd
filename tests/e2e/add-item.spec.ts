import { test, expect } from '../fixtures/test-base';
import { BasePage } from '../pages';

test.describe('Inventory - Add New Item', () => {
  test.beforeEach(async ({ inventoryPage }) => {
    await inventoryPage.goto('/');
  });

  test('should successfully add a new item with all fields', async ({ inventoryPage }) => {
    const sku = BasePage.generateTestId('SKU-ADD');
    const location = 'LOC-NEW';
    const quantity = 42;
    const note = 'Test note for new item';

    // 1. Add the item
    await inventoryPage.addItem({
      sku,
      location,
      quantity,
      note,
    });

    // 2. Search for it and verify existence
    await inventoryPage.reloadAndSearch(sku);
    await inventoryPage.verifyItemExists(sku, location);

    // 3. Verify details
    const card = inventoryPage.getCard(sku, location);
    await expect(card).toContainText(String(quantity));
    await expect(card).toContainText(note);
  });

  test('should prevent adding item with negative quantity', async ({ inventoryPage }) => {
    await inventoryPage.openAddModal();

    const isBlocked = await inventoryPage.verifyNegativeQuantityBlocked();
    expect(isBlocked).toBe(true);
  });

  test('should require mandatory fields (SKU and Location)', async ({ inventoryPage, page }) => {
    await inventoryPage.openAddModal();

    const createButton = page.getByRole('button', { name: /create/i });

    // Initially should be disabled or show error after interaction
    const isDisabled = await createButton.isDisabled();

    if (!isDisabled) {
      await createButton.click();
      await expect(page.getByText(/Required|field/i)).toBeVisible();
    } else {
      expect(isDisabled).toBe(true);
    }
  });

  test('should allow non-admin (staff) users to add a NEW SKU (FK Fix Verification)', async ({
    inventoryPage,
  }) => {
    // This test is particularly important for the 'staff' project
    const sku = BasePage.generateTestId('STAFF-NEW-SKU');
    const location = 'LOC-STAFF';
    const quantity = 10;

    // 1. Add the item as current role (admin or staff)
    await inventoryPage.addItem({
      sku,
      location,
      quantity,
    });

    // 2. Search for it and verify existence
    await inventoryPage.reloadAndSearch(sku);
    await inventoryPage.verifyItemExists(sku, location);

    // 3. Verify it's present in the list
    const card = inventoryPage.getCard(sku, location);
    await expect(card).toBeVisible();
    await expect(card).toContainText(String(quantity));
  });
});
