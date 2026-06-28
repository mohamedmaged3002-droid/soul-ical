// Decide whether to (re)write a unit's .ics this run.
//   prev:    previous docs/index.json entry for this slug, or null (first sight).
//   current: { tabOk:boolean, sig:string }  sig = signature of this run's ranges.
// A tab that failed to parse must NEVER overwrite last-good feeds. Otherwise we
// only rewrite when the range signature changed, so a 15-min cron does not churn
// 96 identical commits/day.
function shouldWriteUnit(prev, current) {
  if (!current.tabOk) return { write: false, reason: 'tab-parse-failed' };
  if (prev && prev.sig === current.sig) return { write: false, reason: 'unchanged' };
  return { write: true, reason: 'ok' };
}

module.exports = { shouldWriteUnit };
