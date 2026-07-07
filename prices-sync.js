/**
 * prices-sync.js — Soul nightly price sync (DUAL-WRITE).
 *
 * Reads the Soul "Soul Availability" Google Sheet's PRICE tabs (the single
 * source of truth for pricing) and writes per-night rates into `unit_daily_prices`
 * on EVERY database where Soul inventory is listed:
 *
 *   • Soul website DB  (soulhospitality.co)  — via SOUL_SUPABASE_URL / _KEY
 *   • BlueKeys DB       (bluekeys.co)          — via SUPABASE_URL / _KEY, and
 *                                                ONLY units where source='soul'
 *
 * Both are optional: the script syncs whichever creds are present (≥1 required),
 * so a local run with only the BlueKeys creds re-syncs BlueKeys, and CI with both
 * keeps the two in lockstep. Soul units are dual-listed on both sites — if only
 * one DB is written the other silently goes stale (see Brain L-041).
 *
 * The sheet stores MONTHLY rates (JUNE/JULY/AUGUST/September columns) per unit,
 * plus a single flat "weekend season" rate for Sokhna. "Blocked"/"block"/blank
 * for a month => that month is unavailable (no rows => the site renders those
 * nights blocked, per the per-night-truth pricing model).
 *
 * Matching: sheet unit code (column A) -> units.source_code (normalised), PER DB
 * (a unit's wp_post_id can differ between the two DBs, so we re-resolve the code
 * against each target's own units table). PK is (wp_post_id, date).
 * Refresh: for every matched unit, delete its horizon rows (date >= today) then
 * insert fresh, so a month that flips to Blocked correctly disappears.
 *
 *   node prices-sync.js            # writes every available target
 *   DRY_RUN=1 node prices-sync.js  # parse + report only, no DB writes
 *
 * Env: SOUL_SHEET_ID (+ Google auth per src/sheets.js). HORIZON_END optional
 * (default 2026-09-30). Targets: SOUL_SUPABASE_URL/_KEY and/or
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (BlueKeys, filtered to source='soul').
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { fetchGrid } = require('./src/sheets.js');
const { SHEET_ID } = require('./src/config.js');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const HORIZON_END = process.env.HORIZON_END || '2026-09-30';

const mkClient = (url, key) => createClient(url, key, { auth: { persistSession: false } });

// Build the list of DB write-targets from whatever creds are present.
//   • Soul     — dedicated SOUL_SUPABASE_* (standalone Soul website). No source
//                filter (that DB is single-operator).
//   • BlueKeys — the repo's shared SUPABASE_* (also used by the iCal wiring in
//                wire.js). ALWAYS filtered to source='soul' so a Soul sheet code
//                that happens to collide with a birdnest/mynt/ali source_code can
//                NEVER overwrite a non-Soul unit's prices.
function getTargets() {
  const targets = [];
  if (process.env.SOUL_SUPABASE_URL && process.env.SOUL_SUPABASE_SERVICE_ROLE_KEY) {
    targets.push({
      label: 'Soul',
      sb: mkClient(process.env.SOUL_SUPABASE_URL, process.env.SOUL_SUPABASE_SERVICE_ROLE_KEY),
      sourceFilter: null,
    });
  }
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    targets.push({
      label: 'BlueKeys',
      sb: mkClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY),
      sourceFilter: 'soul',
    });
  }
  if (!targets.length) {
    throw new Error('No DB creds. Set SOUL_SUPABASE_URL/_KEY and/or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
  }
  return targets;
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

// Parse the sheet's guest price tabs -> Map(normCode -> {code,tab,buckets,flat}).
// DB-agnostic: every price row is kept; each target matches its own units later.
function parseSheet(tabs) {
  const priceTabs = tabs.filter((t) => /price/i.test(t.title) && !/broker/i.test(t.title));
  const pricedByCode = new Map();
  let sheetRows = 0;
  for (const tab of priceTabs) {
    const hr = tab.rows.findIndex((r) => r.slice(0, 18).some((c) => /july|weekend\s*season/i.test(c.text || '')));
    if (hr < 0) { console.log(`  ! ${tab.title}: no header row, skipped`); continue; }
    const { monthCol, weekendCol } = mapHeader(tab.rows[hr]);
    for (const row of tab.rows.slice(hr + 1)) {
      const code = String(row[0]?.text || '').trim();
      if (!code || /^-+$/.test(code)) continue;
      sheetRows++;
      const nc = norm(code);
      if (pricedByCode.has(nc)) continue; // first tab wins per code
      const buckets = {}; let flat = null;
      for (const m of [5, 6, 7, 8]) if (monthCol[m] != null) buckets[m] = parsePrice(row[monthCol[m]]?.text);
      if (weekendCol != null) flat = parsePrice(row[weekendCol]?.text);
      pricedByCode.set(nc, { code, tab: tab.title, buckets, flat });
    }
  }
  return { pricedByCode, sheetRows, priceTabs };
}

// Expand the parsed buckets into nightly rows and refresh one target DB.
async function syncToDb(target, pricedByCode, start, end) {
  const { sb, label, sourceFilter } = target;

  // 1) This DB's code -> {wp,currency} index (optionally scoped to one source).
  let q = sb.from('units').select('wp_post_id,source_code,price_currency,status,source').not('source_code', 'is', null);
  if (sourceFilter) q = q.eq('source', sourceFilter);
  const { data: units, error: uErr } = await q;
  if (uErr) throw new Error(`[${label}] units query: ${uErr.message}`);
  const byCode = new Map();
  for (const u of units) {
    byCode.set(norm(u.source_code), { wp: u.wp_post_id, currency: u.price_currency === 'USD' ? 'USD' : 'EGP' });
  }

  // 2) For every sheet code this DB has a unit for, expand nightly rows.
  const matched = []; // { wp, code, rows }
  for (const [nc, info] of pricedByCode) {
    const hit = byCode.get(nc);
    if (!hit) continue;
    const rows = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const m = d.getMonth();
      const price = info.flat != null ? info.flat : (info.buckets[m] ?? null);
      if (price == null) continue;
      rows.push({ wp_post_id: hit.wp, date: iso(d), price, currency: hit.currency, source: 'soul-sheet' });
    }
    matched.push({ wp: hit.wp, code: info.code, rows });
  }
  const totalRows = matched.reduce((s, m) => s + m.rows.length, 0);
  console.log(`[${label}] units_in_db=${byCode.size} matched_to_sheet=${matched.length} nightly_rows=${totalRows}`);
  const sample = matched.slice(0, 3).map((m) => `${m.code}(wp ${m.wp}, ${m.rows.length}d)`).join(', ');
  if (sample) console.log(`[${label}] sample: ${sample}`);

  if (DRY_RUN) return { label, matched: matched.length, rows: totalRows, wrote: 0, failed: 0 };

  // 3) Refresh: delete future rows for every matched unit (so a now-blocked
  //    month clears), then insert fresh for the priced ones.
  let wrote = 0, failed = 0;
  for (const m of matched) {
    const { error: delErr } = await sb.from('unit_daily_prices').delete().eq('wp_post_id', m.wp).gte('date', iso(start));
    if (delErr) { console.error(`  [${label}] del wp ${m.wp}: ${delErr.message}`); failed++; continue; }
    if (!m.rows.length) continue; // matched but fully blocked over the horizon — cleared
    let ok = true;
    for (const c of chunk(m.rows, 500)) {
      const { error } = await sb.from('unit_daily_prices').insert(c);
      if (error) { console.error(`  [${label}] ins wp ${m.wp}: ${error.message}`); ok = false; break; }
    }
    ok ? wrote++ : failed++;
  }
  console.log(`[${label}] DONE units_written=${wrote} failed=${failed}`);
  return { label, matched: matched.length, rows: totalRows, wrote, failed };
}

async function main() {
  const targets = getTargets();
  console.log(`Soul price-sync${DRY_RUN ? ' (DRY RUN)' : ''} — sheet ${SHEET_ID} — targets: ${targets.map((t) => t.label).join(', ')}`);

  const tabs = await fetchGrid(SHEET_ID);
  const { pricedByCode, sheetRows, priceTabs } = parseSheet(tabs);
  console.log(`Price tabs: ${priceTabs.map((t) => t.title).join(', ')}`);
  console.log(`Sheet price rows: ${sheetRows} | unique codes: ${pricedByCode.size} | horizon ${HORIZON_END}`);

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(`${HORIZON_END}T00:00:00`);

  let anyFailed = 0;
  for (const t of targets) {
    const r = await syncToDb(t, pricedByCode, start, end);
    anyFailed += r.failed;
  }
  if (anyFailed) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
