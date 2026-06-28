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

  // Prune our own orphan rows: listing_ical entries we previously wrote whose unit
  // is no longer in the feed set (e.g. a unit whose tab got hidden). Scoped to
  // notes='[soul-ical auto]' so we never touch other sources' rows.
  let pruned = 0;
  const keep = entries.map((e) => e.wp);
  if (keep.length) {
    const { data, error } = await sb
      .from('listing_ical')
      .delete()
      .eq('notes', '[soul-ical auto]')
      .not('wordpress_post_id', 'in', `(${keep.join(',')})`)
      .select('wordpress_post_id');
    if (error) throw new Error(`prune: ${error.message}`);
    pruned = (data || []).length;
  }
  console.log(`Wired ${upserted}/${units.length} feeds (${units.length - upserted} OTA-only); pruned ${pruned} orphan listing_ical rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
