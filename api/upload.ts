import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';


const supabase = createClient(
  process.env.SUPABASE_URL!,              // ←環境変数から
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // ←環境変数から
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { filename = 'image.jpg', contentType = 'image/jpeg', base64 } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'base64 required' });

    // posts/ 配下に保存
    const safeName = String(filename).replace(/[^\w.\-]/g, '_');
    const key = `posts/${randomUUID()}-${safeName}`;

    const buffer = Buffer.from(base64, 'base64');
    const { error: upErr } = await supabase
      .storage
      .from('uploads') // バケット名
      .upload(key, buffer, { contentType, upsert: false });

    if (upErr) return res.status(500).json({ error: upErr.message });

    const { data } = supabase.storage.from('uploads').getPublicUrl(key);
    return res.status(200).json({ ok: true, key, publicUrl: data.publicUrl });
  } catch (e:any) {
    return res.status(500).json({ error: e?.message ?? 'upload failed' });
  }
}
