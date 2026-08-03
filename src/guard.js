// Decide whether to (re)write a unit's .ics this run.
//   prev:    previous docs/index.json entry for this slug, or null (first sight).
//   current: { tabOk:boolean, sig:string }  sig = signature of this run's ranges.
// A tab that failed to parse must NEVER overwrite last-good feeds. Otherwise we
// only rewrite when the range signature changed, so a 15-min cron does not churn
// 96 identical commits/day.
// opts.force (FORCE_REWRITE=1) re-renders every feed even when availability is
// unchanged. The sig describes AVAILABILITY only, so a change to the feed FORMAT
// is invisible to it — without this, a format change lands only on units that
// happen to get booked, and stable blocks keep the old shape indefinitely.
// Safety is preserved: a failed tab parse still never overwrites a good feed.
function shouldWriteUnit(prev, current, opts = {}) {
  if (!current.tabOk) return { write: false, reason: 'tab-parse-failed' };
  if (opts.force) return { write: true, reason: 'forced' };
  if (prev && prev.sig === current.sig) return { write: false, reason: 'unchanged' };
  return { write: true, reason: 'ok' };
}

module.exports = { shouldWriteUnit };
