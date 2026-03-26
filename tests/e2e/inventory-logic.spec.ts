import { test, expect } from '../fixtures/test-base';
import { BasePage } from '../pages';

// Increase timeout for DB operations
test.setTimeout(60000);

test.describe('Inventory Logic & Smart Operations', () => {
  test.beforeEach(async ({ inventoryPage }) => {
    await inventoryPage.goto('/');
  });

  test('should handle ghost location creation without confirmation', async ({ inventoryPage }) => {
    const sku = BasePage.generateTestId('TEST-GHOST');
    const ghostLoc = BasePage.generateTestId('GHOST');

    await inventoryPage.addItem({
      sku,
      quantity: 10,
      location: ghostLoc,
    });

    await inventoryPage.reloadAndSearch(sku);
    await inventoryPage.verifyItemExists(sku, ghostLoc);
  });

  test('should perform smart merge when moving item to existing location', async ({
    inventoryPage,
    movementModal,
  }) => {
    const sku = BasePage.generateTestId('TEST-MERGE');
    const locA = 'LOC-A';
    const locB = 'LOC-B';

    // 1. Create Item at LOC-A (Qty 10)
    await inventoryPage.addItem({ sku, quantity: 10, location: locA });

    // 2. Create Item at LOC-B (Qty 5)
    await inventoryPage.addItem({ sku, quantity: 5, location: locB });

    // Reload to ensure both exist
    await inventoryPage.reloadAndSearch(sku);

    // 3. Move LOC-B item to LOC-A (Merge)
    await inventoryPage.clickMoveOnCard(sku, locB);
    await movementModal.moveToLocation(locA);

    // 4. Verify Result
    await inventoryPage.reloadAndSearch(sku);

    // Should be 15 (10 + 5)
    await inventoryPage.verifyQuantity(sku, 15, locA);

    // LOC-B should be gone (0-qty items are hidden by default)
    await inventoryPage.verifyItemNotExists(sku, locB);
  });

  test('should preserve item_name during merge', async ({ inventoryPage, movementModal }) => {
    const sku = BasePage.generateTestId('TEST-NOTE');
    const locA = 'LOC-NOTE-A';
    const locB = 'LOC-NOTE-B';

    // Item A: Note "Original Note"
    await inventoryPage.addItem({
      sku,
      quantity: 10,
      location: locA,
      note: 'Original Note',
    });

    // Item B: Note "New Incoming Note"
    await inventoryPage.addItem({
      sku,
      quantity: 5,
      location: locB,
      note: 'New Incoming Note',
    });

    // Reload
    await inventoryPage.reloadAndSearch(sku);

    // Move B -> A
    await inventoryPage.clickMoveOnCard(sku, locB);
    await movementModal.moveToLocation(locA);

    // Verify A has concatenated note
    await inventoryPage.reloadAndSearch(sku);

    const note = inventoryPage.getNote(sku, locA);
    await expect(note).toContainText('Original Note');
    await expect(note).toContainText('New Incoming Note');
  });
});
