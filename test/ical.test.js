const { test } = require('node:test');
const assert = require('node:assert');
const { buildIcal, stripStamps } = require('../src/ical');

test('buildIcal emits a VCALENDAR with one VEVENT per blocked NIGHT', () => {
  const ics = buildIcal({
    slug: 'ST3-V20',
    title: 'ST3-V20 — 5 bed — Fouka Bay',
    ranges: [
      { start: '2026-06-02', endExclusive: '2026-06-05' }, // nights 02, 03, 04
      { start: '2026-06-10', endExclusive: '2026-06-11' }, // night 10
    ],
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /PRODID:-\/\/BlueKeys Soul iCal\/\/EN\r\n/);
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.match(ics, /DTSTART;VALUE=DATE:20260602\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20260605\r\n/); // the 4th night closes the run
  assert.match(ics, /SUMMARY:Unavailable\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test('buildIcal names each UID after the NIGHT, never the range boundaries', () => {
  const ics = buildIcal({ slug: 'ST3-V20', title: 'X', ranges: [{ start: '2026-06-02', endExclusive: '2026-06-05' }] });
  assert.match(ics, /UID:soul-ST3-V20-20260602@bluekeys\.co\r\n/);
  assert.match(ics, /UID:soul-ST3-V20-20260603@bluekeys\.co\r\n/);
  assert.match(ics, /UID:soul-ST3-V20-20260604@bluekeys\.co\r\n/);
  // a boundary-encoded UID is the bug this replaced
  assert.doesNotMatch(ics, /UID:soul-ST3-V20-\d{8}-\d{8}@/);
});

test('each night is exactly one night long, and nights are never duplicated', () => {
  const ics = buildIcal({ slug: 'X', title: 'X', ranges: [{ start: '2026-08-30', endExclusive: '2026-09-02' }] });
  const uids = [...ics.matchAll(/UID:(\S+)@bluekeys\.co/g)].map((m) => m[1]);
  assert.strictEqual(uids.length, new Set(uids).size, 'duplicate UIDs are invalid iCal');
  assert.deepStrictEqual(uids, ['soul-X-20260830', 'soul-X-20260831', 'soul-X-20260901']);
  const pairs = [...ics.matchAll(/DTSTART;VALUE=DATE:(\d{8})\r\nDTEND;VALUE=DATE:(\d{8})/g)];
  assert.strictEqual(pairs.length, 3);
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

const uidsOf = (ics) => new Set([...ics.matchAll(/UID:(\S+)@bluekeys\.co/g)].map((m) => m[1]));

// The SA-3A-B02 double-booking (2026-08-03). On 2026-07-23 16:14 the free gap of
// Aug 3–6 filled in, merging two blocks into one. Every UID changed, so the OTA
// was told to DELETE blocks it should have kept — it dropped Aug 6–17 and sold it.
test('merging two adjacent blocks keeps every still-blocked night on its original UID', () => {
  const before = buildIcal({
    slug: 'SA-3A-B02',
    title: 'X',
    ranges: [
      { start: '2026-07-30', endExclusive: '2026-08-03' },
      { start: '2026-08-07', endExclusive: '2026-08-18' },
    ],
  });
  const after = buildIcal({
    slug: 'SA-3A-B02',
    title: 'X',
    ranges: [{ start: '2026-07-30', endExclusive: '2026-08-18' }],
  });

  const lost = [...uidsOf(before)].filter((u) => !uidsOf(after).has(u));
  assert.deepStrictEqual(lost, [], `merge revoked ${lost.length} UID(s) whose nights are still blocked`);
});

// Guard the other half: a night that genuinely frees up MUST lose its UID, or the
// OTA keeps a stale block forever (L-011). Cancellations have to keep working.
test('a night that frees up loses its UID so the OTA releases it', () => {
  const before = buildIcal({ slug: 'X', title: 'X', ranges: [{ start: '2026-08-01', endExclusive: '2026-08-05' }] });
  const after = buildIcal({ slug: 'X', title: 'X', ranges: [{ start: '2026-08-01', endExclusive: '2026-08-03' }] });

  const released = [...uidsOf(before)].filter((u) => !uidsOf(after).has(u));
  assert.ok(released.length > 0, 'freeing Aug 3–4 must revoke at least one UID');
  assert.ok([...uidsOf(after)].every((u) => uidsOf(before).has(u)), 'must not invent UIDs for nights that were already blocked');
});

test('stripStamps ignores DTSTAMP/LAST-MODIFIED so identical availability compares equal', () => {
  const a = buildIcal({ slug: 'X', title: 'X', ranges: [{ start: '2026-08-01', endExclusive: '2026-08-05' }] });
  const b = a.replace(/^DTSTAMP:.*$/m, 'DTSTAMP:20990101T000000Z')
             .replace(/^LAST-MODIFIED:.*$/m, 'LAST-MODIFIED:20990101T000000Z');
  assert.notStrictEqual(a, b);
  assert.strictEqual(stripStamps(a), stripStamps(b));
});

test('stripStamps still sees a real availability change', () => {
  const a = buildIcal({ slug: 'X', title: 'X', ranges: [{ start: '2026-08-01', endExclusive: '2026-08-05' }] });
  const c = buildIcal({ slug: 'X', title: 'X', ranges: [{ start: '2026-08-01', endExclusive: '2026-08-09' }] });
  assert.notStrictEqual(stripStamps(a), stripStamps(c));
});
