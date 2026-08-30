/**
 * The two frames the main run could not photograph honestly.
 *
 * `page.route` intercepts the BROWSER's requests, and these pages fetch on the
 * server — so the stubbed 500 never reached the code under test and the frame
 * showed the cached 48 hours. The state is captured here with the API genuinely
 * stopped and Next's fetch cache cleared, which is the real thing rather than a
 * picture of it.
 */
import { chromium } from 'playwright';

const OUT = 'docs/review';
const SF = 'http://localhost:3000';

const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1700 } });
  await ctx.addInitScript((t) => window.localStorage.setItem('tg-theme', t), theme);
  const page = await ctx.newPage();
  for (const [slug, name] of [
    ['returns-and-refunds', 'legal-returns-unavailable'],
    ['grading', 'legal-grading-unavailable'],
    ['warranty', 'legal-warranty-unavailable'],
    ['grievance', 'legal-grievance-unavailable'],
  ]) {
    await page.goto(`${SF}/legal/${slug}`, { waitUntil: 'networkidle' });
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (/\b48 hours\b|\b85 %/.test(text)) {
      throw new Error(`${slug} still shows a live value — this is not the unavailable state`);
    }
    for (const w of [1440, 900, 600]) {
      await page.setViewportSize({ width: w, height: 1700 });
      await page.waitForTimeout(350);
      const suffix = w === 1440 ? '' : `-${w}`;
      await page.screenshot({ path: `${OUT}/${name}-${theme}${suffix}.png`, fullPage: true });
      console.log('captured', `${name}-${theme}${suffix}`);
    }
    await page.setViewportSize({ width: 1440, height: 1700 });
  }
  await ctx.close();
}
await browser.close();
console.log('done');
