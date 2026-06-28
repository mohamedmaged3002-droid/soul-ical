const { test } = require('node:test');
const assert = require('node:assert');
const { buildCodeMap } = require('../src/units');

test('buildCodeMap keys Soul units by normalized source_code', () => {
  const rows = [
    { wp_post_id: 80071, slug: 'fouka-bay-st3-v20', title: 'Fouka Bay — ST3-V20', source_code: 'ST3-V20' },
    { wp_post_id: 80061, slug: 'fouka-bay-sa-2b-01', title: 'Fouka Bay — sa-2b-01', source_code: 'sa-2b-01' },
    { wp_post_id: 80010, slug: 'marassi-blanca', title: 'Marassi — Blanca', source_code: 'Blanca Villa  90' },
  ];
  const map = buildCodeMap(rows);
  assert.strictEqual(map['st3-v20'].wp, 80071);
  assert.strictEqual(map['sa-2b-01'].wp, 80061);          // sheet "SA-2B-01" normalizes to this
  assert.strictEqual(map['blanca villa 90'].wp, 80010);   // double space collapsed
});

test('buildCodeMap ignores rows with empty source_code', () => {
  assert.deepStrictEqual(buildCodeMap([{ wp_post_id: 1, slug: 's', title: 't', source_code: null }]), {});
});
