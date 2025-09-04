import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { withCORS } from '../helpers/cors';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export default withCORS(async (req: any, res: any) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { filename, contentType, base64 } = req.body ?? {};
  if (!base64) return res.status(400).json({ error: 'base64 required' });

  const name = filename ?? `image-${Date.now()}.jpg`;
  const path = `posts/${randomUUID()}-${name}`;
  const buf = Buffer.from(base64, 'base64');

  const { error } = await supabase.storage.from('uploads').upload(path, buf, {
    contentType: contentType ?? 'image/jpeg',
    upsert: false
  });
  if (error) return res.status(500).json({ error: error.message });

  const { data } = supabase.storage.from('uploads').getPublicUrl(path);
  res.status(200).json({ publicUrl: data.publicUrl });
});