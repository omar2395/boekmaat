// Boekmaat — database layer (node:sqlite, zero native deps)
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'boekmaat.db');

const RESET = process.argv.includes('--reset');
if (RESET && fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH);

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT,
  role TEXT,
  day_rate REAL NOT NULL,
  phone TEXT,
  color TEXT
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  date TEXT NOT NULL,
  source TEXT DEFAULT 'seed',
  UNIQUE(worker_id, date)
);
CREATE TABLE IF NOT EXISTS advances (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  sender TEXT NOT NULL,
  kind TEXT DEFAULT 'text',
  text TEXT NOT NULL,
  ts TEXT NOT NULL,
  parsed TEXT,
  status TEXT DEFAULT 'processed'
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  direction TEXT NOT NULL,           -- 'purchase' | 'sale'
  supplier TEXT,
  email_from TEXT,
  subject TEXT,
  received_at TEXT,
  invoice_number TEXT,
  invoice_date TEXT,
  subtotal REAL,
  vat REAL,
  vat_rate REAL,
  total REAL,
  category TEXT,
  status TEXT DEFAULT 'inbox',       -- 'inbox' | 'review' | 'booked'
  raw_text TEXT,
  line_items TEXT,
  ai_confidence REAL
);
`);

// ---------------------------------------------------------------- seeding
const hasData = db.prepare('SELECT COUNT(*) AS n FROM workers').get().n > 0;

if (!hasData) {
  const insWorker = db.prepare(
    'INSERT INTO workers (name, name_ar, role, day_rate, phone, color) VALUES (?,?,?,?,?,?)');
  const workers = [
    ['Ahmed Khalil',    'أحمد',  'Metselaar',   180, '+31 6 •••• 8837', '#1e7a54'],
    ['Youssef Amrani',  'يوسف',  'Timmerman',   170, '+31 6 •••• 0921', '#e4570a'],
    ['Mohammed Saidi',  'محمد',  'Opperman',    140, '+31 6 •••• 4409', '#8a5a2b'],
    ['Karim Bouali',    'كريم',  'Stukadoor',   175, '+31 6 •••• 5518', '#2b5a8a'],
    ['Omar Haddad',     'عمر',   'Tegelzetter', 185, '+31 6 •••• 7736', '#6b4a8a'],
    ['Bilal Cherkaoui', 'بلال',  'Schilder',    150, '+31 6 •••• 2210', '#8a2b4a'],
  ];
  for (const w of workers) insWorker.run(...w);

  // Q2 2026 attendance (Apr–Jun): workdays Mon–Fri, with per-worker absences
  const insAtt = db.prepare('INSERT OR IGNORE INTO attendance (worker_id, date, source) VALUES (?,?,?)');
  for (const [mIdx, mm, lastDay] of [[3, '04', 30], [4, '05', 31], [5, '06', 30]]) {
    const workdays = [];
    for (let d = 1; d <= lastDay; d++) {
      const dow = new Date(Date.UTC(2026, mIdx, d)).getUTCDay();
      if (dow >= 1 && dow <= 5) workdays.push(`2026-${mm}-${String(d).padStart(2, '0')}`);
    }
    for (let wid = 1; wid <= 6; wid++) {
      workdays.forEach((date, i) => {
        // deterministic pseudo-random absences, ~2 per worker per month
        if ((i * 7 + wid * 3 + mIdx) % 11 === 0) return;
        insAtt.run(wid, date, 'whatsapp');
      });
    }
  }
  // July 2026 so the current month isn't empty (Jul 1 = Wed, Jul 2 = Thu)
  for (const date of ['2026-07-01', '2026-07-02']) {
    for (const wid of [1, 2, 3, 4, 5]) insAtt.run(wid, date, 'whatsapp');
  }
  insAtt.run(6, '2026-07-02', 'whatsapp');

  const insAdv = db.prepare('INSERT INTO advances (worker_id, date, amount, note) VALUES (?,?,?,?)');
  insAdv.run(3, '2026-06-05', 250, 'سلفة — طلبها في الجروب');
  insAdv.run(1, '2026-06-12', 400, 'Voorschot huur');
  insAdv.run(5, '2026-06-19', 200, 'سلفة');
  insAdv.run(6, '2026-06-24', 150, 'Voorschot');
  insAdv.run(2, '2026-07-01', 300, 'سلفة أول الشهر');

  // ------------------------------------------------------------ messages
  const insMsg = db.prepare(
    'INSERT INTO messages (sender, kind, text, ts, parsed, status) VALUES (?,?,?,?,?,?)');
  const P = (events, summary) => JSON.stringify({ events, summary });
  const msgs = [
    ['Hassan (voorman)', 'text', 'صباح الخير يا شباب ☀️', '2026-06-29T06:41:00', null, 'ignored'],
    ['Hassan (voorman)', 'text', 'نزل اليوم أحمد ويوسف وكريم وعمر على مشروع Havenkade',
      '2026-06-29T06:44:00',
      P([{ type: 'attendance', worker_ids: [1, 2, 4, 5], date: '2026-06-29' }],
        '4 workers checked in — Havenkade site'), 'processed'],
    ['Hassan (voorman)', 'text', 'Mohammed is er vandaag ook, hij begint om 9 uur',
      '2026-06-29T07:02:00',
      P([{ type: 'attendance', worker_ids: [3], date: '2026-06-29' }],
        'Mohammed Saidi checked in (late start 09:00)'), 'processed'],
    ['Hassan (voorman)', 'voice', '🎙️ بلال ما نزلش النهارده، عنده موعد في الجيمينتا',
      '2026-06-29T07:15:00',
      P([{ type: 'absence', worker_ids: [6], date: '2026-06-29', note: 'Gemeente appointment' }],
        'Bilal Cherkaoui absent — municipal appointment (voice note transcribed)'), 'processed'],
    ['Hassan (voorman)', 'text', 'استلف محمد ٢٥٠ يورو من المكتب النهارده',
      '2026-06-30T12:20:00',
      P([{ type: 'advance', worker_ids: [3], amount: 250, date: '2026-06-30' }],
        '€250 advance recorded for Mohammed Saidi'), 'processed'],
    ['Hassan (voorman)', 'text', 'نزل اليوم الكل ما عدا بلال', '2026-06-30T06:38:00',
      P([{ type: 'attendance', worker_ids: [1, 2, 3, 4, 5], date: '2026-06-30' },
         { type: 'absence', worker_ids: [6], date: '2026-06-30' }],
        'Everyone in except Bilal Cherkaoui'), 'processed'],
    ['Hassan (voorman)', 'text', 'الأسمنت خلص، هطلب من Bouwmaat بكرة الصبح', '2026-06-30T14:05:00', null, 'ignored'],
    ['Hassan (voorman)', 'text', 'نزل اليوم أحمد ويوسف ومحمد وكريم وعمر — بداية الشهر 💪',
      '2026-07-01T06:35:00',
      P([{ type: 'attendance', worker_ids: [1, 2, 3, 4, 5], date: '2026-07-01' }],
        '5 workers checked in — first day of July'), 'processed'],
    ['Hassan (voorman)', 'text', 'استلف يوسف ٣٠٠ يورو، اخصمها من كشف الشهر',
      '2026-07-01T11:48:00',
      P([{ type: 'advance', worker_ids: [2], amount: 300, date: '2026-07-01' }],
        '€300 advance recorded for Youssef Amrani'), 'processed'],
    ['Hassan (voorman)', 'voice', '🎙️ النهارده الكل موجود، حتى بلال رجع من الإجازة',
      '2026-07-02T06:40:00',
      P([{ type: 'attendance', worker_ids: [1, 2, 3, 4, 5, 6], date: '2026-07-02' }],
        'All 6 workers checked in (voice note transcribed)'), 'processed'],
  ];
  for (const m of msgs) insMsg.run(...m);

  // ------------------------------------------------------------ invoices
  const insInv = db.prepare(`INSERT INTO invoices
    (direction, supplier, email_from, subject, received_at, invoice_number, invoice_date,
     subtotal, vat, vat_rate, total, category, status, raw_text, line_items, ai_confidence)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const li = (...items) => JSON.stringify(items.map(([desc, qty, unit, amount]) => ({ desc, qty, unit, amount })));

  // --- booked purchases (Apr–Jun 2026) ---
  const purchases = [
    ['Bouwmaat Rotterdam', 'facturen@bouwmaat.nl', 'Factuur 2026-18821 — Bouwmaat Zakelijk', '2026-04-06T08:12:00', 'BM-2026-18821', '2026-04-04',
      2380.17, 499.83, 21, 2880.00, 'Materials',
      li(['Metselcement 25kg', 120, 8.95, 1074.00], ['Kalkzandsteen blokken', 400, 2.45, 980.00], ['Speciekuip 65L', 6, 54.37, 326.17])],
    ['Boels Verhuur', 'invoice@boels.com', 'Huurfactuur week 15-16 — Boels', '2026-04-20T10:44:00', 'BOELS-774301', '2026-04-18',
      1652.89, 347.11, 21, 2000.00, 'Equipment rental',
      li(['Steiger 8m huur (2 wkn)', 1, 1240.00, 1240.00], ['Trilplaat huur', 1, 412.89, 412.89])],
    ['Stiho Bouwstoffen', 'administratie@stiho.nl', 'Factuur ST-99120', '2026-05-04T09:03:00', 'ST-99120', '2026-05-02',
      3140.50, 659.51, 21, 3800.01, 'Materials',
      li(['Vuren balkhout 46x196', 85, 21.30, 1810.50], ['OSB3 platen 18mm', 70, 19.00, 1330.00])],
    ['Shell Tankpas', 'zakelijk@shell.nl', 'Maandfactuur tankpas mei', '2026-06-02T07:30:00', 'SH-2026-0553', '2026-05-31',
      743.80, 156.20, 21, 900.00, 'Transport & fuel',
      li(['Diesel bedrijfsbussen (mei)', 1, 743.80, 743.80])],
    ['KPN Zakelijk', 'facturatie@kpn.com', 'KPN Zakelijk mei 2026', '2026-05-28T06:15:00', 'KPN-88231-05', '2026-05-27',
      165.29, 34.71, 21, 200.00, 'Office & admin',
      li(['Mobiel Onbeperkt 8 sims', 1, 132.23, 132.23], ['Zakelijk internet keet', 1, 33.06, 33.06])],
    ['Gamma Zakelijk', 'facturen@gamma.nl', 'Factuur GZ-4471902', '2026-06-09T13:22:00', 'GZ-4471902', '2026-06-08',
      991.74, 208.26, 21, 1200.00, 'Materials',
      li(['Gipsplaten 2600x600', 90, 7.85, 706.50], ['Afwerkprofielen', 45, 6.34, 285.24])],
    ['BMN Bouwmaterialen', 'invoices@bmn.nl', 'Factuur BMN-20260612', '2026-06-13T08:58:00', 'BMN-20260612', '2026-06-12',
      4132.23, 867.67, 21, 4999.90, 'Materials',
      li(['Isolatie PIR 100mm', 60, 42.50, 2550.00], ['Dakpannen antraciet', 800, 1.85, 1480.00], ['Panlatten', 40, 2.56, 102.23])],
    ['Interpolis Verzekeringen', 'polis@interpolis.nl', 'Premienota Q2 CAR-verzekering', '2026-04-10T11:00:00', 'IP-Q2-30998', '2026-04-08',
      1450.00, 0, 0, 1450.00, 'Insurance',
      li(['CAR-verzekering Q2 2026 (vrijgesteld)', 1, 1450.00, 1450.00])],
    ['Boels Verhuur', 'invoice@boels.com', 'Huurfactuur week 24-25 — Boels', '2026-06-22T10:12:00', 'BOELS-781266', '2026-06-20',
      1239.67, 260.33, 21, 1500.00, 'Equipment rental',
      li(['Hoogwerker huur (2 wkn)', 1, 1239.67, 1239.67])],
  ];
  for (const p of purchases) insInv.run('purchase', p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], 'booked', null, p[11], 0.98);

  // --- booked sales (Apr–Jun 2026) ---
  const sales = [
    ['VvE De Havenkade', 'beheer@havenkade-vve.nl', 'Verkoopfactuur 2026-041 — termijn 2', '2026-04-15T09:00:00', 'ATL-2026-041', '2026-04-15',
      38016.53, 7983.47, 21, 46000.00, 'Renovation — Havenkade',
      li(['Gevelrenovatie termijn 2/4', 1, 38016.53, 38016.53])],
    ['Blokland Vastgoed BV', 'administratie@bloklandvastgoed.nl', 'Verkoopfactuur 2026-047', '2026-05-11T09:00:00', 'ATL-2026-047', '2026-05-11',
      28925.62, 6074.38, 21, 35000.00, 'Fit-out — Meent 88',
      li(['Casco afbouw winkelruimte', 1, 28925.62, 28925.62])],
    ['Fam. Verhoeven', 'j.verhoeven@ziggo.nl', 'Verkoopfactuur 2026-052 — aanbouw', '2026-05-27T09:00:00', 'ATL-2026-052', '2026-05-27',
      22935.78, 2064.22, 9, 25000.00, 'Extension — private',
      li(['Aanbouw keuken (arbeid, 9% renovatie)', 1, 22935.78, 22935.78])],
    ['VvE De Havenkade', 'beheer@havenkade-vve.nl', 'Verkoopfactuur 2026-058 — termijn 3', '2026-06-16T09:00:00', 'ATL-2026-058', '2026-06-16',
      38016.53, 7983.47, 21, 46000.00, 'Renovation — Havenkade',
      li(['Gevelrenovatie termijn 3/4', 1, 38016.53, 38016.53])],
    ['Gemeente Rotterdam — Stadsbeheer', 'crediteuren@rotterdam.nl', 'Verkoopfactuur 2026-060', '2026-06-24T09:00:00', 'ATL-2026-060', '2026-06-24',
      14876.03, 3123.97, 21, 18000.00, 'Maintenance contract',
      li(['Herstel bestrating Kop van Zuid', 1, 14876.03, 14876.03])],
  ];
  for (const s of sales) insInv.run('sale', s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], s[10], 'booked', null, s[11], 1.0);

  // --- inbox purchases (need AI extraction) — messy raw email bodies ---
  const inbox = [
    ['Technische Unie', 'noreply@technischeunie.nl', 'Uw factuur 62-2026-88410 van Technische Unie', '2026-07-01T07:52:00',
`Geachte klant,

Hierbij ontvangt u de factuur voor uw bestelling van 29 juni.

TECHNISCHE UNIE B.V.
Bergweidedijk 40, Deventer
KvK 38012340 | BTW NL001432571B01

Factuurnummer: 62-2026-88410
Factuurdatum: 30-06-2026
Debiteurnummer: 5541002
Referentie: project HAVENKADE fase 3

Omschrijving                            Aantal    Prijs      Bedrag
Installatiedraad VD 2,5mm2 100m           12     EUR 38,90   EUR 466,80
Wandcontactdoos inbouw RAL9010            60     EUR  4,25   EUR 255,00
Groepenkast 3-fase 12 groepen              2     EUR 389,00  EUR 778,00
Kabelgoot 60x40 2m                        30     EUR  6,80   EUR 204,00

Subtotaal                                            EUR 1.703,80
BTW 21%                                              EUR   357,80
Totaal te voldoen                                    EUR 2.061,60

Betaling binnen 30 dagen o.v.v. factuurnummer.
Met vriendelijke groet, Technische Unie`],
    ['Van Keulen Hout', 'facturatie@vankeulenhout.nl', 'Factuur VKH26-3319 // spoedlevering', '2026-07-02T09:41:00',
`Beste heer Aydin,

zoals telefonisch besproken de factuur vd spoedlevering van dinsdag. excuses voor de rommelige opmaak, ons systeem was down dus dit is even handmatig :)

van keulen hout en plaatmateriaal bv - rotterdam
btw nr NL8571.22.334.B01

fact.nr: VKH26-3319   datum: 01/07/2026

geleverd op locatie havenkade:
- 24x underlayment plaat 18mm 122x244 a 34,50 = 828,-
- 16x meranti stijl 68x114 a 61,25 = 980,-
- bezorging + kraan = 145,-

totaal excl: 1.953,00
btw 21procent: 410,13
TOTAAL: 2.363,13 euro

graag overmaken naar NL91 RABO 0312 4455 67. bedankt!`],
    ['Salarisverwerking Nmbrs', 'noreply@nmbrs.nl', 'Loonjournaal juni 2026 — Atlas Bouw B.V.', '2026-07-02T16:20:00',
`ATLAS BOUW B.V. — LOONJOURNAALPOST JUNI 2026
Verloningsronde: 2026-06 | Verwerkingsdatum: 02-07-2026
Document: LJP-2026-06-ATB

Brutolonen productie                 EUR 21.480,00
Werkgeverslasten (svw/pens.)         EUR  5.798,40
Reservering vakantiegeld             EUR  1.718,40
------------------------------------------------
Totaal loonkosten                    EUR 28.996,80

Dit betreft een interne journaalpost; loonkosten zijn vrijgesteld van BTW.
Nmbrs | automatische verzending`],
  ];
  for (const inv of inbox) insInv.run('purchase', inv[0], inv[1], inv[2], inv[3],
    null, null, null, null, null, null, null, 'inbox', inv[4], null, null);
}

export default db;
