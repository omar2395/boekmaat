// Boekmaat — Playwright e2e: drives the primary flows and captures screenshots.
// Run: node e2e.mjs   (server must be running on :4780)
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:4780';
const SHOT = (n) => `screenshots/${n}.png`;
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

// ---------- 1. dashboard (light)
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.kpi-value');
const rev = await page.textContent('.kpi .kpi-value');
if (!rev.includes('€')) fail('dashboard KPIs missing');
await page.waitForTimeout(700); // hbar animations
await page.screenshot({ path: SHOT('01-dashboard'), fullPage: false });
console.log('ok dashboard —', rev.trim());

// ---------- 2. whatsapp live AI parse
await page.click('a[data-route="whatsapp"]');
await page.waitForSelector('#waInput');
await page.fill('#waInput', 'نزل اليوم أحمد وكريم، واستلف عمر ١٥٠ يورو');
await page.press('#waInput', 'Enter');
await page.waitForSelector('.wa-msg.me .wa-tag', { timeout: 45000 });
const tags = await page.$$eval('.wa-msg.me .wa-tag', (els) => els.map((e) => e.textContent));
if (!tags.some((t) => t.includes('attendance')) || !tags.some((t) => t.includes('advance')))
  fail('AI parse missing expected events: ' + JSON.stringify(tags));
await page.waitForTimeout(400);
await page.screenshot({ path: SHOT('02-whatsapp-ai') });
console.log('ok whatsapp AI —', tags.join(' | '));

// ---------- 3. invoice inbox → AI extraction
await page.click('a[data-route="invoices"]');
await page.waitForSelector('#btnExtract', { timeout: 15000 });
await page.click('#btnExtract');
await page.waitForSelector('.conf-meter', { timeout: 60000 });
const supplier = await page.inputValue('#f-supplier');
const total = await page.inputValue('#f-total');
if (!supplier || !total) fail('extraction fields empty');
await page.waitForTimeout(400);
await page.screenshot({ path: SHOT('03-invoice-ai-extract') });
console.log('ok invoice AI —', supplier, '€' + total);

// book it
await page.click('#btnBook');
await page.waitForSelector('.toast');
console.log('ok booked');

// ---------- 4. workers + statement modal
await page.click('a[data-route="workers"]');
await page.waitForSelector('tr.rowlink');
await page.click('#monthSeg button[data-m="2026-06"]');
await page.waitForSelector('tr.rowlink');
await page.click('tr.rowlink [data-stmt]');
await page.waitForSelector('.statement');
await page.waitForTimeout(300);
await page.screenshot({ path: SHOT('04-worker-statement') });
console.log('ok worker statement');
await page.click('.modal-x');

// ---------- 5. BTW + export
await page.click('a[data-route="btw"]');
await page.waitForSelector('.btw-number');
await page.click('#btnExport');
await page.waitForSelector('.toast');
await page.waitForTimeout(400);
await page.screenshot({ path: SHOT('05-btw-export') });
const pos = await page.textContent('.btw-number');
console.log('ok btw —', pos.trim());

// ---------- 6. dark mode dashboard
await page.click('#themeToggle');
await page.click('a[data-route="dashboard"]');
await page.waitForSelector('.kpi-value');
await page.waitForTimeout(800);
await page.screenshot({ path: SHOT('06-dashboard-dark') });
console.log('ok dark mode');

await browser.close();
console.log(process.exitCode ? 'E2E FAILED' : 'E2E PASSED — 6 screenshots in ./screenshots/');
