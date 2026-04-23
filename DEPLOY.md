// api/upload-photo.js
// Receives base64 image + metadata, uploads to the correct Google Drive folder

const FOLDER_IDS = {
  'boiler-temp': '1HPngUz9UNHaUc6UuAjTRJQmh3Obiy8z3',  // Boiler Temperature Photos
  'cond-temp':   '1cdZip3-pPSxAHqdsVCUnhpu8oeClHn6f',  // Condenser Temperature Photos
  'cond-pres':   '1bYodmZNDTweynmZhjfMS5mqKxnZOIWZm',  // Condenser Pressure Photos
};

async function getAccessToken() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  // Use the jose library via dynamic import for JWT signing
  const { SignJWT, importPKCS8 } = await import('jose');
  const privateKey = await importPKCS8(creds.private_key, 'RS256');
  const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/drive' })
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
  if (!data.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(data));
  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { base64, mimeType, fileName, paramKey, meta } = req.body;
  if (!base64 || !paramKey || !FOLDER_IDS[paramKey]) {
    return res.status(400).json({ error: 'Missing required fields or invalid paramKey' });
  }

  try {
    const accessToken = await getAccessToken();
    const folderId = FOLDER_IDS[paramKey];
    const fileBytes = Buffer.from(base64, 'base64');

    // Multipart upload to Drive
    const boundary = '-------boundary_' + Date.now();
    const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      'Content-Transfer-Encoding: base64',
      '',
      base64,
      `--${boundary}--`
    ].join('\r\n');

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error('Drive upload failed: ' + err);
    }

    const file = await uploadRes.json();

    // Make file viewable by anyone with the link
    await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });

    return res.status(200).json({ fileId: file.id, fileUrl: file.webViewLink });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
}
