// api/log-sheet.js
// Appends one row to the Google Sheet with all readings + Drive photo links

const SPREADSHEET_ID = '1LI7vx3YKsfmEyedRaZMJcFDBuhR3t9NGXxpuLVG9K5E';
const SHEET_NAME = 'Sheet1';

async function getAccessToken() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const { SignJWT, importPKCS8 } = await import('jose');
  const privateKey = await importPKCS8(creds.private_key, 'RS256');
  const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/spreadsheets' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(creds.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .sign(privateKey);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

async function ensureHeaders(token) {
  // Check if headers exist in row 1
  const checkRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A1:L1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const checkData = await checkRes.json();
  const hasHeaders = checkData.values && checkData.values[0] && checkData.values[0].length > 0;

  if (!hasHeaders) {
    const headers = [
      'Submitted At', 'Worker Name', 'Boiler Unit', 'Shift', 'Date', 'Time',
      'Boiler Temp (°C)', 'Condenser Temp (°C)', 'Condenser Pressure (MPa)',
      'Boiler Temp Photo', 'Condenser Temp Photo', 'Condenser Pressure Photo'
    ];
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A1:L1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [headers] })
      }
    );
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { meta, driveLinks } = req.body;

  try {
    const token = await getAccessToken();
    await ensureHeaders(token);

    const submittedAt = new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });

    const row = [
      submittedAt,
      meta.name,
      meta.boiler,
      meta.shift,
      meta.date,
      meta.time,
      meta.boilerTemp,
      meta.condTemp,
      meta.condPres,
      driveLinks['boiler-temp'] || '',
      driveLinks['cond-temp'] || '',
      driveLinks['cond-pres'] || '',
    ];

    const appendRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A:L:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [row] })
      }
    );

    if (!appendRes.ok) {
      const err = await appendRes.text();
      throw new Error('Sheet append failed: ' + err);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Sheet log error:', err);
    return res.status(500).json({ error: err.message });
  }
}
