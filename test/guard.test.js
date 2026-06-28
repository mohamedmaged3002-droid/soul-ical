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
