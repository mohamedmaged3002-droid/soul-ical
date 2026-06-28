const { test } = require('node:test');
const assert = require('node:assert');
const { isWhite, isBlocked, parseSheetDate, parseTab } = require('../src/parse');

const WHITE = { red: 1, green: 1, blue: 1 };
const GREEN = { red: 0, green: 1, blue: 0 };
const RED = { red: 1 }; // green/blue omitted by Google == 0
const cell = (text, bg = null) => ({ text, bg });

test('isWhite treats null/absent and ~1,1,1 as white; colours as non-white', () => {
  assert.strictEqual(isWhite(null), true);
  assert.strictEqual(isWhite(WHITE), true);
  assert.strictEqual(isWhite(GREEN), false);
  assert.strictEqual(isWhite(RED), false); // red:1, green/blue default 0
});

test('isBlocked: any text OR any non-white fill', () => {
  assert.strictEqual(isBlocked(cell('')), false);
  assert.strictEqual(isBlocked(cell('', WHITE)), false);
  assert.strictEqual(isBlocked(cell('hana', WHITE)), true);   // guest name on white-ish
  assert.strictEqual(isBlocked(cell('', GREEN)), true);        // empty but coloured
  assert.strictEqual(isBlocked(undefined), false);
});

test('parseSheetDate reads day-first D/M/YYYY out of a labelled cell', () => {
  assert.strictEqual(parseSheetDate('Wednesday    20/5/2026'), '2026-05-20');
  assert.strictEqual(parseSheetDate('1/6/2026'), '2026-06-01');
  assert.strictEqual(parseSheetDate('not a date'), null);
});

test('parseTab skips a prices tab', () => {
  assert.strictEqual(parseTab({ title: 'Gaia prices', merges: [], rows: [] }, { todayIso: '2026-01-01' }).ok, false);
});

test('parseTab extracts blocked dates per unit, honours merges, skips past dates', () => {
  // Layout: row0 UNIT NUMBER | ST3-V20 | F1-V20
  //         row1 NUMBER OF BEDROOMS | 5 bed | 4 bed
  //         row2 DATE
  //         row3 20/5/2026 | green (blocked) | white
  //         row4 21/5/2026 | (merged from row3, blocked) | "hana"
  //         row5 22/5/2026 | white | white
  const rows = [
    [cell('UNIT NUMBER'), cell('ST3-V20'), cell('F1-V20')],
    [cell('NUMBER OF BEDROOMS'), cell('5 bed'), cell('4 bed')],
    [cell('DATE')],
    [cell('Wednesday 20/5/2026'), cell('', GREEN), cell('', WHITE)],
    [cell('Thursday 21/5/2026'), cell('', null), cell('hana', WHITE)],
    [cell('Friday 22/5/2026'), cell('', WHITE), cell('', WHITE)],
  ];
  // ST3-V20 col=1 merged across the two date rows (row3..row4 inclusive -> end exclusive 5)
  const merges = [{ startRowIndex: 3, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 2 }];
  const res = parseTab({ title: 'Foukabay availability', merges, rows }, { todayIso: '2026-05-01' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.compound, 'Foukabay');
  const st3 = res.units.find((u) => u.code === 'ST3-V20');
  const f1 = res.units.find((u) => u.code === 'F1-V20');
  assert.strictEqual(st3.beds, '5 bed');
  assert.deepStrictEqual(st3.blockedIso, ['2026-05-20', '2026-05-21']); // merge propagated
  assert.deepStrictEqual(f1.blockedIso, ['2026-05-21']);                // only the "hana" cell
});

test('parseTab skips dates before today', () => {
  const rows = [
    [cell('UNIT NUMBER'), cell('A1')],
    [cell('NUMBER OF BEDROOMS'), cell('2 bed')],
    [cell('1/5/2026'), cell('', { red: 0, green: 0, blue: 1 })],
    [cell('1/7/2026'), cell('', { red: 0, green: 0, blue: 1 })],
  ];
  const res = parseTab({ title: 'Gaia availability', merges: [], rows }, { todayIso: '2026-06-01' });
  assert.deepStrictEqual(res.units[0].blockedIso, ['2026-07-01']); // 1 May dropped as past
});

test('parseTab returns ok:false when there is no UNIT NUMBER anchor', () => {
  assert.strictEqual(parseTab({ title: 'X availability', merges: [], rows: [[cell('whoops')]] }, { todayIso: '2026-01-01' }).ok, false);
});
