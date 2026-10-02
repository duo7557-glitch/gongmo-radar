const { test, expect } = require('@playwright/test');
test.beforeEach(async ({ page }) => {
  // Keep testing isolated: no test messages or database writes reach the live project.
  await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.GONGMO_CONFIG = {};' }));
});
test('desktop: right-fixed chat, real/demo separation, search/save/modal and September performance', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/');
  await expect(page.locator('#dataStatus')).toContainText('연결 준비중');
  await expect(page.locator('#ipoRows')).not.toContainText('에코네트웍스');
  const panel = await page.locator('#community').boundingBox();
  expect(panel.x).toBe(1090); expect(panel.width).toBe(350);
  await page.getByRole('button', { name: '예시 화면 보기', exact: true }).click();
  await expect(page.locator('#ipoRows tr')).toHaveCount(4);
  await expect(page.locator('#demoWarning')).toBeVisible();
  await page.locator('#stockSearch').fill('한국투자'); await expect(page.locator('#ipoRows tr')).toHaveCount(1);
  await expect(page.locator('#ipoRows')).toContainText('메디큐브랩');
  await page.locator('#stockSearch').fill('');
  await page.locator('[data-save="demo-0"]').click(); await expect(page.locator('#savedCount')).toHaveText('1');
  await page.locator('#savedFilter').click(); await expect(page.locator('#ipoRows tr')).toHaveCount(1);
  await page.locator('#ipoRows [data-detail]').click(); await expect(page.locator('#detailDialog')).toBeVisible();
  await expect(page.locator('#dialogContent')).toContainText('가상 기업'); await page.locator('#closeDialog').click();
  await page.locator('#savedFilter').click(); await page.locator('#nextMonth').click(); await expect(page.locator('#heroMonth')).toContainText('11월');
  await page.locator('#demoToggle').click(); await expect(page.locator('#ipoRows')).not.toContainText('에코네트웍스');
  await expect(page.locator('#performanceRows tr')).toHaveCount(6); await expect(page.locator('#performanceRows')).toContainText('5거래일 대기');
  await page.locator('#includeSpac').click(); await expect(page.locator('#performanceRows tr')).toHaveCount(9);
  await page.locator('#includeSpac').click();
  await page.locator('#chatName').fill('<img>'); await page.locator('#chatInput').fill('<script>hello</script>'); await page.locator('#sendChat').click();
  await expect(page.locator('#messages')).toContainText('<script>hello</script>'); expect(await page.locator('#messages script').count()).toBe(0);
  await page.locator('#performance').scrollIntoViewIfNeeded();
  const pinned = await page.locator('#community').boundingBox(); expect(pinned.y).toBe(68);
  expect(errors).toEqual([]); await page.screenshot({ path: 'test-results/desktop-performance.png' });
});
test('mobile: page fits viewport and chat remains reachable below the calendar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const widths = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  await page.locator('#community').scrollIntoViewIfNeeded();
  const panel = await page.locator('#community').boundingBox(); expect(panel.width).toBe(390);
  await expect(page.locator('#chatInput')).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-chat.png' });
});
