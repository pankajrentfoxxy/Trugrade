/** The r.4(2) footer, in both themes, after the copyright-line fix. */
import { chromium } from 'playwright';
const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1700 } });
  await ctx.addInitScript((t) => window.localStorage.setItem('tg-theme', t), theme);
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/legal', { waitUntil: 'networkidle' });
  const text = (await page.locator('footer').innerText()).replace(/\s+/g, ' ');
  if (text.includes('Ltd..')) throw new Error('the doubled full stop is still there');
  await page.locator('footer').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.locator('footer').screenshot({ path: `docs/review/legal-footer-${theme}.png` });
  console.log('captured', `legal-footer-${theme}`);
  await ctx.close();
}
await browser.close();
