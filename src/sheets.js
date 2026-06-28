// Read-only Google Sheets access using Node's native `https` (NOT googleapis/
// node-fetch, whose transport throws ERR_STREAM_PREMATURE_CLOSE against Google's
// endpoints on GitHub Actions runners). Two auth methods, whichever env is set
// (service account wins): OAuth refresh token (auth as maged@bluekeys.co) or a
// service-account key. Read-only scope; we never write.
const https = require('https');
const crypto = require('crypto');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// 'service-account' | 'oauth' | 'none' — pure, unit-testable.
function authMode(env = process.env) {
  if (env.GDRIVE_SA_JSON) return 'service-account';
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    return 'oauth';
  }
  return 'none';
}

// Transient network failures worth retrying.
function isTransient(err) {
  if (!err) return false;
  if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') return true;
  return /premature close|ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|fetch failed|network|503|429/i
    .test(`${err.code || ''} ${err.message || ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal native-https request. Resolves { status, body } (body as string).
function httpsRequest(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { method, hostname: u.hostname, path: u.pathname + u.search, headers },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Exchange creds for a short-lived access token (native https, no node-fetch).
async function getAccessToken(env = process.env) {
  const mode = authMode(env);
  let params;
  if (mode === 'oauth') {
    params = {
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    };
  } else if (mode === 'service-account') {
    const creds = JSON.parse(env.GDRIVE_SA_JSON);
    const now = Math.floor(Date.now() / 1000);
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const signingInput =
      `${enc({ alg: 'RS256', typ: 'JWT' })}.` +
      `${enc({ iss: creds.client_email, scope: SCOPES.join(' '), aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
    const sig = crypto.sign('RSA-SHA256', Buffer.from(signingInput), creds.private_key).toString('base64url');
    params = {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${sig}`,
    };
  } else {
    throw new Error(
      'No Google auth configured. Set GDRIVE_SA_JSON (service account) OR ' +
      'GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET + GOOGLE_OAUTH_REFRESH_TOKEN (OAuth).',
    );
  }
  const body = new URLSearchParams(params).toString();
  const { status, body: resp } = await httpsRequest('POST', TOKEN_URL, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    body,
  });
  if (status !== 200) throw new Error(`token endpoint ${status}: ${resp.slice(0, 200)}`);
  const json = JSON.parse(resp);
  if (!json.access_token) throw new Error(`token endpoint: no access_token (${resp.slice(0, 200)})`);
  return json.access_token;
}

async function fetchGridOnce(spreadsheetId) {
  const token = await getAccessToken();
  const fields = encodeURIComponent(
    'sheets(properties(title,hidden),merges,data(rowData(values(formattedValue,effectiveFormat(backgroundColor)))))',
  );
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `?includeGridData=true&fields=${fields}`;
  const { status, body } = await httpsRequest('GET', url, { headers: { Authorization: `Bearer ${token}` } });
  if (status !== 200) throw new Error(`sheets.get ${status}: ${body.slice(0, 300)}`);
  const data = JSON.parse(body);
  return (data.sheets || []).map((s) => {
    const grid = (s.data && s.data[0] && s.data[0].rowData) || [];
    const rows = grid.map((rd) =>
      (rd.values || []).map((v) => ({
        text: v.formattedValue != null ? String(v.formattedValue) : '',
        bg: (v.effectiveFormat && v.effectiveFormat.backgroundColor) || null,
      })),
    );
    return { title: s.properties.title, hidden: !!s.properties.hidden, merges: s.merges || [], rows };
  });
}

// Pull every tab with values + background colours + merges, with a retry on
// transient network errors. Returns
//   [{ title, merges:[{startRowIndex,endRowIndex,startColumnIndex,endColumnIndex}],
//      rows: cell[][] }]   cell = { text:string, bg:{red,green,blue}|null }.
async function fetchGrid(spreadsheetId, { retries = 5 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchGridOnce(spreadsheetId);
    } catch (e) {
      lastErr = e;
      if (attempt < retries && isTransient(e)) {
        const wait = 1000 * 2 ** (attempt - 1);
        console.warn(`fetchGrid attempt ${attempt} failed (${e.code || e.message}); retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

module.exports = { authMode, isTransient, getAccessToken, fetchGrid };
