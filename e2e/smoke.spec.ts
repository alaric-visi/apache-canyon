import { expect, test, type Page } from '@playwright/test';

/** Collect uncaught errors and console errors (ignoring third-party font fetches). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

const seconds = async (page: Page) => Number((await page.locator('#time').textContent()) ?? 0);

test('desktop: boots, starts the campaign and flies for 30 seconds without errors', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop flow');
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#menu .menu-item').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#menu .menu-item.sel')).toContainText('CAMPAIGN');

  await page.keyboard.press('Space'); // launch the highlighted CAMPAIGN
  await expect(page.locator('#progress')).toHaveClass(/on/);

  await page.keyboard.down('KeyZ');
  const end = Date.now() + 30_000;
  let dir = 'ArrowLeft';
  while (Date.now() < end && !(await page.locator('#panel').isVisible())) {
    await page.keyboard.down(dir);
    await page.waitForTimeout(700);
    await page.keyboard.up(dir);
    dir = dir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
  }
  await page.keyboard.up('KeyZ');

  // either still flying with time on the clock, or a debrief after a crash: both are healthy
  const debrief = await page.locator('#panel').isVisible();
  if (!debrief) expect(await seconds(page)).toBeGreaterThanOrEqual(10);
  expect(Number(await page.locator('#score').textContent())).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('desktop: menus are keyboard-navigable (options and back)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop flow');
  const errors = watchErrors(page);
  await page.goto('/');
  // the menu is rendered once the game has booted (fonts + renderer); keys before that go nowhere
  await expect(page.locator('#menu .menu-item.sel')).toContainText('CAMPAIGN', { timeout: 20_000 });
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('#menu .menu-item.sel')).toContainText('OPTIONS');
  await page.keyboard.press('Enter');
  await expect(page.locator('#panelTitle')).toHaveText('OPTIONS');
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu .menu-item').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('phone: touch controls appear and steer the gunship', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch flow');
  const errors = watchErrors(page);
  await page.goto('/');
  await page.locator('#menu .menu-item').first().tap(); // CAMPAIGN
  await expect(page.locator('#touch')).toHaveClass(/on/);
  await expect(page.locator('#touch .t-buttons button')).toHaveCount(4);

  // a tap on FLARE must reach the sim: the flare count drops (works in every engine)
  await expect(page.locator('#flares')).toHaveText('3');
  await page.locator('#touch .t-buttons button[data-b="flare"]').tap();
  await expect(page.locator('#flares')).toHaveText('2');

  // drag-steering with synthetic touches, where the engine lets scripts construct Touch objects
  // (WebKit doesn't; the flare check above already proves touch input works there)
  const dragged = await page.evaluate(async () => {
    const zone = document.querySelector('#touch .t-zone') as HTMLElement;
    const r = zone.getBoundingClientRect();
    let mk: (x: number, y: number) => Touch;
    try {
      new Touch({ identifier: 0, target: zone, clientX: 0, clientY: 0 });
      mk = (x, y) => new Touch({ identifier: 1, target: zone, clientX: x, clientY: y });
    } catch {
      return false;
    }
    const x0 = r.left + r.width / 2, y0 = r.top + r.height * 0.6;
    zone.dispatchEvent(new TouchEvent('touchstart', { touches: [mk(x0, y0)], changedTouches: [mk(x0, y0)], bubbles: true, cancelable: true }));
    for (let i = 1; i <= 20; i++) {
      await new Promise((res) => setTimeout(res, 30));
      const t = mk(x0 - i * 4, y0);
      zone.dispatchEvent(new TouchEvent('touchmove', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
    }
    await new Promise((res) => setTimeout(res, 2500));
    const t = mk(x0 - 80, y0);
    zone.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }));
    return true;
  });
  // auto-fire while steering should have scored something
  if (dragged) expect(Number(await page.locator('#score').textContent())).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('installable and playable offline after one visit', async ({ page, context, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || isMobile, 'service-worker check runs once, in desktop Chromium');
  await page.goto('/');
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifest).toBeTruthy();
  const res = await page.request.get(manifest!);
  expect((await res.json()).icons.length).toBeGreaterThanOrEqual(3);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#menu .menu-item').first()).toBeVisible();
  await expect(page.locator('#gameCanvas')).toBeVisible();
});
