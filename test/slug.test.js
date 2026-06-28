const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeCode, codeSlug } = require('../src/slug');

test('normalizeCode lowercases, trims, collapses internal whitespace', () => {
  assert.strictEqual(normalizeCode('SA-2B-01'), 'sa-2b-01');
  assert.strictEqual(normalizeCode('  Blanca Villa  90 '), 'blanca villa 90');
  assert.strictEqual(normalizeCode('c2-ch29- g02'), 'c2-ch29- g02');
});

test('normalizeCode of null/undefined is empty string', () => {
  assert.strictEqual(normalizeCode(null), '');
  assert.strictEqual(normalizeCode(undefined), '');
});

test('codeSlug preserves case, turns spaces into hyphens, drops unsafe chars', () => {
  assert.strictEqual(codeSlug('ST3-V20'), 'ST3-V20');
  assert.strictEqual(codeSlug('Blanca Villa  90'), 'Blanca-Villa-90');
  assert.strictEqual(codeSlug('Lea 1A 304'), 'Lea-1A-304');
  assert.strictEqual(codeSlug('c2-ch29- g02'), 'c2-ch29--g02');
});
