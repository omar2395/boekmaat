/* Boekmaat SPA */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const main = $('#main');

const fmt = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const eur = (n) => fmt.format(n ?? 0);
const eur2 = (n) => fmt2.format(n ?? 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTH_NAMES = { '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun', '07': 'Jul' };
const monthLabel = (m) => `${MONTH_NAMES[m.slice(5)] ?? m.slice(5)} ’${m.slice(2, 4)}`;
const dstr = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const tstr = (iso) => iso.slice(11, 16);

const api = async (url, opts) => {
  const res = await fetch(url, opts ? { headers: { 'Content-Type': 'application/json' }, ...opts } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

/* ---------------------------------------------------------------- theme */
const themeToggle = $('#themeToggle');
const setTheme = (t) => { document.documentElement.dataset.theme = t; localStorage.setItem('bm-theme', t); };
setTheme(localStorage.getItem('bm-theme') || 'light');
themeToggle.onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

/* ---------------------------------------------------------------- toast */
function toast(msg, sub = '', icon = '✓') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="t-ic">${icon}</span><span>${msg}${sub ? `<small>${sub}</small>` : ''}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 4600);
}

/* ---------------------------------------------------------------- modal */
function openModal(title, bodyHTML, footHTML = '') {
  $('#modalRoot').innerHTML = `
    <div class="modal-scrim">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-bar"><h3>${title}</h3><button class="modal-x" aria-label="Close">✕</button></div>
        <div class="modal-body">${bodyHTML}${footHTML}</div>
      </div>
    </div>`;
  const close = () => { $('#modalRoot').innerHTML = ''; };
  $('.modal-x').onclick = close;
  $('.modal-scrim').onclick = (e) => { if (e.target.classList.contains('modal-scrim')) close(); };
  return close;
}

/* ---------------------------------------------------------------- charts */
function groupedBars(monthly) {
  const W = 620, H = 250, padL = 46, padB = 26, padT = 12;
  const max = Math.max(...monthly.flatMap((m) => [m.revenue, m.expenses])) * 1.12;
  const iw = (W - padL - 10) / monthly.length;
  const bw = Math.min(26, iw / 2.7);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, .25, .5, .75, 1].map((f) => Math.round(max * f / 5000) * 5000).filter((v, i, a) => a.indexOf(v) === i);
  let bars = '', labels = '', grid = '';
  for (const t of ticks) grid += `<line class="gridline" x1="${padL}" x2="${W - 6}" y1="${y(t)}" y2="${y(t)}"/>
    <text x="${padL - 8}" y="${y(t) + 3.5}" text-anchor="end">${t >= 1000 ? (t / 1000) + 'k' : t}</text>`;
  monthly.forEach((m, i) => {
    const cx = padL + iw * i + iw / 2;
    const r = 4;
    const bar = (x, v, cls, color) => {
      const h = Math.max(2, H - padB - y(v));
      return `<rect class="bar ${cls}" data-i="${i}" x="${x}" y="${y(v)}" width="${bw}" height="${h}" rx="${r}" fill="${color}"/>`;
    };
    bars += bar(cx - bw - 1.5, m.revenue, 'b-rev', 'var(--chart-1)');
    bars += bar(cx + 1.5, m.expenses, 'b-exp', 'var(--chart-2)');
    labels += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${monthLabel(m.month)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Monthly revenue vs expenses">
    ${grid}<line class="axisline" x1="${padL}" x2="${W - 6}" y1="${H - padB}" y2="${H - padB}"/>${bars}${labels}</svg>`;
}

function wireBarTips(wrap, monthly) {
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  wrap.appendChild(tip);
  const svg = $('svg', wrap);
  svg.addEventListener('mousemove', (e) => {
    const t = e.target.closest('rect.bar');
    if (!t) { tip.classList.remove('on'); $$('rect.bar', svg).forEach((b) => b.classList.remove('bar-dim')); return; }
    const i = +t.dataset.i, m = monthly[i];
    $$('rect.bar', svg).forEach((b) => b.classList.toggle('bar-dim', +b.dataset.i !== i));
    tip.innerHTML = `<b>${monthLabel(m.month)}${m.synthetic ? ' · pre-Boekmaat' : ''}</b>
      <div class="tt-row"><span class="sw" style="background:var(--chart-1)"></span>Revenue&nbsp;<b>${eur(m.revenue)}</b></div>
      <div class="tt-row"><span class="sw" style="background:var(--chart-2)"></span>Expenses&nbsp;<b>${eur(m.expenses)}</b></div>`;
    const r = wrap.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY - r.top - tip.offsetHeight - 10) + 'px';
    tip.classList.add('on');
  });
  svg.addEventListener('mouseleave', () => { tip.classList.remove('on'); $$('rect.bar', svg).forEach((b) => b.classList.remove('bar-dim')); });
}

function hbars(items) {
  const max = Math.max(...items.map((c) => c.total));
  const seq = ['--seq-5', '--seq-4', '--seq-3', '--seq-2', '--seq-1'];
  return items.map((c, i) => `
    <div class="hbar-row">
      <span class="hbar-label" title="${esc(c.category)}">${esc(c.category)}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(2, c.total / max * 100)}%;background:var(${seq[Math.min(i, 4)]});animation-delay:${i * 60}ms"></div></div>
      <span class="hbar-val">${eur(c.total)}</span>
    </div>`).join('');
}

/* ================================================================ views */
const views = {};

/* ---------------------------------------------------------------- dashboard */
views.dashboard = async () => {
  const s = await api('/api/summary');
  $('#inboxBadge').textContent = s.kpis.inboxCount || '';
  const ai = $('#aiStatus');
  ai.classList.toggle('off', !s.aiAvailable);
  ai.innerHTML = `<span class="live-dot">●</span> AI ${s.aiAvailable ? 'engine live' : 'offline'}`;

  main.innerHTML = `<div class="page">
    <div class="page-head">
      <div>
        <div class="kicker">Thursday 3 July 2026 · Q2 closed</div>
        <h1>Goedemorgen, Tarik</h1>
        <div class="sub">Everything from the crew WhatsApp group and the invoice inbox, already booked. ${s.kpis.inboxCount ? `<strong>${s.kpis.inboxCount} new invoice${s.kpis.inboxCount > 1 ? 's' : ''}</strong> waiting for AI extraction.` : 'Inbox is clear.'}</div>
      </div>
      <a class="btn primary" href="#/btw">Prepare accountant export →</a>
    </div>

    <div class="grid kpis">
      <div class="card kpi"><div class="kpi-label">Revenue · Q2</div><div class="kpi-value">${eur(s.kpis.revenueQ2)}</div><div class="kpi-meta"><b class="up">▲ 12%</b> vs Q1</div></div>
      <div class="card kpi"><div class="kpi-label">Expenses · Q2</div><div class="kpi-value">${eur(s.kpis.expensesQ2)}</div><div class="kpi-meta">${5} suppliers, auto-booked</div></div>
      <div class="card kpi"><div class="kpi-label">Crew cost · June</div><div class="kpi-value">${eur(s.kpis.laborJune)}</div><div class="kpi-meta">6 workers · from WhatsApp</div></div>
      <div class="card kpi flag"><div class="kpi-label">BTW position · Q2</div><div class="kpi-value">${eur(s.kpis.btwPosition)}</div><div class="kpi-meta">to remit before 31 Jul</div></div>
    </div>

    <div class="grid cols-2" style="margin-top:18px">
      <div class="card">
        <h3>Cashflow, six months</h3>
        <div class="card-sub">Booked sales vs purchases + crew wages</div>
        <div class="legend">
          <span><span class="sw" style="background:var(--chart-1)"></span>Revenue</span>
          <span><span class="sw" style="background:var(--chart-2)"></span>Expenses</span>
        </div>
        <div class="chart-wrap" id="barWrap">${groupedBars(s.monthly)}</div>
      </div>
      <div>
        <div class="card">
          <h3>Where the money went</h3>
          <div class="card-sub">Purchases by category · Q2</div>
          ${hbars(s.categories.slice(0, 5))}
        </div>
        <div class="card">
          <h3>Live feed</h3>
          <div class="card-sub">WhatsApp events &amp; invoice inbox</div>
          <ul class="activity">${s.activity.map((a) => `
            <li><span class="act-icon">${{ whatsapp: '💬', invoice: '📥', sale: '🧾' }[a.kind] || '•'}</span>
            <span>${esc(a.text)}<time>${dstr(a.ts)} · ${tstr(a.ts)}</time></span></li>`).join('')}
          </ul>
        </div>
      </div>
    </div>
  </div>`;
  wireBarTips($('#barWrap'), s.monthly);
};

/* ---------------------------------------------------------------- whatsapp */
const EV_LABEL = { attendance: 'attendance', advance: 'advance', absence: 'absence' };
function renderMsg(m, workers) {
  const isMe = m.sender.startsWith('You');
  const events = m.parsed?.events || [];
  const tags = m.status === 'ignored'
    ? `<span class="wa-tag ignored">no event · skipped</span>`
    : events.map((ev) => {
        const names = (ev.worker_ids || []).map((id) => workers[id] || '?').map((n) => n.split(' ')[0]).join(', ');
        return `<span class="wa-tag ${ev.type}">${EV_LABEL[ev.type]}${ev.amount ? ` €${ev.amount}` : ''} · ${names}</span>`;
      }).join('');
  const body = m.kind === 'voice'
    ? `<span class="wa-voice">▶ ${esc(m.text.replace('🎙️', '').trim())} <small>(0:07 · transcribed)</small></span>`
    : esc(m.text);
  return `<div class="wa-msg ${isMe ? 'me' : ''}">
    <div class="bubble">
      <div class="wa-meta"><span class="wa-sender">${esc(m.sender)}</span><time>${dstr(m.ts)} ${tstr(m.ts)}</time></div>
      ${body}
      ${tags ? `<div class="wa-tags">${tags}</div>` : ''}
    </div></div>`;
}
function renderEventCard(m, workers) {
  return (m.parsed?.events || []).map((ev) => {
    const names = (ev.worker_ids || []).map((id) => workers[id] || '?').join(', ');
    return `<div class="event-card ${ev.type}">
      <div class="ev-type">${EV_LABEL[ev.type]} · <time>${dstr(ev.date || m.ts)}</time></div>
      <div class="ev-main">${esc(names)}${ev.type === 'advance' ? ` — <span class="ev-amount">${eur2(ev.amount)}</span> advance` : ''}${ev.type === 'absence' && ev.note ? ` <small>· ${esc(ev.note)}</small>` : ''}</div>
    </div>`;
  }).join('');
}

views.whatsapp = async () => {
  const [msgs, wres] = await Promise.all([api('/api/messages'), api('/api/workers?month=2026-07')]);
  const workers = Object.fromEntries(wres.workers.map((w) => [w.id, w.name]));
  const processed = msgs.filter((m) => m.parsed);

  main.innerHTML = `<div class="page">
    <div class="page-head">
      <div>
        <div class="kicker">WhatsApp listener · group “Ploeg Atlas 🏗️”</div>
        <h1>Crew chat → ledger</h1>
        <div class="sub">The foreman writes in Arabic or Dutch — text or voice. Boekmaat's AI reads every message and books attendance, advances and absences on its own. Try it live below.</div>
      </div>
    </div>
    <div class="wa-layout">
      <div>
        <div class="wa-phone">
          <div class="wa-head">
            <span class="avatar">🏗️</span>
            <span><strong>Ploeg Atlas 🏗️</strong><small>Hassan (voorman), Tarik, 6 workers · Boekmaat bot connected</small></span>
          </div>
          <div class="wa-scroll" id="waScroll">${msgs.map((m) => renderMsg(m, workers)).join('')}</div>
          <form class="wa-compose" id="waForm">
            <input id="waInput" placeholder="Type like the foreman would… (Arabic or Dutch)" autocomplete="off">
            <button class="wa-send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2z"/></svg></button>
          </form>
        </div>
        <div class="chips" id="waChips">
          <button class="chip">نزل اليوم أحمد وبلال ومحمد</button>
          <button class="chip">استلف كريم ١٥٠ يورو النهارده</button>
          <button class="chip">Vandaag iedereen behalve Omar</button>
          <button class="chip">عمر ما نزلش، عيان شوية</button>
        </div>
      </div>
      <div class="card">
        <h3>Parsed ledger events</h3>
        <div class="card-sub">Every green/orange card below was booked automatically — no forms, no spreadsheets.</div>
        <div id="evList">${processed.slice().reverse().map((m) => renderEventCard(m, workers)).join('')}</div>
      </div>
    </div>
  </div>`;

  const scroll = $('#waScroll');
  scroll.scrollTop = scroll.scrollHeight;
  const input = $('#waInput');
  $$('#waChips .chip').forEach((c) => c.onclick = () => { input.value = c.textContent; input.focus(); });

  $('#waForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    scroll.insertAdjacentHTML('beforeend', renderMsg({ sender: 'You', kind: 'text', text, ts: new Date().toISOString(), parsed: null, status: 'pending' }, workers));
    scroll.insertAdjacentHTML('beforeend', `<div class="wa-msg" id="typing"><div class="bubble"><div class="wa-meta"><span class="wa-sender">Boekmaat bot</span></div><span class="wa-typing"><i></i><i></i><i></i></span></div></div>`);
    scroll.scrollTop = scroll.scrollHeight;
    try {
      const r = await api('/api/messages', { method: 'POST', body: JSON.stringify({ text }) });
      $('#typing')?.remove();
      const last = scroll.lastElementChild;
      last.outerHTML = renderMsg({ sender: 'You', kind: 'text', text, ts: r.ts, parsed: r.parsed, status: r.status }, r.workers);
      if (r.parsed?.events?.length) {
        $('#evList').insertAdjacentHTML('afterbegin', renderEventCard({ parsed: r.parsed, ts: r.ts }, r.workers));
        toast('Booked from WhatsApp', r.parsed.summary, '💬');
      } else {
        toast('No ledger event detected', 'Chit-chat is ignored — nothing was booked.', '💤');
      }
      scroll.scrollTop = scroll.scrollHeight;
    } catch (err) {
      $('#typing')?.remove();
      toast('AI parse failed', String(err.message), '⚠️');
    }
  };
};

/* ---------------------------------------------------------------- workers */
views.workers = async (params) => {
  const month = params.get('month') || '2026-07';
  const { workers } = await api(`/api/workers?month=${month}`);
  const totals = workers.reduce((t, w) => ({ days: t.days + w.days, gross: t.gross + w.gross, adv: t.adv + w.advances, net: t.net + w.net }), { days: 0, gross: 0, adv: 0, net: 0 });

  main.innerHTML = `<div class="page">
    <div class="page-head">
      <div>
        <div class="kicker">Crew payroll · day-rate workers</div>
        <h1>Workers</h1>
        <div class="sub">Days counted straight from the WhatsApp group. Click a row for the PDF month statement each worker receives in his private chat.</div>
      </div>
      <div class="seg" id="monthSeg">
        <button data-m="2026-06" class="${month === '2026-06' ? 'on' : ''}">June</button>
        <button data-m="2026-07" class="${month === '2026-07' ? 'on' : ''}">July (live)</button>
      </div>
    </div>
    <div class="card table-scroll">
      <table class="data">
        <thead><tr><th>Worker</th><th>Role</th><th class="num">Day rate</th><th class="num">Days</th><th class="num">Gross</th><th class="num">Advances</th><th class="num">Net payable</th><th></th></tr></thead>
        <tbody>
          ${workers.map((w) => `<tr class="rowlink" data-id="${w.id}">
            <td><span class="worker-cell"><span class="avatar" style="background:${w.color}">${w.name.split(' ').map((p) => p[0]).join('')}</span><span>${esc(w.name)}<small>${esc(w.name_ar)} · ${esc(w.phone)}</small></span></span></td>
            <td>${esc(w.role)}</td>
            <td class="num">${eur2(w.day_rate)}</td>
            <td class="num">${w.days}</td>
            <td class="num">${eur2(w.gross)}</td>
            <td class="num" style="color:${w.advances ? 'var(--accent)' : 'inherit'}">${w.advances ? '−' + eur2(w.advances) : '—'}</td>
            <td class="num"><b>${eur2(w.net)}</b></td>
            <td class="num"><button class="btn ghost" data-stmt="${w.id}">Statement →</button></td>
          </tr>`).join('')}
          <tr><td colspan="3"><b>Month total</b></td><td class="num"><b>${totals.days}</b></td><td class="num"><b>${eur2(totals.gross)}</b></td><td class="num"><b>−${eur2(totals.adv)}</b></td><td class="num"><b>${eur2(totals.net)}</b></td><td></td></tr>
        </tbody>
      </table>
    </div>
  </div>`;

  $$('#monthSeg button').forEach((b) => b.onclick = () => { location.hash = `#/workers?month=${b.dataset.m}`; });
  const openStatement = async (id) => {
    const s = await api(`/api/workers/${id}/statement?month=${month}`);
    const mLabel = new Date(`${month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    openModal(`Month statement — ${esc(s.worker.name)}`, `
      <div class="statement">
        <div class="st-head">
          <div><div class="st-brand">Atlas Bouw B.V.</div><small>Kratonkade 7, 3024 ES Rotterdam · KvK 85231140</small></div>
          <div style="text-align:right"><b>Kešf hisāb · ${mLabel}</b><br><small>${esc(s.worker.name)} (${esc(s.worker.name_ar)}) · ${esc(s.worker.role)}</small></div>
        </div>
        <table class="data">
          <tbody>
            <tr><td>Days worked (from WhatsApp check-ins)</td><td class="num">${s.days.length} × ${eur2(s.worker.day_rate)}</td><td class="num">${eur2(s.gross)}</td></tr>
            ${s.advances.map((a) => `<tr><td>Advance · ${esc(a.note || '')}</td><td class="num">${dstr(a.date)}</td><td class="num">−${eur2(a.amount)}</td></tr>`).join('')}
            <tr class="st-total-row"><td>Net payable</td><td></td><td class="num">${eur2(s.net)}</td></tr>
          </tbody>
        </table>
        <p style="margin-top:14px;color:var(--ink-3);font-size:12px">Sent automatically to ${esc(s.worker.phone)} on WhatsApp on the 1st of each month, as PDF, in Arabic.</p>
      </div>
      <div class="no-print" style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
        <button class="btn" onclick="window.print()">Download PDF</button>
        <button class="btn primary" id="sendWa">Send to WhatsApp</button>
      </div>`);
    $('#sendWa').onclick = () => toast(`Statement sent to ${s.worker.name}`, `PDF delivered to ${s.worker.phone} on WhatsApp`, '📄');
  };
  $$('[data-stmt]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openStatement(b.dataset.stmt); });
  $$('tr.rowlink').forEach((r) => r.onclick = () => openStatement(r.dataset.id));
};

/* ---------------------------------------------------------------- invoices */
let invSel = null;
views.invoices = async () => {
  const invoices = await api('/api/invoices');
  $('#inboxBadge').textContent = invoices.filter((i) => i.status === 'inbox').length || '';
  if (invSel == null || !invoices.some((i) => i.id === invSel)) {
    invSel = (invoices.find((i) => i.status === 'inbox') || invoices[0])?.id ?? null;
  }
  const groups = [['inbox', '📥 Inbox — awaiting AI'], ['review', '🔎 In review'], ['booked', '✓ Booked']];

  main.innerHTML = `<div class="page">
    <div class="page-head">
      <div>
        <div class="kicker">Gmail listener · facturen@atlasbouw.nl</div>
        <h1>Invoice inbox</h1>
        <div class="sub">Every attachment that smells like a <em>factuur</em> lands here. One click and the AI reads it — supplier, BTW, line items — ready to book.</div>
      </div>
    </div>
    <div class="inv-layout">
      <div class="inv-list" id="invList">
        ${groups.map(([st, label]) => {
          const items = invoices.filter((i) => i.status === st);
          if (!items.length) return '';
          return `<div class="inv-group-label">${label}</div>` + items.map((i) => `
            <button class="inv-item ${i.id === invSel ? 'sel' : ''}" data-id="${i.id}">
              <span class="inv-ic">${i.direction === 'sale' ? '🧾' : '📄'}</span>
              <span><strong>${esc(i.supplier)}</strong><small>${esc(i.subject || '')}</small></span>
              <span class="inv-amt">${i.total != null ? eur2(i.total) : '<span class="badge inbox">new</span>'}</span>
            </button>`).join('');
        }).join('')}
      </div>
      <div id="invDetail"></div>
    </div>
  </div>`;

  const renderDetail = (inv) => {
    const d = $('#invDetail');
    if (!inv) { d.innerHTML = `<div class="empty"><div class="empty-ic">📭</div>Select an invoice</div>`; return; }
    const conf = inv.ai_confidence != null ? Math.round(inv.ai_confidence * 100) : null;
    const fields = inv.status !== 'inbox' ? `
      <div class="field-grid">
        <div class="field-wide"><label>Supplier</label><input id="f-supplier" value="${esc(inv.supplier)}"></div>
        <div><label>Invoice #</label><input id="f-number" value="${esc(inv.invoice_number || '')}"></div>
        <div><label>Date</label><input id="f-date" type="date" value="${esc(inv.invoice_date || '')}"></div>
        <div><label>Subtotal (excl.)</label><input id="f-subtotal" type="number" step="0.01" value="${inv.subtotal ?? ''}"></div>
        <div><label>BTW ${inv.vat_rate != null ? `(${inv.vat_rate}%)` : ''}</label><input id="f-vat" type="number" step="0.01" value="${inv.vat ?? ''}"></div>
        <div><label>Total (incl.)</label><input id="f-total" type="number" step="0.01" value="${inv.total ?? ''}"></div>
        <div><label>Category</label><select id="f-category">
          ${['Materials', 'Equipment rental', 'Transport & fuel', 'Office & admin', 'Insurance', 'Payroll', 'Subcontractors', 'Other', inv.category].filter((c, i, a) => c && a.indexOf(c) === i).map((c) => `<option ${c === inv.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select></div>
      </div>
      ${inv.line_items?.length ? `<div class="table-scroll"><table class="data">
        <thead><tr><th>Line item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
        <tbody>${inv.line_items.map((l) => `<tr><td>${esc(l.desc)}</td><td class="num">${l.qty ?? ''}</td><td class="num">${l.unit != null ? eur2(l.unit) : ''}</td><td class="num">${eur2(l.amount)}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}` : '';

    d.innerHTML = `<div class="card">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <h3>${esc(inv.supplier)}</h3>
          <div class="card-sub">${esc(inv.email_from || '')} · received ${dstr(inv.received_at)}</div>
        </div>
        <span class="badge ${inv.status}">${inv.status}</span>
      </div>
      ${inv.raw_text ? `<div class="inv-group-label" style="margin-left:0">Original email</div><div class="raw-mail">${esc(inv.raw_text)}</div>` : ''}
      <div id="extractZone">
        ${inv.status === 'inbox' ? `
          <div style="display:flex;gap:12px;align-items:center;margin-top:16px;flex-wrap:wrap">
            <button class="btn primary" id="btnExtract"><span>✨</span> Extract with AI</button>
            <span style="color:var(--ink-3);font-size:12.5px">AI · reads Dutch, finds BTW, categorises</span>
          </div>` : `
          ${conf != null ? `<div class="conf-meter" style="margin:14px 0 2px"><span class="badge ai">AI extracted</span><div class="conf-track"><div class="conf-fill" style="width:${conf}%"></div></div>${conf}% confidence</div>` : ''}
          ${fields}
          ${inv.status === 'review' ? `<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
            <button class="btn primary" id="btnBook">Book entry ✓</button></div>` : ''}
        `}
      </div>
    </div>`;

    $('#btnExtract')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> Reading invoice…`;
      $('#extractZone').insertAdjacentHTML('beforeend', `
        <div class="field-grid" style="margin-top:16px">
          ${'<div class="shimmer" style="height:38px"></div>'.repeat(6)}
        </div>`);
      try {
        const updated = await api(`/api/invoices/${inv.id}/extract`, { method: 'POST', body: '{}' });
        toast('AI extraction complete', updated.ai_notes || `${updated.supplier} · ${eur2(updated.total)} incl. ${eur2(updated.vat)} BTW`, '✨');
        views.invoices();
      } catch (err) {
        btn.disabled = false; btn.innerHTML = '<span>✨</span> Extract with AI';
        $('#extractZone .field-grid')?.remove();
        $('#extractZone').insertAdjacentHTML('beforeend', `<div class="error-note" style="margin-top:12px">AI call failed: ${esc(err.message)}</div>`);
      }
    });

    $('#btnBook')?.addEventListener('click', async () => {
      const body = {
        supplier: $('#f-supplier').value, invoice_number: $('#f-number').value,
        invoice_date: $('#f-date').value, subtotal: +$('#f-subtotal').value || null,
        vat: +$('#f-vat').value || 0, total: +$('#f-total').value || null,
        category: $('#f-category').value,
      };
      await api(`/api/invoices/${inv.id}/book`, { method: 'POST', body: JSON.stringify(body) });
      toast('Entry booked', `${body.supplier} → ${body.category} · lands in Q3 BTW return`, '✓');
      views.invoices();
    });
  };

  renderDetail(invoices.find((i) => i.id === invSel));
  $$('.inv-item').forEach((b) => b.onclick = () => {
    invSel = +b.dataset.id;
    $$('.inv-item').forEach((x) => x.classList.toggle('sel', +x.dataset.id === invSel));
    renderDetail(invoices.find((i) => i.id === invSel));
  });
};

/* ---------------------------------------------------------------- btw */
views.btw = async (params) => {
  const q = params.get('q') || '2026-Q2';
  const r = await api(`/api/btw?quarter=${q}`);
  const rateName = (x) => x.vat_rate === 21 ? 'hoog 21%' : x.vat_rate === 9 ? 'laag 9%' : 'vrijgesteld / 0%';

  main.innerHTML = `<div class="page">
    <div class="page-head">
      <div>
        <div class="kicker">Belastingdienst · quarterly BTW return</div>
        <h1>BTW &amp; accountant export</h1>
        <div class="sub">The quarterly reconciliation your accountant usually bills hours for — computed live from every booked invoice and wage day.</div>
      </div>
      <div class="seg" id="qSeg">
        ${['2026-Q1', '2026-Q2'].map((x) => `<button data-q="${x}" class="${x === q ? 'on' : ''}">${x.split('-')[1]} 2026</button>`).join('')}
      </div>
    </div>

    <div class="card btw-hero">
      <div class="kicker">Position · ${q}</div>
      <div class="btw-number">${eur2(r.position)}</div>
      <div class="btw-sub">${r.position >= 0 ? 'to remit to the Belastingdienst' : 'refund due from the Belastingdienst'} · deadline ${q.endsWith('Q2') ? '31 July 2026' : '30 April 2026'}</div>
      <div class="btw-flow"><span>BTW collected <b>${eur2(r.output.vat)}</b></span> <span>−</span> <span>BTW paid <b>${eur2(r.input.vat)}</b></span> <span>=</span> <span>position <b>${eur2(r.position)}</b></span></div>
    </div>

    <div class="btw-cols" style="margin-top:18px">
      <div class="card">
        <h3>Output — sales</h3>
        <div class="card-sub">${r.output.invoices} sales invoices · ${eur(r.output.net)} net</div>
        <table class="data"><tbody>
          ${r.byRate.filter((x) => x.direction === 'sale').map((x) => `<tr><td>${rateName(x)}</td><td class="num">${eur2(x.net)}</td><td class="num"><b>${eur2(x.vat)}</b></td></tr>`).join('') || '<tr><td colspan="3" style="color:var(--ink-3)">No sales booked this quarter</td></tr>'}
        </tbody></table>
      </div>
      <div class="card">
        <h3>Input — purchases (voorbelasting)</h3>
        <div class="card-sub">${r.input.invoices} purchase invoices · ${eur(r.input.net)} net</div>
        <table class="data"><tbody>
          ${r.byRate.filter((x) => x.direction === 'purchase').map((x) => `<tr><td>${rateName(x)}</td><td class="num">${eur2(x.net)}</td><td class="num"><b>${eur2(x.vat)}</b></td></tr>`).join('') || '<tr><td colspan="3" style="color:var(--ink-3)">No purchases booked this quarter</td></tr>'}
        </tbody></table>
      </div>
    </div>

    <div class="card" style="margin-top:18px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
      <div>
        <h3>One-click handover</h3>
        <div class="card-sub" style="margin:0">Verkoop, inkoop, lonen and the BTW summary — zipped up as CSVs and mailed to <b>J. de Vries</b>, your accountant.</div>
      </div>
      <button class="btn primary" id="btnExport">📤 Export &amp; email to accountant</button>
    </div>
  </div>`;

  $$('#qSeg button').forEach((b) => b.onclick = () => { location.hash = `#/btw?q=${b.dataset.q}`; });
  $('#btnExport').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Building export…`;
    try {
      const res = await api('/api/export', { method: 'POST', body: JSON.stringify({ quarter: q }) });
      btn.innerHTML = '✓ Sent';
      toast(`Export sent to ${res.sentTo}`, res.files.join(' · '), '📤');
      setTimeout(() => { btn.disabled = false; btn.innerHTML = '📤 Export & email to accountant'; }, 3500);
    } catch (err) {
      btn.disabled = false; btn.innerHTML = '📤 Export & email to accountant';
      toast('Export failed', err.message, '⚠️');
    }
  };
};

/* ---------------------------------------------------------------- router */
async function route() {
  const hash = location.hash || '#/dashboard';
  const [path, qs] = hash.slice(2).split('?');
  const name = views[path] ? path : 'dashboard';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  main.innerHTML = `<div class="skel-page"><div class="shimmer" style="min-height:64px"></div><div class="shimmer" style="min-height:130px"></div><div class="shimmer" style="min-height:280px"></div></div>`;
  try {
    await views[name](new URLSearchParams(qs || ''));
  } catch (err) {
    main.innerHTML = `<div class="page"><div class="empty"><div class="empty-ic">🔌</div><b>Could not reach the Boekmaat server.</b><br><span style="font-size:13px">${esc(err.message)}</span></div></div>`;
  }
}
window.addEventListener('hashchange', route);
route();
