const { test } = require('node:test');
const assert = require('node:assert');
const { ymd, iso, addDays, collapseBlocked, dropPastRanges } = require('../src/dates');

test('ymd formats a Date as YYYYMMDD', () => {
  assert.strictEqual(ymd(new Date(2026, 5, 2)), '20260602');
});

test('iso formats a Date as YYYY-MM-DD', () => {
  assert.strictEqual(iso(new Date(2026, 5, 2)), '2026-06-02');
});

test('addDays moves across month boundary', () => {
  assert.strictEqual(iso(addDays(new Date(2026, 5, 30), 2)), '2026-07-02');
});

test('collapseBlocked merges consecutive ISO dates into [start, endExclusive)', () => {
  assert.deepStrictEqual(collapseBlocked(['2026-06-02', '2026-06-03', '2026-06-04', '2026-06-10']), [
    { start: '2026-06-02', endExclusive: '2026-06-05' },
    { start: '2026-06-10', endExclusive: '2026-06-11' },
  ]);
});

test('collapseBlocked sorts/de-dupes and handles empty', () => {
  assert.deepStrictEqual(collapseBlocked(['2026-06-04', '2026-06-02', '2026-06-03', '2026-06-03']), [
    { start: '2026-06-02', endExclusive: '2026-06-05' },
  ]);
  assert.deepStrictEqual(collapseBlocked([]), []);
});

test('dropPastRanges keeps a live range at its TRUE start (no clipping to today)', () => {
  // The whole point of L-076: an in-progress booking must not have its start
  // rewritten each day, because the UID is built from it.
  const ranges = [{ start: '2026-07-25', endExclusive: '2026-08-10' }];
  assert.deepStrictEqual(dropPastRanges(ranges, '2026-07-31'), ranges);
  assert.deepStrictEqual(dropPastRanges(ranges, '2026-08-01'), ranges); // still unchanged a day later
});

test('dropPastRanges removes a range only once it has fully elapsed', () => {
  const r = { start: '2026-07-01', endExclusive: '2026-07-05' };
  assert.deepStrictEqual(dropPastRanges([r], '2026-07-04'), [r]); // last night still ahead
  assert.deepStrictEqual(dropPastRanges([r], '2026-07-05'), []);  // DTEND exclusive -> elapsed
});

test('dropPastRanges tolerates empty/missing input', () => {
  assert.deepStrictEqual(dropPastRanges([], '2026-07-31'), []);
  assert.deepStrictEqual(dropPastRanges(null, '2026-07-31'), []);
});
