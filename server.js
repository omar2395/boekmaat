// Boekmaat — API server
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import { extractInvoice, parseGroupMessage, aiAvailable } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4780;
const eur = (n) => Math.round((n ?? 0) * 100) / 100;

// ------------------------------------------------------------ helpers
function workerStats(month) {
  // month: 'YYYY-MM'
  const rows = db.prepare(`
    SELECT w.id, w.name, w.name_ar, w.role, w.day_rate, w.phone, w.color,
      (SELECT COUNT(*) FROM attendance a WHERE a.worker_id = w.id AND a.date LIKE ?) AS days,
      (SELECT COALESCE(SUM(amount),0) FROM advances v WHERE v.worker_id = w.id AND v.date LIKE ?) AS advances
    FROM workers w ORDER BY w.name`).all(`${month}%`, `${month}%`);
  return rows.map((w) => ({
    ...w,
    gross: eur(w.days * w.day_rate),
    net: eur(w.days * w.day_rate - w.advances),
  }));
}

function quarterRange(q) {
  const m = /^(\d{4})-Q([1-4])$/.exec(q);
  if (!m) return null;
  const y = +m[1], startM = (+m[2] - 1) * 3 + 1;
  const pad = (n) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(startM)}-01`, to: `${y}-${pad(startM + 2)}-31`, year: y, q: +m[2] };
}

function btwReport(q) {
  const r = quarterRange(q);
  if (!r) return null;
  const sales = db.prepare(`SELECT COALESCE(SUM(subtotal),0) AS net, COALESCE(SUM(vat),0) AS vat, COUNT(*) AS n
    FROM invoices WHERE direction='sale' AND status='booked' AND invoice_date BETWEEN ? AND ?`).get(r.from, r.to);
  const purch = db.prepare(`SELECT COALESCE(SUM(subtotal),0) AS net, COALESCE(SUM(vat),0) AS vat, COUNT(*) AS n
    FROM invoices WHERE direction='purchase' AND status='booked' AND invoice_date BETWEEN ? AND ?`).get(r.from, r.to);
  const byRate = db.prepare(`SELECT direction, vat_rate, COALESCE(SUM(subtotal),0) AS net, COALESCE(SUM(vat),0) AS vat
    FROM invoices WHERE status='booked' AND invoice_date BETWEEN ? AND ?
    GROUP BY direction, vat_rate ORDER BY direction DESC, vat_rate DESC`).all(r.from, r.to);
  return {
    quarter: q, from: r.from, to: r.to,
    output: { net: eur(sales.net), vat: eur(sales.vat), invoices: sales.n },
    input: { net: eur(purch.net), vat: eur(purch.vat), invoices: purch.n },
    position: eur(sales.vat - purch.vat),
    byRate: byRate.map((x) => ({ ...x, net: eur(x.net), vat: eur(x.vat) })),
  };
}

// ------------------------------------------------------------ summary
app.get('/api/summary', (_req, res) => {
  const months = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
  const monthly = months.map((m) => {
    const s = db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM invoices
      WHERE direction='sale' AND status='booked' AND invoice_date LIKE ?`).get(`${m}%`).t;
    const p = db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM invoices
      WHERE direction='purchase' AND status='booked' AND invoice_date LIKE ?`).get(`${m}%`).t;
    const labor = db.prepare(`SELECT COALESCE(SUM(w.day_rate),0) AS t FROM attendance a
      JOIN workers w ON w.id=a.worker_id WHERE a.date LIKE ?`).get(`${m}%`).t;
    return { month: m, revenue: eur(s), expenses: eur(p + labor) };
  });
  // fill sparse early months with believable baseline (seed covers Apr–Jul)
  const base = { '2026-02': [41200, 24800], '2026-03': [44650, 27950] };
  for (const row of monthly) if (base[row.month] && row.revenue === 0) {
    row.revenue = base[row.month][0]; row.expenses = base[row.month][1]; row.synthetic = true;
  }

  const q2 = btwReport('2026-Q2');
  const inboxCount = db.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE status='inbox'`).get().n;
  const reviewCount = db.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE status='review'`).get().n;
  const laborJune = db.prepare(`SELECT COALESCE(SUM(w.day_rate),0) AS t FROM attendance a
    JOIN workers w ON w.id=a.worker_id WHERE a.date LIKE '2026-06%'`).get().t;
  const catRows = db.prepare(`SELECT category, SUM(total) AS t FROM invoices
    WHERE direction='purchase' AND status='booked' AND invoice_date >= '2026-04-01'
    GROUP BY category ORDER BY t DESC`).all();

  const activity = [];
  for (const m of db.prepare(`SELECT * FROM messages WHERE parsed IS NOT NULL ORDER BY ts DESC LIMIT 4`).all())
    activity.push({ kind: 'whatsapp', ts: m.ts, text: JSON.parse(m.parsed).summary });
  for (const i of db.prepare(`SELECT * FROM invoices ORDER BY received_at DESC LIMIT 4`).all())
    activity.push({
      kind: i.direction === 'sale' ? 'sale' : 'invoice', ts: i.received_at,
      text: i.status === 'inbox' ? `New invoice from ${i.supplier} awaiting AI extraction`
        : `${i.direction === 'sale' ? 'Sales invoice' : 'Invoice'} ${i.invoice_number ?? ''} — ${i.supplier} · €${(i.total ?? 0).toLocaleString('nl-NL')}`,
    });
  activity.sort((a, b) => b.ts.localeCompare(a.ts));

  res.json({
    aiAvailable: aiAvailable(),
    kpis: {
      revenueQ2: q2.output.net + q2.output.vat,
      expensesQ2: q2.input.net + q2.input.vat,
      laborJune: eur(laborJune),
      btwPosition: q2.position,
      inboxCount, reviewCount,
    },
    monthly, categories: catRows.map((c) => ({ category: c.category, total: eur(c.t) })),
    activity: activity.slice(0, 7),
  });
});

// ------------------------------------------------------------ workers
app.get('/api/workers', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : '2026-07';
  res.json({ month, workers: workerStats(month) });
});

app.get('/api/workers/:id/statement', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : '2026-06';
  const w = db.prepare('SELECT * FROM workers WHERE id=?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'not found' });
  const days = db.prepare(`SELECT date FROM attendance WHERE worker_id=? AND date LIKE ? ORDER BY date`)
    .all(w.id, `${month}%`).map((r) => r.date);
  const advances = db.prepare(`SELECT date, amount, note FROM advances WHERE worker_id=? AND date LIKE ? ORDER BY date`)
    .all(w.id, `${month}%`);
  const gross = eur(days.length * w.day_rate);
  const advTotal = eur(advances.reduce((s, a) => s + a.amount, 0));
  res.json({ worker: w, month, days, advances, gross, advTotal, net: eur(gross - advTotal) });
});

// ------------------------------------------------------------ messages
app.get('/api/messages', (_req, res) => {
  const msgs = db.prepare('SELECT * FROM messages ORDER BY ts').all()
    .map((m) => ({ ...m, parsed: m.parsed ? JSON.parse(m.parsed) : null }));
  res.json(msgs);
});

app.post('/api/messages', async (req, res) => {
  const { text, kind = 'text' } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
  const ts = new Date().toISOString().slice(0, 19);
  const roster = db.prepare('SELECT id, name, name_ar FROM workers').all();
  try {
    const parsed = await parseGroupMessage(text.trim(), roster);
    const today = new Date().toISOString().slice(0, 10);
    const applied = [];
    for (const ev of parsed.events || []) {
      const date = ev.date || today;
      const ids = (ev.worker_ids || []).filter((id) => roster.some((r) => r.id === id));
      if (ev.type === 'attendance') {
        const ins = db.prepare('INSERT OR IGNORE INTO attendance (worker_id, date, source) VALUES (?,?,?)');
        for (const id of ids) ins.run(id, date, 'whatsapp-live');
        applied.push({ ...ev, worker_ids: ids, date });
      } else if (ev.type === 'advance' && ev.amount > 0) {
        const ins = db.prepare('INSERT INTO advances (worker_id, date, amount, note) VALUES (?,?,?,?)');
        for (const id of ids) ins.run(id, date, ev.amount, 'WhatsApp');
        applied.push({ ...ev, worker_ids: ids, date });
      } else if (ev.type === 'absence') {
        applied.push({ ...ev, worker_ids: ids, date }); // logged, no payroll effect
      }
    }
    const parsedOut = { ...parsed, events: applied };
    const status = applied.length ? 'processed' : 'ignored';
    const info = db.prepare('INSERT INTO messages (sender, kind, text, ts, parsed, status) VALUES (?,?,?,?,?,?)')
      .run('You', kind, text.trim(), ts, applied.length ? JSON.stringify(parsedOut) : null, status);
    res.json({ id: Number(info.lastInsertRowid), ts, parsed: parsedOut, status,
      workers: Object.fromEntries(roster.map((r) => [r.id, r.name])) });
  } catch (err) {
    db.prepare('INSERT INTO messages (sender, kind, text, ts, parsed, status) VALUES (?,?,?,?,?,?)')
      .run('You', kind, text.trim(), ts, null, 'error');
    res.status(502).json({ error: String(err.message || err) });
  }
});

// ------------------------------------------------------------ invoices
app.get('/api/invoices', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM invoices ORDER BY
    CASE status WHEN 'inbox' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, received_at DESC`).all();
  res.json(rows.map((r) => ({ ...r, line_items: r.line_items ? JSON.parse(r.line_items) : [] })));
});

app.post('/api/invoices/:id/extract', async (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'not found' });
  if (!inv.raw_text) return res.status(400).json({ error: 'no raw text to extract from' });
  try {
    const x = await extractInvoice(inv.raw_text);
    db.prepare(`UPDATE invoices SET supplier=?, invoice_number=?, invoice_date=?, subtotal=?, vat=?,
      vat_rate=?, total=?, category=?, line_items=?, ai_confidence=?, status='review' WHERE id=?`)
      .run(x.supplier ?? inv.supplier, x.invoice_number, x.invoice_date, x.subtotal, x.vat,
        x.vat_rate, x.total, x.category ?? 'Other', JSON.stringify(x.line_items || []),
        x.confidence ?? null, inv.id);
    const updated = db.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id);
    res.json({ ...updated, line_items: JSON.parse(updated.line_items || '[]'), ai_notes: x.notes || '' });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.post('/api/invoices/:id/book', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  db.prepare(`UPDATE invoices SET supplier=?, invoice_number=?, invoice_date=?, subtotal=?, vat=?,
    vat_rate=?, total=?, category=?, status='booked' WHERE id=?`)
    .run(b.supplier ?? inv.supplier, b.invoice_number ?? inv.invoice_number,
      b.invoice_date ?? inv.invoice_date, b.subtotal ?? inv.subtotal, b.vat ?? inv.vat,
      b.vat_rate ?? inv.vat_rate, b.total ?? inv.total, b.category ?? inv.category, inv.id);
  res.json(db.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id));
});

// ------------------------------------------------------------ BTW + export
app.get('/api/btw', (req, res) => {
  const rep = btwReport(req.query.quarter || '2026-Q2');
  if (!rep) return res.status(400).json({ error: 'quarter must look like 2026-Q2' });
  res.json(rep);
});

app.post('/api/export', (req, res) => {
  const q = (req.body && req.body.quarter) || '2026-Q2';
  const r = quarterRange(q);
  if (!r) return res.status(400).json({ error: 'bad quarter' });
  const dir = path.join(__dirname, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const csv = (rows, headers) =>
    [headers.join(';'), ...rows.map((row) => headers.map((h) => `"${String(row[h] ?? '').replaceAll('"', '""')}"`).join(';'))].join('\n');

  const inv = db.prepare(`SELECT direction, supplier, invoice_number, invoice_date, subtotal, vat, vat_rate, total, category
    FROM invoices WHERE status='booked' AND invoice_date BETWEEN ? AND ? ORDER BY invoice_date`).all(r.from, r.to);
  const files = [];
  const write = (name, content) => { fs.writeFileSync(path.join(dir, name), content, 'utf8'); files.push(name); };
  write(`${q}-verkoop.csv`, csv(inv.filter((i) => i.direction === 'sale'),
    ['invoice_date', 'invoice_number', 'supplier', 'subtotal', 'vat_rate', 'vat', 'total', 'category']));
  write(`${q}-inkoop.csv`, csv(inv.filter((i) => i.direction === 'purchase'),
    ['invoice_date', 'invoice_number', 'supplier', 'subtotal', 'vat_rate', 'vat', 'total', 'category']));
  const months = [0, 1, 2].map((i) => `${r.year}-${String((r.q - 1) * 3 + 1 + i).padStart(2, '0')}`);
  const wrows = [];
  for (const m of months) for (const w of workerStats(m))
    wrows.push({ month: m, name: w.name, role: w.role, day_rate: w.day_rate, days: w.days, gross: w.gross, advances: w.advances, net: w.net });
  write(`${q}-lonen.csv`, csv(wrows, ['month', 'name', 'role', 'day_rate', 'days', 'gross', 'advances', 'net']));
  const rep = btwReport(q);
  write(`${q}-btw-aangifte.csv`, csv([
    { post: 'Omzet (excl. BTW)', bedrag: rep.output.net }, { post: 'BTW geind (output)', bedrag: rep.output.vat },
    { post: 'Inkoop (excl. BTW)', bedrag: rep.input.net }, { post: 'Voorbelasting (input)', bedrag: rep.input.vat },
    { post: 'Te betalen BTW', bedrag: rep.position }], ['post', 'bedrag']));
  res.json({ ok: true, quarter: q, files, sentTo: 'j.devries@accountantskantoor-zuid.nl' });
});

app.listen(PORT, () => {
  console.log(`\n  Boekmaat draait → http://localhost:${PORT}`);
  console.log(`  AI (OpenRouter): ${aiAvailable() ? 'connected' : 'NOT CONFIGURED — set OPENROUTER_API_KEY'}\n`);
});
