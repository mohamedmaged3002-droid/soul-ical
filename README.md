# soul-ical

Generates per-unit iCal (`.ics`) availability feeds served via GitHub Pages.

- Feeds: `https://mohamedmaged3002-droid.github.io/soul-ical/<unit-code>.ics`
- Refresh: GitHub Actions, every 15 minutes.
- Run locally: copy `.env.example` to `.env`, fill secrets, then `npm ci && npm run sync`.

Each feed lists blocked date ranges as all-day `VEVENT`s (`DTEND` exclusive).
