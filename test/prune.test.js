const { test } = require('node:test');
const assert = require('node:assert');
const { findGhosts } = require('../src/prune');

const prev = {
  'Cl11-16-03': { slug: 'Cl11-16-03', compound: 'Foukabay' },
  'Cl11-16b-03': { slug: 'Cl11-16b-03', compound: 'Foukabay' },
  'A27-6': { slug: 'A27-6', compound: 'Gaia' },
  'MAR-1': { slug: 'MAR-1', compound: 'Marassi' },
};

test('a code gone from a tab that parsed OK is a ghost', () => {
  // Fouka parsed fine and no longer mentions Cl11-16-03 -> it really is gone.
  assert.deepStrictEqual(
    findGhosts(prev, new Set(['Cl11-16b-03', 'A27-6']), new Set(['Foukabay', 'Gaia'])),
    [{ slug: 'Cl11-16-03', compound: 'Foukabay' }],
  );
});

test('a failed tab never prunes its own units', () => {
  // Fouka errored this run, so its slugs are absent for a reason that is not
  // "removed from the sheet". Carry them forward untouched.
  assert.deepStrictEqual(findGhosts(prev, new Set(['A27-6']), new Set(['Gaia'])), []);
});

test('a hidden tab (Marassi) never prunes its units', () => {
  assert.deepStrictEqual(
    findGhosts(prev, new Set(['Cl11-16-03', 'Cl11-16b-03', 'A27-6']), new Set(['Foukabay', 'Gaia'])),
    [],
  );
});

test('every tab failing prunes nothing', () => {
  assert.deepStrictEqual(findGhosts(prev, new Set(), new Set()), []);
});

test('an entry with no compound is never pruned', () => {
  const legacy = { 'OLD-1': { slug: 'OLD-1' } };
  assert.deepStrictEqual(findGhosts(legacy, new Set(), new Set(['Foukabay'])), []);
});

test('empty previous index is fine', () => {
  assert.deepStrictEqual(findGhosts({}, new Set(['A27-6']), new Set(['Gaia'])), []);
  assert.deepStrictEqual(findGhosts(null, new Set(), new Set()), []);
});
