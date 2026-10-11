// Clicks the back button on every screen that has one and checks it stays inside the app.
// Run: npm run e2e   (starts its own vite server; set CHROMIUM_PATH to use a local browser)
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 0 }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '') + '/';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) failed++; };

try {
  await page.goto(base);
  await page.waitForSelector('.welcome button, .bar');
  if (await page.$('.welcome button')) await page.click('.welcome button:has([data-pack="ja"])'); // the suite's text checks are Japanese
  await page.waitForSelector('.list .row');
  check('Learn lists topics', (await page.$$('.list .row')).length > 0);

  const routes = ['/lesson', '/lesson?more=1', '/topic?id=food', '/lesson?topic=food', '/numbers', '/prices',
    '/dialogue', '/dialogue?id=d-ramen', '/dialogue?id=d-ramen&back=%2Ftopic%3Fid%3Dfood',
    '/show?id=p-ikura&list=survival', '/show?id=h-nanmei&list=heard', '/show?id=p-mizu&list=food&back=%2Ftopic%3Fid%3Dfood'];
  for (const r of routes) {
    await page.goto(`${base}#${r}`);
    await page.waitForSelector('.bar');
    const back = await page.$('a.back');
    if (!back) { check(`${r} has back link`, false); continue; }
    const href = await back.getAttribute('href');
    await back.click();
    await page.waitForSelector('.bar');
    check(`${r} back -> ${href}`, href.startsWith('#/') && page.url().startsWith(base) && !(await page.content()).includes('404'), page.url());
  }

  // Reported bug: back from mid-lesson returns home.
  await page.goto(`${base}#/lesson`);
  await page.waitForSelector('.flash');
  // New cards are taught first. Step past them to the first quiz card.
  while (await page.$('.btn.learn')) await page.click('.btn.learn');
  await page.click('.flash');
  await page.click('.btn.g2');
  await page.click('a.back');
  await page.waitForSelector('.bar');
  check('lesson mid-session back -> Learn', page.url() === `${base}#/`);

  // Phrasebook: search, Survival list, staff lines link to a reply, show card returns to its list.
  await page.click('.tabs a[data-path="/phrasebook"]');
  await page.waitForSelector('.phrase');
  check('Phrasebook tab is active', (await page.getAttribute('.tabs a.on', 'data-path')) === '/phrasebook');
  await page.fill('.search', 'toilet');
  check('phrasebook search finds toilet', (await page.$$('.phrase')).length >= 1);
  await page.fill('.search', '');
  await page.click('.chips .chip:has-text("Survival")');
  await page.waitForSelector('.chip.on:has-text("Survival")');
  check('Survival lists 10 phrases', (await page.$$('.phrase')).length === 10);
  await page.click('.phrase a');
  await page.waitForSelector('.show-text');
  check('survival row opens a show card', (await page.textContent('.show-text')) === 'すみません');
  await page.click('a.back');
  await page.waitForSelector('.chip.on:has-text("Survival")');
  check('show card back -> Survival list', page.url().endsWith('#/phrasebook?list=survival'));
  await page.click('.chips .chip:has-text("They say")');
  await page.waitForSelector('.chip.on:has-text("They say")');
  await page.click('.phrase a[href*="h-nanmei"]');
  await page.waitForSelector('.show-text');
  await page.click('a.row[href*="p-futari"]');
  await page.waitForFunction(() => document.querySelector('.show-text')?.textContent !== '何名様ですか');
  check('staff line links to its reply', (await page.textContent('.show-text')) === '二人です');
  check('reply card has no prev/next outside its list', !(await page.$('.grades a')));
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
