require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getSupabase } = require('./src/supabase');
const { loadSoulUnits } = require('./src/units');
const { normalizeCode } = require('./src/slug');
const { wireUnits } = require('./src/wire');
const cfg = require('./src/config');

async function main() {
  const idxPath = path.join(__dirname, 'docs', 'index.json');
  if (!fs.existsSync(idxPath)) {
    console.log('No docs/index.json — run `node sync.js` first.');
    return;
  }
  const { units } = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  const sb = getSupabase();
  const dbMap = await loadSoulUnits(sb); // normalizedCode -> {wp,slug,title}

  const entries = [];
  for (const u of units) {
    const m = dbMap[normalizeCode(u.code)];
    if (m) entries.push({ wp: m.wp, slug: m.slug, ical_url: `${cfg.PAGES_BASE_URL}/${u.slug}.ics` });
  }
  const { upserted } = await wireUnits(sb, entries);
  console.log(`Wired ${upserted}/${units.length} feeds into listing_ical (${units.length - upserted} OTA-only, no DB match).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
