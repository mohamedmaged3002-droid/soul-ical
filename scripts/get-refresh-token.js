// One-time: mint a Google OAuth refresh token for maged@bluekeys.co.
// Prereq: a Google Cloud OAuth 2.0 Client (type "Desktop app"); Sheets API enabled.
// Usage:
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node scripts/get-refresh-token.js
const http = require('http');
const { google } = require('googleapis');

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const cid = process.env.GOOGLE_OAUTH_CLIENT_ID;
const csec = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!cid || !csec) { console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET'); process.exit(1); }

const oauth2 = new google.auth.OAuth2(cid, csec, REDIRECT);
const url = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a refresh_token even on re-auth
  scope: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) { res.end('No code in callback.'); return; }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.end('Done — close this tab; the refresh token is in your terminal.');
    console.log('\n=== GOOGLE_OAUTH_REFRESH_TOKEN ===\n' + tokens.refresh_token + '\n');
  } catch (e) {
    res.end('Error: ' + e.message);
    console.error(e);
  } finally {
    server.close();
  }
});
server.listen(PORT, () => {
  console.log('1) Open this URL, sign in as maged@bluekeys.co, and approve');
  console.log('   (click "Advanced -> continue" past the unverified-app warning):\n');
  console.log(url + '\n');
});
