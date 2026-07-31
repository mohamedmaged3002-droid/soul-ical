const pad = (n) => String(n).padStart(2, '0');

function ymd(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function iso(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseIso(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0); // local noon avoids DST edge cases
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ['2026-06-02','2026-06-03','2026-06-10'] -> merged [start, endExclusive) ranges.
function collapseBlocked(isoDates) {
  const uniq = [...new Set(isoDates)].sort();
  const ranges = [];
  let runStart = null;
  let prev = null;
  for (const cur of uniq) {
    if (runStart === null) {
      runStart = cur;
    } else if (iso(addDays(parseIso(prev), 1)) !== cur) {
      ranges.push({ start: runStart, endExclusive: iso(addDays(parseIso(prev), 1)) });
      runStart = cur;
    }
    prev = cur;
  }
  if (runStart !== null) {
    ranges.push({ start: runStart, endExclusive: iso(addDays(parseIso(prev), 1)) });
  }
  return ranges;
}

// Drop ranges that are entirely in the past; keep every surviving range's TRUE
// start. Trimming a live range's start to today would move it every day, and
// the UID is built from that start (L-076) — so an unchanged booking must keep
// an unchanged start. A range only disappears the day after it ends, which is a
// real change, not a daily one.
function dropPastRanges(ranges, todayIso) {
  return (ranges || []).filter((r) => r.endExclusive > todayIso);
}

module.exports = { ymd, iso, parseIso, addDays, collapseBlocked, dropPastRanges };
