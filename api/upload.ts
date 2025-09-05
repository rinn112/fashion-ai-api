import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 型は any で十分（ランタイムは Node.js）
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { filename = 'image.jpg', contentType = 'image/jpeg', base64 } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'base64 required' });

    const safeName = String(filename).replace(/[^\w.\-]/g, '_');
    const key = `posts/${randomUUID()}-${safeName}`;

    const buffer = Buffer.from(base64, 'base64');
    const { error: upErr } = await supabase
      .storage
      .from('uploads')
      .upload(key, buffer, { contentType, upsert: false });

    if (upErr) return res.status(500).json({ error: upErr.message });

    const { data } = supabase.storage.from('uploads').getPublicUrl(key);
    return res.status(200).json({ ok: true, key, publicUrl: data.publicUrl });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'upload failed' });
  }
}
