const { test } = require('node:test');
const assert = require('node:assert');
const { shouldWriteUnit } = require('../src/guard');

test('a failed tab parse never overwrites last-good feed', () => {
  assert.deepStrictEqual(shouldWriteUnit({ sig: 'x' }, { tabOk: false, sig: 'y' }),
    { write: false, reason: 'tab-parse-failed' });
});

test('first time a unit is seen (no prev) writes', () => {
  assert.deepStrictEqual(shouldWriteUnit(null, { tabOk: true, sig: 'a' }),
    { write: true, reason: 'ok' });
});

test('unchanged signature is skipped (no churn at 15-min cron)', () => {
  assert.deepStrictEqual(shouldWriteUnit({ sig: 'a' }, { tabOk: true, sig: 'a' }),
    { write: false, reason: 'unchanged' });
});

test('changed signature writes', () => {
  assert.deepStrictEqual(shouldWriteUnit({ sig: 'a' }, { tabOk: true, sig: 'b' }),
    { write: true, reason: 'ok' });
});

// The sig only describes AVAILABILITY, so a change to the feed FORMAT is invisible
// to it and would roll out only as each unit happens to get booked. Stable blocks
// would keep the old boundary-encoded UIDs indefinitely — and those are precisely
// the ones a future merge can revoke. FORCE_REWRITE=1 re-renders every feed once.
test('force re-renders a unit whose availability has not changed', () => {
  assert.deepStrictEqual(shouldWriteUnit({ sig: 'a' }, { tabOk: true, sig: 'a' }, { force: true }),
    { write: true, reason: 'forced' });
});

test('force NEVER overrides a failed tab parse', () => {
  assert.deepStrictEqual(shouldWriteUnit({ sig: 'x' }, { tabOk: false, sig: 'y' }, { force: true }),
    { write: false, reason: 'tab-parse-failed' });
});
