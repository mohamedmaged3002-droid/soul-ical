// Read-only Google Sheets access. Two auth methods are supported; whichever is
// configured in env wins (service account takes precedence if both are present):
//   1. Service account  — set GDRIVE_SA_JSON (the same key mynt-drive-adapter uses).
//      The SA's client_email must be granted Viewer on the Soul sheet.
//   2. OAuth as a user   — set GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN
//      (authenticates as maged@bluekeys.co, who already has read access).
// Either way we request read-only scope and never write to Sheets.
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

// 'service-account' | 'oauth' | 'none' — pure, so it can be unit-tested.
function authMode(env = process.env) {
  if (env.GDRIVE_SA_JSON) return 'service-account';
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    return 'oauth';
  }
  return 'none';
}

function buildAuth(env = process.env) {
  const mode = authMode(env);
  if (mode === 'service-account') {
    return new google.auth.GoogleAuth({ credentials: JSON.parse(env.GDRIVE_SA_JSON), scopes: SCOPES });
  }
  if (mode === 'oauth') {
    const oauth2 = new google.auth.OAuth2(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });
    return oauth2;
  }
  throw new Error(
    'No Google auth configured. Set GDRIVE_SA_JSON (service account) OR ' +
    'GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET + GOOGLE_OAUTH_REFRESH_TOKEN (OAuth).',
  );
}

function sheetsClient() {
  return google.sheets({ version: 'v4', auth: buildAuth() });
}

// Transient network failures worth retrying. ERR_STREAM_PREMATURE_CLOSE in
// particular hits the OAuth token endpoint on CI runners — gaxios won't retry a
// stream that already started, so we retry the whole call ourselves.
function isTransient(err) {
  if (!err) return false;
  if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') return true;
  return /premature close|ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|fetch failed|network|503|429/i
    .test(`${err.code || ''} ${err.message || ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pull every tab with values + effective background colours + merges. Returns
//   [{ title, merges:[{startRowIndex,endRowIndex,startColumnIndex,endColumnIndex}],
//      rows: cell[][] }]   where cell = { text:string, bg:{red,green,blue}|null }.
async function fetchGrid(spreadsheetId, { retries = 5 } = {}) {
  const sheets = sheetsClient();
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchGridOnce(sheets, spreadsheetId);
    } catch (e) {
      lastErr = e;
      if (attempt < retries && isTransient(e)) {
        const wait = 1000 * 2 ** (attempt - 1); // 1s,2s,4s,8s
        console.warn(`fetchGrid attempt ${attempt} failed (${e.code || e.message}); retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function fetchGridOnce(sheets, spreadsheetId) {
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    includeGridData: true,
    fields:
      'sheets(properties(title),merges,data(rowData(values(formattedValue,effectiveFormat(backgroundColor)))))',
  });
  return (data.sheets || []).map((s) => {
    const grid = (s.data && s.data[0] && s.data[0].rowData) || [];
    const rows = grid.map((rd) =>
      (rd.values || []).map((v) => ({
        text: v.formattedValue != null ? String(v.formattedValue) : '',
        bg: (v.effectiveFormat && v.effectiveFormat.backgroundColor) || null,
      })),
    );
    return { title: s.properties.title, merges: s.merges || [], rows };
  });
}

module.exports = { authMode, buildAuth, sheetsClient, fetchGrid, isTransient };
