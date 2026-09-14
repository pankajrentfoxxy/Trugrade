/**
 * Stage 1 — prove `data-surface="hub"` restyles the admin console without breaking
 * it, and that removing the attribute restores the prior look.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = 'docs/review/supplier-hub';
const BASE = 'http://localhost:5173';

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log('captured', name);
}

async function capture(width, suffix) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  await shot(page, `1-admin-baseline-${suffix}`);
  await page.evaluate(() => document.documentElement.setAttribute('data-surface', 'hub'));
  await page.waitForTimeout(200);
  await shot(page, `1-admin-hub-${suffix}`);
  await page.evaluate(() => document.documentElement.removeAttribute('data-surface'));
  await page.waitForTimeout(200);
  await shot(page, `1-admin-restored-${suffix}`);

  await browser.close();
}

await mkdir(OUT, { recursive: true });
for (const [width, suffix] of [
  [1900, '1900'],
  [1440, '1440'],
  [600, '600'],
]) {
  await capture(width, suffix);
}
