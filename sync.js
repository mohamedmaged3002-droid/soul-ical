require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { fetchGrid } = require('./src/sheets');
const { parseTab } = require('./src/parse');
const { collapseBlocked, iso } = require('./src/dates');
const { buildIcal } = require('./src/ical');
const { shouldWriteUnit } = require('./src/guard');
const { codeSlug } = require('./src/slug');
const cfg = require('./src/config');

const OUT = path.join(__dirname, 'docs');

function todayIso() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return iso(d);
}

function loadPrevIndex() {
  const p = path.join(OUT, 'index.json');
  if (!fs.existsSync(p)) return {}; // legit first run
  let j;
  try {
    j = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    // Fail CLOSED: a corrupt index would disable change-detection and lose
    // carry-forward. Abort so the last-good docs/ tree stays untouched.
    throw new Error(
      `docs/index.json exists but could not be parsed (${e.message}). ` +
      `Fix or delete docs/index.json before re-running.`,
    );
  }
  const map = {};
  for (const e of j.units || []) map[e.slug] = e;
  return map;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const tIso = todayIso();
  const tabs = await fetchGrid(cfg.SHEET_ID);
  console.log(`Fetched ${tabs.length} tabs from sheet ${cfg.SHEET_ID}`);

  const prev = loadPrevIndex();
  const indexMap = {};
  for (const k of Object.keys(prev)) indexMap[k] = prev[k]; // carry forward untouched units

  const report = { startedAt: new Date().toISOString(), written: 0, skipped: [], tabs: [], units: [], collisions: [] };
  const usedSlug = new Map(); // slug -> code, to detect cross-unit filename collisions

  for (const tab of tabs) {
    if (tab.hidden) {
      // A hidden tab means "not active" — exclude it (e.g. Marassi).
      report.tabs.push({ title: tab.title, ok: false, reason: 'hidden-tab', dateRows: 0, units: 0 });
      console.log(`  tab "${tab.title}" SKIPPED (hidden)`);
      continue;
    }
    const res = parseTab(tab, { todayIso: tIso });
    report.tabs.push({ title: tab.title, ok: res.ok, reason: res.reason || null, dateRows: res.dateRows || 0, units: res.units ? res.units.length : 0 });
    if (!res.ok) {
      console.log(`  tab "${tab.title}" SKIPPED (${res.reason})`);
      continue;
    }
    for (const u of res.units) {
      // Filename = code slug; disambiguate genuine collisions by compound, then counter.
      let slug = codeSlug(u.code);
      if (usedSlug.has(slug) && usedSlug.get(slug) !== u.code) {
        let alt = `${slug}-${codeSlug(u.compound)}`;
        let n = 2;
        while (usedSlug.has(alt) && usedSlug.get(alt) !== u.code) alt = `${slug}-${codeSlug(u.compound)}-${n++}`;
        report.collisions.push({ code: u.code, wanted: slug, resolved: alt, compound: u.compound });
        slug = alt;
      }
      usedSlug.set(slug, u.code);

      const ranges = collapseBlocked(u.blockedIso);
      const sig = ranges.map((r) => `${r.start}/${r.endExclusive}`).join(',');
      const title = [u.code, u.beds, u.compound].filter(Boolean).join(' — ');
      const decision = shouldWriteUnit(prev[slug] || null, { tabOk: true, sig });
      report.units.push({ slug, code: u.code, compound: u.compound, ranges: ranges.length, decision: decision.reason });

      if (decision.write) {
        fs.writeFileSync(path.join(OUT, `${slug}.ics`), buildIcal({ slug, title, ranges }), 'utf8');
        report.written++;
      } else if (decision.reason !== 'unchanged') {
        report.skipped.push({ slug, reason: decision.reason });
      }
      // Always refresh the index entry (carry-forward + change-detection signature).
      indexMap[slug] = { slug, code: u.code, compound: u.compound, beds: u.beds, title, sig, blockedRanges: ranges.length };
    }
  }

  const index = Object.values(indexMap).sort((a, b) => a.slug.localeCompare(b.slug));
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ updatedAt: report.finishedAt, units: index }, null, 2));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  const csvEsc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [['code', 'slug', 'compound', 'beds', 'ical_url', 'blocked_ranges'].join(',')];
  for (const e of index) {
    csv.push([csvEsc(e.code), e.slug, csvEsc(e.compound), csvEsc(e.beds), `${cfg.PAGES_BASE_URL}/${e.slug}.ics`, e.blockedRanges ?? ''].join(','));
  }
  fs.writeFileSync(path.join(OUT, 'links.csv'), csv.join('\n') + '\n');

  console.log(`Done: wrote ${report.written}, skipped ${report.skipped.length}, indexed ${index.length}, collisions ${report.collisions.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
