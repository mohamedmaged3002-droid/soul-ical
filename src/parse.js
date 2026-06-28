// Pure parsing of one fetchGrid tab into per-unit blocked dates.
const pad = (n) => String(n).padStart(2, '0');

// White = no fill, or all channels near 1. Google omits a 0 channel, so default
// each MISSING channel to 0 (otherwise pure red {red:1} would look white).
function isWhite(bg) {
  if (!bg) return true;
  const r = bg.red || 0, g = bg.green || 0, b = bg.blue || 0;
  return r >= 0.95 && g >= 0.95 && b >= 0.95;
}

// Blocked = the cell has any text (guest name / "owner reservation") OR a non-white fill.
function isBlocked(cell) {
  if (!cell) return false;
  if (cell.text && cell.text.trim() !== '') return true;
  return !isWhite(cell.bg);
}

// Extract a day-first D/M/Y(YYY) date from a cell's display text -> ISO, else null.
function parseSheetDate(text) {
  const m = String(text || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let d = +m[1], mo = +m[2], y = +m[3];
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

// Returns a (r,c) -> {r,c} resolver that maps a cell inside a merged region to the
// merge's top-left (which carries the value/format), else returns (r,c) unchanged.
function mergeResolver(merges) {
  return (r, c) => {
    for (const m of merges) {
      if (r >= m.startRowIndex && r < m.endRowIndex && c >= m.startColumnIndex && c < m.endColumnIndex) {
        return { r: m.startRowIndex, c: m.startColumnIndex };
      }
    }
    return { r, c };
  };
}

function compoundFromTitle(title) {
  return String(title).replace(/availability/ig, '').trim() || String(title);
}

// tab: { title, merges, rows }. opts: { todayIso }.
// -> { ok:true, title, compound, dateRows, units:[{code,beds,compound,blockedIso[]}] }
//    or { ok:false, reason, title }.
function parseTab(tab, { todayIso }) {
  const title = tab.title;
  if (/price/i.test(title)) return { ok: false, reason: 'prices-tab', title };
  const rows = tab.rows || [];

  // Anchor: locate the cell whose text is "UNIT NUMBER".
  let unitRowIdx = -1, labelCol = -1;
  for (let r = 0; r < rows.length && unitRowIdx < 0; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if ((rows[r][c].text || '').trim().toUpperCase() === 'UNIT NUMBER') {
        unitRowIdx = r; labelCol = c; break;
      }
    }
  }
  if (unitRowIdx < 0) return { ok: false, reason: 'no-unit-row', title };

  const unitRow = rows[unitRowIdx];
  const cols = [];
  for (let c = labelCol + 1; c < unitRow.length; c++) {
    const code = (unitRow[c].text || '').trim();
    if (code) cols.push({ c, code });
  }
  if (!cols.length) return { ok: false, reason: 'no-unit-columns', title };

  const bedsRow = rows[unitRowIdx + 1] || [];
  const resolve = mergeResolver(tab.merges || []);
  const blocked = {};
  for (const u of cols) blocked[u.code] = new Set();

  let dateRows = 0;
  for (let r = unitRowIdx + 1; r < rows.length; r++) {
    const dateText = (rows[r][labelCol] && rows[r][labelCol].text) || '';
    const dateIso = parseSheetDate(dateText);
    if (!dateIso) continue;
    dateRows++;
    if (dateIso < todayIso) continue; // skip past dates
    for (const u of cols) {
      const at = resolve(r, u.c);
      const cell = rows[at.r] && rows[at.r][at.c];
      if (isBlocked(cell)) blocked[u.code].add(dateIso);
    }
  }
  if (dateRows === 0) return { ok: false, reason: 'no-date-rows', title };

  const compound = compoundFromTitle(title);
  const units = cols.map((u) => ({
    code: u.code,
    beds: ((bedsRow[u.c] && bedsRow[u.c].text) || '').trim(),
    compound,
    blockedIso: [...blocked[u.code]].sort(),
  }));
  return { ok: true, title, compound, dateRows, units };
}

module.exports = { isWhite, isBlocked, parseSheetDate, mergeResolver, compoundFromTitle, parseTab };
