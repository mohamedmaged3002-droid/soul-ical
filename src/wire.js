// entries: [{ wp, slug, ical_url }]. Upserts one listing_ical row per entry.
async function wireUnits(sb, entries) {
  if (!entries.length) return { upserted: 0 };
  const rows = entries.map((e) => ({
    wordpress_post_id: e.wp,
    listing_slug: e.slug,
    ical_url: e.ical_url,
    notes: '[soul-ical auto]',
    updated_at: new Date().toISOString(),
  }));
  const { error } = await sb.from('listing_ical').upsert(rows, { onConflict: 'wordpress_post_id' });
  if (error) throw new Error(`wireUnits: ${error.message}`);
  return { upserted: rows.length };
}

module.exports = { wireUnits };
