const FOLDER_IDS = {
  'boiler-temp': '1HPngUz9UNHaUc6UuAjTRJQmh3Obiy8z3',
  'cond-temp':   '1cdZip3-pPSxAHqdsVCUnhpu8oeClHn6f',
  'cond-pres':   '1bYodmZNDTweynmZhjfMS5mqKxnZOIWZm',
};

async function getAccessToken() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const { SignJWT, importPKCS8 } = await import('jose');
  const privateKey = await importPKCS8(creds.private_key, 'RS256');
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(creds.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setSubject(creds.client_email)
    .sign(privateKey);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return { token: data.access_token, creds };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { base64, mimeType, fileName, paramKey } = req.body;
  if (!base64 || !paramKey || !FOLDER_IDS[paramKey]) {
    return res.status(400).json({ error: 'Missing fields or invalid paramKey' });
  }

  try {
    const { token } = await getAccessToken();
    const folderId = FOLDER_IDS[paramKey];

    const boundary = 'boundary_' + Date.now();
    const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64}\r\n--${boundary}--`;

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error('Drive upload failed: ' + err);
    }

    const file = await uploadRes.json();

    await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    return res.status(200).json({ fileId: file.id, fileUrl: file.webViewLink });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
}
