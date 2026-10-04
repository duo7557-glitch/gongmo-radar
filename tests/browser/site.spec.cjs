const { test, expect } = require('@playwright/test');
test.beforeEach(async ({ page }) => {
  // Keep testing isolated: no test messages or database writes reach the live project.
  await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.GONGMO_CONFIG = {};' }));
});
test('desktop: right-fixed chat, real/demo separation, search/save/modal and September performance', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/');
  await expect(page.locator('#dataStatus')).toContainText(/연결 준비중|연결됨/);
  await expect(page.locator('#ipoRows')).not.toContainText('에코네트웍스');
  const panel = await page.locator('#community').boundingBox();
  expect(panel.width).toBeGreaterThanOrEqual(270); expect(panel.x + panel.width).toBe(1440);
  await expect(page.locator('script[src="board.js"]')).toHaveCount(0);
  await expect(page.locator('#board')).toHaveCount(0);
  await page.getByRole('button', { name: '예시 화면 보기', exact: true }).click();
  await expect(page.locator('#ipoRows tr')).toHaveCount(3);
  await expect(page.locator('#ipoRows')).toContainText('상장 미정');
  await expect(page.locator('#ipoRows .discussion-pending')).toHaveCount(3);
  const weekCard = await page.locator('#weekCard').boundingBox(), liveCard = await page.locator('#live').boundingBox();
  expect(liveCard.x >= weekCard.x + weekCard.width || liveCard.y >= weekCard.y + weekCard.height).toBe(true);
  await expect(page.locator('#demoWarning')).toBeVisible();
  await expect(page.locator('.agenda-item')).toHaveCount(3);
  await page.locator('#quickFilter [data-quick="active"]').click(); await expect(page.locator('#quickFilter [data-quick="active"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#quickFilter [data-quick="all"]').click();
  await page.locator('#viewSwitch [data-view="calendar"]').click(); await expect(page.locator('#calendarView')).toBeVisible();
  await page.locator('#viewSwitch [data-view="list"]').click();
  await page.locator('#stockSearch').fill('한국투자'); await expect(page.locator('#ipoRows tr')).toHaveCount(1);
  await expect(page.locator('#ipoRows')).toContainText('메디큐브랩');
  await page.locator('#stockSearch').fill('');
  await page.locator('[data-save="demo-0"]').first().click(); await expect(page.locator('#savedCount')).toHaveText('1');
  await page.locator('#savedFilter').click(); await expect(page.locator('#ipoRows tr')).toHaveCount(1);
  await page.evaluate(() => { window.PriceHistory = { ...window.PriceHistory, items: [{ name: '에코네트웍스', code: '123456', listedAt: '2026-10-20' }, ...window.PriceHistory.items] }; });
  await page.locator('#refreshData').click();
  await expect(page.locator('#ipoRows a.discussion-shortcut')).toHaveAttribute('href', 'https://stock.naver.com/domestic/stock/123456/discussion');
  await page.locator('#ipoRows [data-detail]').click(); await expect(page.locator('#detailDialog')).toBeVisible();
  await expect(page.locator('#dialogContent')).toContainText('가상 기업');
  await expect(page.locator('#dialogContent')).toContainText('상장 10. 20');
  await expect(page.locator('#dialogContent a[href*="/discussion"]')).toHaveCount(0);
  await page.locator('#closeDialog').click();
  await page.locator('#savedFilter').click(); await page.locator('#nextMonth').click(); await expect(page.locator('#heroMonth')).toContainText('11월');
  await page.locator('#demoToggle').click(); await expect(page.locator('#ipoRows')).not.toContainText('에코네트웍스');
  await expect(page.locator('#performanceRows tr')).toHaveCount(6); await expect(page.locator('#performanceRows')).toContainText('5거래일 대기');
  await page.locator('#includeSpac').click(); await expect(page.locator('#performanceRows tr')).toHaveCount(9);
  await page.locator('#includeSpac').click();
  await page.locator('#performancePrev').click();
  await expect(page.locator('#performance h2')).toHaveText('2026년 8월, 상장 후 성과');
  await expect(page.locator('#performanceRows tr')).toHaveCount(6);
  await expect(page.locator('#performanceRows')).toContainText('인제니아테라퓨틱스');
  await expect(page.locator('#performanceRows')).not.toContainText('스카이랩스');
  await expect(page.locator('#performanceRows')).not.toContainText('5거래일 대기');
  await expect(page.locator('#performanceRows tr').filter({ hasText: '딜리셔스' })).toContainText('-44.0%');
  await expect(page.locator('#performanceStats')).toContainText('6개 종목 집계');
  await expect(page.locator('#priceChart .spark-card')).toHaveCount(6);
  await page.locator('#includeSpac').click();
  await expect(page.locator('#performanceRows tr')).toHaveCount(6);
  await page.locator('#performanceNext').click();
  await expect(page.locator('#performanceRows tr')).toHaveCount(9);
  await expect(page.locator('#performance h2')).toHaveText('2026년 9월, 상장 후 성과');
  await page.locator('#includeSpac').click();
  await expect(page.locator('[data-prompt]')).toHaveCount(0);
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
  await page.locator('#performancePrev').click();
  await expect(page.locator('#performanceRows')).toContainText('해치텍');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#community').scrollIntoViewIfNeeded();
  const panel = await page.locator('#community').boundingBox(); expect(panel.width).toBe(390);
  await expect(page.locator('#chatInput')).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-chat.png' });
});

test('calculator shows traditional ttasang profit and chat has no suggestion chips', async ({ page }) => {
  await page.goto('/');
  await page.locator('#chickenOpen').click();
  await expect(page.locator('#miniTtasangProfitResult')).toHaveText('+30,000원');
  await expect(page.locator('#miniTtasangNote')).toContainText('52,000원');
  await page.locator('#miniAllocated').fill('2');
  await expect(page.locator('#miniTtasangProfitResult')).toHaveText('+62,000원');
  await expect(page.locator('.chat-prompts')).toHaveCount(0);
});

test('footer links to readable policy and guide pages', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.site-footer')).toHaveCSS('position', 'fixed');
  await expect(page.locator('.site-footer')).toHaveCSS('bottom', '0px');
  expect((await page.locator('.site-footer').boundingBox()).width).toBeGreaterThan(800);
  await expect(page.locator('.site-footer a[href="policy/"]')).toHaveText('이용약관·개인정보 안내');
  await expect(page.locator('#openContact')).toHaveText('문의·신고');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  const pageScrollBeforeContact = await page.evaluate(() => window.scrollY);
  await page.locator('#openContact').click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(pageScrollBeforeContact);
  await expect(page.locator('#contact')).toBeVisible();
  const contactRect = await page.locator('#contact').boundingBox();
  expect(contactRect.y).toBeGreaterThanOrEqual(0);
  expect(contactRect.y + contactRect.height).toBeLessThanOrEqual((await page.evaluate(() => innerHeight)));
  await expect(page.locator('#contact')).toContainText('광고 제휴 문의');
  await expect(page.locator('#contact')).toContainText('arcmangsk@naver.com');
  await expect(page.locator('#contact')).toContainText('메일 앱이 자동으로 열리지는 않습니다');
  await page.locator('#closeContact').click();
  await page.locator('#openSupport').click();
  await expect(page.locator('#supportDialog')).toBeVisible();
  await expect(page.locator('#supportDialog')).toContainText('토스뱅크');
  await expect(page.locator('#supportAccount')).toHaveText('1000-0259-4445');
  await expect(page.locator('#quickPaySupport')).toHaveAttribute('href', /^supertoss:\/\/send\?/);
  await expect(page.locator('.support-qr')).toHaveAttribute('src', 'toss-support-qr.png');
  await expect(page.locator('#supportDialog')).toContainText('공모주 레이더의 운영 및 개선에 사용됩니다');
  await page.locator('#closeSupport').click();
  await expect(page.locator('#webStatus')).toHaveText('응답 중');
  await expect(page.locator('#apiStatus')).toHaveText(/미연결|API 응답/);
  await page.goto('/policy/');
  await expect(page).toHaveTitle(/이용약관·개인정보 안내/);
  await expect(page.getByRole('heading', { name: '이용약관 및 개인정보 안내' })).toBeVisible();
  await expect(page.locator('#privacy')).toContainText('닉네임과 메시지 내용');
  await expect(page.locator('#support')).toContainText('기부금 영수증을 발급하지 않으며');
  await expect(page.locator('#contact')).toContainText('arcmangsk@naver.com');
  await page.goto('/guide/');
  await expect(page).toHaveTitle(/이용 가이드/);
  await expect(page.getByRole('heading', { name: '월별 청약 캘린더' })).toBeVisible();
  await expect(page.locator('#score')).toContainText('45%');
  await expect(page.locator('#reminder')).toContainText('페이지가 열려 있는 동안');
});

test('top news buttons switch to news and scroll there without hiding it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#news')).toBeAttached();
  await page.locator('#heroNewsButton').click();
  await expect(page.locator('.split-right')).toHaveAttribute('data-view', 'news');
  await expect(page.locator('#news')).toBeVisible();
  await expect(page.locator('#news')).toContainText('공모주 뉴스');
});

test('news search filters IPO headlines and shows a clear no-results message', async ({ page }) => {
  await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.GONGMO_CONFIG = {supabaseUrl: "https://news-test.supabase.co"};' }));
  await page.route('**/functions/v1/news*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ items: [
      { title: '알파테크 공모주 수요예측 시작', source: '경제뉴스', summary: '기관 투자자의 수요예측 소식', link: 'https://example.com/alpha', published: '2026-10-04T01:00:00Z' },
      { title: '베타바이오 신규 상장 일정', source: '증권일보', summary: '공모주 청약 및 상장 정보', link: 'https://example.com/beta', published: '2026-10-04T02:00:00Z' }
    ], fetchedAt: '2026-10-04T03:00:00Z' })
  }));
  await page.goto('/');
  await page.locator('.split-tabs [data-target="news"]').click();
  await expect(page.locator('#newsSearch')).toBeVisible();
  await expect(page.locator('#newsList .news-item')).toHaveCount(2);
  await page.locator('#newsSearch').fill('알파테크');
  await expect(page.locator('#newsList .news-item')).toHaveCount(1);
  await expect(page.locator('#newsList')).toContainText('알파테크 공모주 수요예측 시작');
  await page.locator('#newsSearch').fill('없는 종목');
  await expect(page.locator('#newsList')).toContainText('검색 결과가 없습니다');
  await page.locator('#newsSearch').fill('');
  await expect(page.locator('#newsList .news-item')).toHaveCount(2);
});
