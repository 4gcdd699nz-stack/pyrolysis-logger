import crypto from 'crypto';

const FOLDER_NAMES = {
  'boiler-temp': 'boiler_temperature',
  'cond-temp':   'condenser_temperature',
  'cond-pres':   'condenser_pressure',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { base64, mimeType, fileName, paramKey, meta } = req.body;
  if (!base64 || !paramKey || !FOLDER_NAMES[paramKey]) {
    return res.status(400).json({ error: 'Missing fields or invalid paramKey' });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Cloudinary env vars not set' });
  }

  try {
    const folder    = `pyrolysis_plant/${FOLDER_NAMES[paramKey]}`;
    const publicId  = fileName.replace(/\.[^/.]+$/, '').replace(/\s+/g, '_');
    const timestamp = Math.floor(Date.now() / 1000);

    const sigString = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha256').update(sigString).digest('hex');

    const formData = new FormData();
    formData.append('file', `data:${mimeType};base64,${base64}`);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('folder', folder);
    formData.append('public_id', publicId);

    const uploadRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: 'POST', body: formData }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error('Cloudinary upload failed: ' + err);
    }

    const data = await uploadRes.json();
    return res.status(200).json({ fileId: data.public_id, fileUrl: data.secure_url });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
}
