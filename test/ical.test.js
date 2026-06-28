const { test } = require('node:test');
const assert = require('node:assert');
const { buildIcal } = require('../src/ical');

test('buildIcal emits a VCALENDAR with one VEVENT per range', () => {
  const ics = buildIcal({
    slug: 'ST3-V20',
    title: 'ST3-V20 — 5 bed — Fouka Bay',
    ranges: [
      { start: '2026-06-02', endExclusive: '2026-06-05' },
      { start: '2026-06-10', endExclusive: '2026-06-11' },
    ],
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /PRODID:-\/\/BlueKeys Soul iCal\/\/EN\r\n/);
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /DTSTART;VALUE=DATE:20260602\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20260605\r\n/);
  assert.match(ics, /SUMMARY:Unavailable\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test('buildIcal embeds slug + range start/end in the UID', () => {
  const ics = buildIcal({ slug: 'ST3-V20', title: 'X', ranges: [{ start: '2026-06-02', endExclusive: '2026-06-05' }] });
  assert.match(ics, /UID:soul-ST3-V20-20260602-20260605@bluekeys\.co\r\n/);
});

test('buildIcal uses CRLF throughout and escapes the title', () => {
  const ics = buildIcal({ slug: 'X', title: 'A, B; C', ranges: [] });
  assert.ok(!/[^\r]\n/.test(ics), 'every \\n must be preceded by \\r');
  assert.match(ics, /X-WR-CALNAME:A\\, B\\; C\r\n/);
});

test('buildIcal with no ranges is a valid empty calendar', () => {
  const ics = buildIcal({ slug: 'X', title: 'Empty', ranges: [] });
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 0);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});
