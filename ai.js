// Boekmaat — OpenRouter AI layer (invoice extraction + WhatsApp message parsing)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  for (const p of [path.join(__dirname, '.env')]) {
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, 'utf8').match(/^OPENROUTER_API_KEY\s*=\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const KEY = loadKey();
const MODEL = process.env.AI_MODEL || 'deepseek/deepseek-chat';

export const aiAvailable = () => Boolean(KEY);

async function chatJSON(system, user, retry = 1) {
  if (!KEY) throw new Error('OPENROUTER_API_KEY not configured');
  try {
    return await chatJSONOnce(system, user);
  } catch (err) {
    if (retry > 0) return chatJSON(system, user, retry - 1);
    throw err;
  }
}

async function chatJSONOnce(system, user) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:4780',
      'X-Title': 'Boekmaat',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const jsonText = text.replace(/^```(?:json)?\s*|\s*```$/g, '');
  return JSON.parse(jsonText);
}

const EXTRACT_SYSTEM = `You are the invoice-extraction engine of Boekmaat, a Dutch bookkeeping tool.
You receive the raw text/body of an invoice email (often Dutch, sometimes messy or handwritten-style).
Extract structured data and respond with ONLY a JSON object:
{
  "supplier": string,               // legal/trade name of the supplier
  "invoice_number": string|null,
  "invoice_date": "YYYY-MM-DD"|null,
  "subtotal": number|null,          // amount excl. VAT, in EUR
  "vat": number|null,               // BTW amount in EUR (0 if exempt/vrijgesteld)
  "vat_rate": number|null,          // 21, 9 or 0
  "total": number,                  // amount incl. VAT
  "category": string,               // one of: Materials, Equipment rental, Transport & fuel, Office & admin, Insurance, Payroll, Subcontractors, Other
  "line_items": [{"desc": string, "qty": number, "unit": number, "amount": number}],
  "confidence": number,             // 0-1, your confidence in the extraction
  "notes": string                   // one short English sentence on anything unusual
}
Dutch amount format uses comma decimals ("2.061,60" = 2061.60). "Vrijgesteld van BTW" means VAT-exempt (vat 0, vat_rate 0).
Loonjournaal/payroll documents => category "Payroll". Never invent numbers; use null when absent.`;

export function extractInvoice(rawText) {
  return chatJSON(EXTRACT_SYSTEM, rawText);
}

const PARSE_SYSTEM = (roster) => `Parse foreman WhatsApp messages (Arabic/Dutch, voice notes arrive as transcripts) for a Dutch construction company.
Roster (match names in any language/spelling): ${JSON.stringify(roster)}
Respond ONLY with a JSON object:
{"events":[{"type":"attendance","worker_ids":[int]} | {"type":"absence","worker_ids":[int],"note":string} | {"type":"advance","worker_ids":[int],"amount":number}],"summary":string}
Rules: "نزل فلان"/"is er vandaag" = attendance for the NAMED workers only. "استلف فلان X يورو"/"voorschot" = advance (EUR). "ما نزلش"/"is er niet" = absence.
"الكل"/"iedereen" = the whole roster: e.g. "vandaag iedereen behalve Omar" / "النهارده الكل ما عدا عمر" = attendance for every roster worker EXCEPT the excluded one (and an absence event for the excluded one).
Arabic-Indic numerals: ١٥٠=150, ٢٥٠=250, ٣٠٠=300. A message can contain BOTH attendance and advance — one event per fact.
"summary": one short English sentence describing what was recorded. Chit-chat with no payroll event => {"events":[],"summary":""}.`;

export function parseGroupMessage(text, roster) {
  return chatJSON(PARSE_SYSTEM(roster), text);
}
