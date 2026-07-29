// Retired feed URLs kept alive so existing OTA subscriptions keep working.
//
// When Soul re-keys a column, the old code's .ics is pruned (see prune.js) — but
// an OTA subscription is a saved URL living inside the channel account, and we
// cannot change it from here. A pruned URL 404s, so the OTA stops receiving
// availability until someone repoints it by hand. An alias republishes the OLD
// filename carrying the LIVE unit's availability, so the subscription keeps
// blocking the right dates while the repoint is pending.
//
// deadSlug -> liveSlug. Both are feed filenames (codeSlug output), not raw codes.
// REMOVE an entry once the OTA has been repointed — an alias is a bridge, not a
// permanent second identity for a unit.
const ALIASES = {
  // 2026-07-29 (L-069): Soul re-keyed this column 2026-07-13/14. The old feed had
  // been frozen EMPTY since, so OTAs read the unit as always-available and
  // double-booked it. Remove once the OTA points at Cl11-16b-03.ics.
  'Cl11-16-03': 'Cl11-16b-03',
};

// Resolve aliases against what this run actually built.
//   aliases      deadSlug -> liveSlug
//   builtBySlug  liveSlug -> { title, ranges }  (only units from tabs that parsed)
// -> [{ aliasSlug, targetSlug, title, ranges }]
//
// An alias whose target was NOT built this run is skipped, never emptied: the
// target's tab may simply have failed to parse, and writing an empty calendar
// would fail OPEN — the exact bug aliases exist to paper over.
function resolveAliases(aliases, builtBySlug) {
  const out = [];
  for (const aliasSlug of Object.keys(aliases || {})) {
    const targetSlug = aliases[aliasSlug];
    const built = (builtBySlug || {})[targetSlug];
    if (!built) continue;
    out.push({
      aliasSlug,
      targetSlug,
      // Name it after the LIVE unit so anyone opening the file in a calendar app
      // sees which unit these blocks belong to, plus the retired code it answers.
      title: `${built.title} (retired code ${aliasSlug})`,
      ranges: built.ranges,
    });
  }
  return out;
}

module.exports = { ALIASES, resolveAliases };
