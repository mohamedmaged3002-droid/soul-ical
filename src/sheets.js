// Read-only Google Sheets access. Auth = OAuth as maged@bluekeys.co (who already has
// read access to the Soul sheet). The googleapis client auto-refreshes the access
// token from GOOGLE_OAUTH_REFRESH_TOKEN. We request read-only scope; never write.
const { google } = require('googleapis');

function sheetsClient() {
  const cid = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const csec = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const rtok = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!cid || !csec || !rtok) {
    throw new Error('Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN in env');
  }
  const oauth2 = new google.auth.OAuth2(cid, csec);
  oauth2.setCredentials({ refresh_token: rtok });
  return google.sheets({ version: 'v4', auth: oauth2 });
}

// Pull every tab with values + effective background colours + merges. Returns
//   [{ title, merges:[{startRowIndex,endRowIndex,startColumnIndex,endColumnIndex}],
//      rows: cell[][] }]   where cell = { text:string, bg:{red,green,blue}|null }.
async function fetchGrid(spreadsheetId) {
  const sheets = sheetsClient();
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

module.exports = { sheetsClient, fetchGrid };
