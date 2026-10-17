// "Add word with AI" end to end, with Gemini stubbed. No live API calls.
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
page.on('dialog', (d) => d.accept());
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) failed++; };

const KEY = 'TEST-KEY-123';
const calls = [];
await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
  const req = route.request();
  calls.push({ url: req.url(), key: req.headers()['x-goog-api-key'], body: req.postDataJSON() });
  const answer = { options: [{ native: '傘', reading: 'kasa', english: 'Umbrella', sense: 'rain umbrella', tag: 'shopping', keywords: ['brolly'] }] };
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }] }) });
});

try {
  await page.goto(base);
  await page.waitForSelector('.welcome button, .bar');
  if (await page.$('.welcome button')) await page.click('.welcome button:has([data-pack="ja"])');
  await page.waitForSelector('.list .row');

  // No key: a search miss looks as it always has.
  await page.goto(`${base}#/phrasebook`);
  await page.waitForSelector('.phrase');
  await page.fill('.search', 'umbrella');
  await page.waitForSelector('text=No phrase found');
  check('no key: no AI button on a search miss', !(await page.$('button:has-text("with AI")')));

  // Setup link saves the key and strips it from the URL.
  await page.goto(`${base}#setup?gemini=${KEY}`);
  await page.reload();
  await page.waitForSelector('input[aria-label="Gemini API key"]');
  check('setup link strips the key from the URL', !page.url().includes(KEY) && page.url().endsWith('#/settings'), page.url());
  check('setup link saves the key', (await page.inputValue('input[aria-label="Gemini API key"]')) === KEY);

  // Search miss → add → save.
  await page.click('.tabs a[data-path="/phrasebook"]');
  await page.waitForSelector('.phrase');
  await page.fill('.search', 'umbrella');
  await page.click('button:has-text("Add \'umbrella\' with AI")');
  await page.waitForSelector('dialog.sheet[open]');
  await page.click('dialog.sheet button:has-text("Generate")');
  await page.waitForSelector('dialog.sheet .option');
  check('sheet shows the option with reading and sense', (await page.textContent('dialog.sheet .option')).includes('kasa') && (await page.textContent('dialog.sheet .option')).includes('rain umbrella'));
  check('request sends the key in a header and the English only', calls.length === 1 && calls[0].key === KEY && !calls[0].url.includes(KEY)
    && calls[0].body.contents[0].parts[0].text === 'umbrella' && calls[0].url.includes('gemini-3.8-flash:generateContent'));
  await page.click('dialog.sheet button:has-text("Save to My words")');
  await page.waitForSelector('dialog.sheet', { state: 'detached' });

  // Appears with the badge, under My words and in its topic.
  await page.waitForSelector('.chip.on:has-text("My words")');
  const row = '.phrase:has-text("Umbrella")';
  check('saved word is listed under My words with a Mine badge', (await page.textContent(`${row} .tag`)) === 'Mine');
  await page.click('.chips .chip:has-text("Shopping")');
  await page.waitForSelector('.chip.on:has-text("Shopping")');
  check('saved word appears in its topic', !!(await page.$(row)));
  await page.reload();
  await page.waitForSelector('.phrase');
  await page.fill('.search', 'brolly');
  check('saved word survives a reload and is found by keyword', !!(await page.$(row)));
  await page.goto(`${base}#/`);
  await page.waitForSelector('.list .row');
  check('lessons are unaffected', !(await page.textContent('main')).includes('Umbrella'));

  // Delete from its full-size view.
  await page.goto(`${base}#/phrasebook?list=mine`);
  await page.click(`${row} a`);
  await page.waitForSelector('.show-text');
  check('full-size view shows the native text', (await page.textContent('.show-text')) === '傘');
  await page.click('button:has-text("Delete from My words")');
  await page.waitForSelector('.chips');
  check('after delete, My words is gone', !(await page.$('.chip:has-text("My words")')) && !(await page.$(row)));
  await page.fill('.search', 'umbrella');
  await page.waitForSelector('text=No phrase found');
  check('after delete, the search misses again', !(await page.$(row)));
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
