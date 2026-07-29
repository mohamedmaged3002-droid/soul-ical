// Decide which carried-forward index entries are ghosts.
//
// loadPrevIndex() carries every previous entry forward so that a tab which
// fails to parse can never wipe real feeds. The cost is that a code Soul
// REMOVES from the sheet is never retired: its index entry, its links.csv row
// and its last-written .ics live on. A ghost frozen at zero VEVENTs is the
// dangerous case — it fails OPEN, reading as "available forever" while passing
// every reachability and parseability check (L-069).
//
// So: prune, but only where absence is *evidence*. A slug missing from a run
// whose compound tab parsed fine really is gone from the sheet. A slug missing
// because its tab errored (or is hidden, like Marassi) tells us nothing and
// must be carried forward untouched.
//
//   prevIndex   slug -> entry (previous docs/index.json)
//   seenSlugs   Set of slugs indexed from this run's parsed tabs
//   okCompounds Set of compounds whose tab returned ok:true this run
// -> [{ slug, compound }] safe to delete
function findGhosts(prevIndex, seenSlugs, okCompounds) {
  const ghosts = [];
  for (const slug of Object.keys(prevIndex || {})) {
    if (seenSlugs.has(slug)) continue;
    const compound = (prevIndex[slug] || {}).compound;
    if (!okCompounds.has(compound)) continue; // no evidence — keep carrying it
    ghosts.push({ slug, compound });
  }
  return ghosts;
}

module.exports = { findGhosts };
