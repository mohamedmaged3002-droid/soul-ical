const { test } = require('node:test');
const assert = require('node:assert');
const { resolveAliases, ALIASES } = require('../src/aliases');

const built = {
  'Cl11-16b-03': {
    title: 'Cl11-16b-03 — 3 bed — Foukabay',
    ranges: [{ start: '2026-07-29', endExclusive: '2026-08-12' }],
  },
};

test('an alias republishes its target ranges under the retired filename', () => {
  assert.deepStrictEqual(resolveAliases({ 'Cl11-16-03': 'Cl11-16b-03' }, built), [{
    aliasSlug: 'Cl11-16-03',
    targetSlug: 'Cl11-16b-03',
    title: 'Cl11-16b-03 — 3 bed — Foukabay (retired code Cl11-16-03)',
    ranges: [{ start: '2026-07-29', endExclusive: '2026-08-12' }],
  }]);
});

test('an alias whose target was not built is SKIPPED, never emptied', () => {
  // Target tab failed to parse this run. Writing an empty calendar here would
  // fail open and re-create the double-booking bug aliases exist to prevent.
  assert.deepStrictEqual(resolveAliases({ 'Cl11-16-03': 'Cl11-16b-03' }, {}), []);
});

test('a target with zero blocked ranges still publishes (genuinely wide open)', () => {
  const free = { 'X-1': { title: 'X-1', ranges: [] } };
  assert.deepStrictEqual(resolveAliases({ 'X-0': 'X-1' }, free),
    [{ aliasSlug: 'X-0', targetSlug: 'X-1', title: 'X-1 (retired code X-0)', ranges: [] }]);
});

test('no aliases configured is a no-op', () => {
  assert.deepStrictEqual(resolveAliases({}, built), []);
  assert.deepStrictEqual(resolveAliases(null, built), []);
});

test('every shipped alias points at a different slug than itself', () => {
  for (const [dead, live] of Object.entries(ALIASES)) {
    assert.notStrictEqual(dead, live, `alias ${dead} points at itself`);
  }
});
