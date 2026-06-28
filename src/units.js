const { normalizeCode } = require('./slug');

// rows: [{ wp_post_id, slug, title, source_code }] -> { normalizedCode: {wp,slug,title} }
function buildCodeMap(rows) {
  const map = {};
  for (const u of rows || []) {
    const k = normalizeCode(u.source_code);
    if (k) map[k] = { wp: u.wp_post_id, slug: u.slug, title: u.title };
  }
  return map;
}

async function loadSoulUnits(sb) {
  const { data, error } = await sb
    .from('units')
    .select('wp_post_id, slug, title, source_code')
    .eq('source', 'soul');
  if (error) throw new Error(`loadSoulUnits: ${error.message}`);
  return buildCodeMap(data);
}

module.exports = { buildCodeMap, loadSoulUnits };
