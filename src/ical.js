const { ymd, parseIso, addDays } = require('./dates');

function esc(text) {
  return String(text || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
}

// iCal UTC timestamp, e.g. 20260628T201824Z
function icalStamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// { slug, title, ranges:[{start, endExclusive}] } -> RentalsUnited-style iCal (CRLF).
function buildIcal({ slug, title, ranges = [] }) {
  const stamp = icalStamp();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BlueKeys Soul iCal//EN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(title)}`,
    'CALSCALE:GREGORIAN',
  ];
  // ONE VEVENT PER NIGHT, keyed on the night itself.
  //
  // A range's boundaries are not a stable thing to name: they are an artefact of
  // which neighbouring nights happen to be blocked. Fold start+end into the UID
  // and every merge, split, extension or trim revokes UIDs whose nights are still
  // booked — the OTA applies the delete, misses the re-add, and resells the unit.
  // That is what sold SA-3A-B02 for Aug 6-10 when a gap closed on 2026-07-23.
  //
  // A night IS stable. Keyed this way an event's body never changes, so nothing
  // ever needs to "update" — nights only appear (block) or disappear (release),
  // which is the one thing every OTA importer handles correctly. That also keeps
  // L-011 satisfied without relying on DTSTAMP, which importers ignore.
  for (const r of ranges) {
    const end = parseIso(r.endExclusive);
    for (let d = parseIso(r.start); d < end; d = addDays(d, 1)) {
      const night = ymd(d);
      lines.push(
        'BEGIN:VEVENT',
        `UID:soul-${slug}-${night}@bluekeys.co`,
        `DTSTAMP:${stamp}`,
        `LAST-MODIFIED:${stamp}`,
        'SEQUENCE:0',
        `DTSTART;VALUE=DATE:${night}`,
        `DTEND;VALUE=DATE:${ymd(addDays(d, 1))}`,
        'SUMMARY:Unavailable',
        'STATUS:CONFIRMED',
        'TRANSP:OPAQUE',
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// Drop the per-build timestamp lines so two renders of the SAME availability
// compare equal. Every buildIcal() call stamps DTSTAMP/LAST-MODIFIED with "now",
// so a byte comparison always differs and would commit on every 15-min run.
// (Same principle as ical-sync Rule 8: hash content, not stamps.)
function stripStamps(text) {
  return String(text || '').replace(/^(DTSTAMP|LAST-MODIFIED):.*\r?\n/gm, '');
}

module.exports = { buildIcal, stripStamps };
