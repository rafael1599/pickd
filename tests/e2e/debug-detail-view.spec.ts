import { test, expect } from '../fixtures/test-base';

test('debug: ItemDetailView opens then closes', async ({ page, inventoryPage }) => {
  await inventoryPage.goto('/');

  const addBtn = page.locator('button[title="Add New SKU"]');
  await expect(addBtn).toBeVisible({ timeout: 15000 });

  // Track portal lifecycle
  await page.evaluate(() => {
    const w = window as unknown as Record<string, string[]>;
    w.__portalLog = [];
    w.__popstateLog = [];

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          const cls = (n as Element).className || '';
          if (cls.includes('100020')) {
            w.__portalLog.push(`ADDED at ${Date.now()}`);
          }
        }
        for (const n of m.removedNodes) {
          const cls = (n as Element).className || '';
          if (cls.includes('100020')) {
            w.__portalLog.push(`REMOVED at ${Date.now()}`);
          }
        }
      }
    });
    obs.observe(document.body, { childList: true });

    window.addEventListener('popstate', () => {
      w.__popstateLog.push(`popstate at ${Date.now()}`);
    });
  });

  await addBtn.click();
  await page.waitForTimeout(3000);

  const portalLog = await page.evaluate(
    () => (window as unknown as Record<string, string[]>).__portalLog
  );
  const popstateLog = await page.evaluate(
    () => (window as unknown as Record<string, string[]>).__popstateLog
  );
  console.log('Portal lifecycle:', JSON.stringify(portalLog));
  console.log('Popstate events:', JSON.stringify(popstateLog));

  // Check history length
  const histLen = await page.evaluate(() => history.length);
  console.log('History length:', histLen);
});
