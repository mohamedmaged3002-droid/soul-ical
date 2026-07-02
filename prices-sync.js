/**
 * prices-sync.js — Soul nightly price sync.
 *
 * Reads the Soul "Soul Availability" Google Sheet's PRICE tabs (the single
 * source of truth for pricing) and writes per-night rates into the Soul
 * Supabase `unit_daily_prices` table for the bookable horizon.
 *
 * The sheet stores MONTHLY rates (JUNE/JULY/AUGUST/September columns) per unit,
 * plus a single flat "weekend season" rate for Sokhna. "Blocked"/"block"/blank
 * for a month => that month is unavailable (no rows written => the site renders
 * those nights blocked, per the per-night-truth pricing model).
 *
 * Matching: sheet unit code (column A) -> units.source_code (normalised).
 * Refresh: for every priced unit, delete its horizon rows then insert fresh, so
 * a month that flips to Blocked correctly disappears. PK is (wp_post_id, date).
 *
 *   node prices-sync.js            # writes
 *   DRY_RUN=1 node prices-sync.js  # parse + report only, no DB writes
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SOUL_SHEET_ID (+ Google auth
 * as used by src/sheets.js). HORIZON_END optional (default 2026-09-30).
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { fetchGrid } = require('./src/sheets.js');
const { SHEET_ID } = require('./src/config.js');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const HORIZON_END = process.env.HORIZON_END || '2026-09-30';

// IMPORTANT: this cron writes guest-facing nightly prices for the STANDALONE
// Soul website, whose Supabase is SEPARATE from BlueKeys. Use dedicated
// SOUL_SUPABASE_* creds — NOT soul-ical's shared getSupabase() (which points at
// BlueKeys for the legacy iCal wiring). Required + no fallback so this can
// never accidentally write to the BlueKeys database.
function getSoulSupabase() {
  const url = process.env.SOUL_SUPABASE_URL;
  const key = process.env.SOUL_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Set SOUL_SUPABASE_URL and SOUL_SUPABASE_SERVICE_ROLE_KEY (the standalone Soul website DB).');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── helpers ────────────────────────────────────────────────────────────────
const norm = (s) =>
  String(s || '').toUpperCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

/** "9,000" -> 9000 ; "Blocked"/"block"/""/"-" -> null (unavailable). */
function parsePrice(text) {
  const t = String(text || '').trim();
  if (!t || /^-+$/.test(t) || /block/i.test(t)) return null;
  const n = parseInt(t.replace(/[,\s]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// Map a header row -> { month(0-based getMonth) : colIndex } + flat weekend col.
// Only the FIRST pricing block is read: several tabs (e.g. Fouka) carry a second
// USD/eid block further right (JUNE/JULY/AUGUST again). The first block is the
// guest EGP one and ends at the "website link"/"ical" column — stop there, and
// take the first match per month so the USD block can never overwrite it.
function mapHeader(headerCells) {
  let stop = headerCells.findIndex((c) => /website|ical/i.test(c.text || ''));
  if (stop < 0) stop = headerCells.length;
  const map = {}; let weekendCol = null;
  for (let i = 0; i < stop; i++) {
    const t = String(headerCells[i]?.text || '').trim().toLowerCase();
    if (/^june/.test(t) && map[5] == null) map[5] = i;
    else if (/^july/.test(t) && map[6] == null) map[6] = i;
    else if (/^aug/.test(t) && map[7] == null) map[7] = i;
    else if (/^sep/.test(t) && map[8] == null) map[8] = i;
    else if (/weekend\s*season/.test(t) && weekendCol === null) weekendCol = i;
  }
  return { monthCol: map, weekendCol };
}

async function main() {
  console.log(`Soul price-sync${DRY_RUN ? ' (DRY RUN)' : ''} — sheet ${SHEET_ID}`);
  const sb = getSoulSupabase();

  // 1) DB unit index: normalised source_code -> {wp, currency, status, code}
  const { data: units, error: uErr } = await sb
    .from('units').select('wp_post_id,source_code,price_currency,status')
    .not('source_code', 'is', null);
  if (uErr) throw uErr;
  const byCode = new Map();
  for (const u of units) {
    if (!u.source_code) continue;
    byCode.set(norm(u.source_code), {
      wp: u.wp_post_id, currency: u.price_currency === 'USD' ? 'USD' : 'EGP', status: u.status, code: u.source_code,
    });
  }
  console.log(`DB units with a code: ${byCode.size}`);

  // 2) Parse price tabs -> per-unit monthly buckets
  const tabs = await fetchGrid(SHEET_ID);
  const priceTabs = tabs.filter((t) => /price/i.test(t.title) && !/broker/i.test(t.title));
  const priced = new Map(); // wp -> { currency, code, buckets:{5,6,7,8}, flat }
  const unmatched = new Set();
  let sheetRows = 0;

  for (const tab of priceTabs) {
    const hr = tab.rows.findIndex((r) => r.slice(0, 18).some((c) => /july|weekend\s*season/i.test(c.text || '')));
    if (hr < 0) { console.log(`  ! ${tab.title}: no header row, skipped`); continue; }
    const { monthCol, weekendCol } = mapHeader(tab.rows[hr]);
    for (const row of tab.rows.slice(hr + 1)) {
      const code = String(row[0]?.text || '').trim();
      if (!code || /^-+$/.test(code)) continue;
      const hit = byCode.get(norm(code));
      sheetRows++;
      if (!hit) { unmatched.add(`${tab.title}:${code}`); continue; }
      const buckets = {}; let flat = null;
      for (const m of [5, 6, 7, 8]) if (monthCol[m] != null) buckets[m] = parsePrice(row[monthCol[m]]?.text);
      if (weekendCol != null) flat = parsePrice(row[weekendCol]?.text);
      // first tab wins per wp (a unit shouldn't appear in two guest price tabs)
      if (!priced.has(hit.wp)) priced.set(hit.wp, { currency: hit.currency, code: hit.code, tab: tab.title, buckets, flat });
    }
  }

  // 3) Expand monthly buckets -> nightly rows over the horizon
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(`${HORIZON_END}T00:00:00`);
  const rowsByWp = new Map();
  let blockedMonths = 0, pricedUnits = 0;
  for (const [wp, info] of priced) {
    const rows = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const m = d.getMonth();
      const price = info.flat != null ? info.flat : (info.buckets[m] ?? null);
      if (price == null) continue;
      rows.push({ wp_post_id: wp, date: iso(d), price, currency: info.currency, source: 'soul-sheet' });
    }
    if (rows.length) { rowsByWp.set(wp, rows); pricedUnits++; }
    // count blocked months for reporting
    if (info.flat == null) for (const m of [6, 7, 8]) if (info.buckets[m] === null || info.buckets[m] == null) blockedMonths++;
  }

  const totalRows = [...rowsByWp.values()].reduce((s, r) => s + r.length, 0);
  console.log(`\nPrice tabs parsed: ${priceTabs.map((t) => t.title).join(', ')}`);
  console.log(`Sheet price rows seen: ${sheetRows} | matched units: ${priced.size} | with ≥1 priced night: ${pricedUnits}`);
  console.log(`Nightly rows to write: ${totalRows} (horizon ${iso(start)} … ${HORIZON_END})`);
  console.log(`Unmatched sheet codes (${unmatched.size}): ${[...unmatched].slice(0, 40).join(', ')}${unmatched.size > 40 ? ' …' : ''}`);

  // sample: 3 units, show a July + Aug + Sep price
  const sample = [...priced.entries()].slice(0, 4);
  console.log('\nSample (unit -> July/Aug/Sep nightly):');
  for (const [wp, info] of sample) {
    const g = (m) => info.flat != null ? `${info.flat} (flat)` : (info.buckets[m] ?? 'BLOCKED');
    console.log(`  wp ${wp} ${info.code} [${info.tab}] -> Jul ${g(6)} | Aug ${g(7)} | Sep ${g(8)} ${info.currency}`);
  }

  if (DRY_RUN) { console.log('\nDRY RUN — no DB writes.'); return; }

  // 4) Refresh: for EVERY matched unit delete its horizon rows (so a unit that
  // flipped to fully-Blocked is cleared), then insert fresh for the priced ones.
  let wrote = 0, failed = 0;
  for (const wp of priced.keys()) {
    const { error: delErr } = await sb.from('unit_daily_prices').delete().eq('wp_post_id', wp).gte('date', iso(start));
    if (delErr) { console.error(`  del wp ${wp}: ${delErr.message}`); failed++; continue; }
    const rows = rowsByWp.get(wp);
    if (!rows) continue; // fully blocked over the horizon — cleared, nothing to insert
    let ok = true;
    for (const c of chunk(rows, 500)) {
      const { error } = await sb.from('unit_daily_prices').insert(c);
      if (error) { console.error(`  ins wp ${wp}: ${error.message}`); ok = false; break; }
    }
    if (ok) wrote++; else failed++;
  }
  console.log(`\nDONE. units_written=${wrote} failed=${failed} rows=${totalRows}`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
