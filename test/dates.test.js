const { test } = require('node:test');
const assert = require('node:assert');
const { ymd, iso, addDays, collapseBlocked } = require('../src/dates');

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
