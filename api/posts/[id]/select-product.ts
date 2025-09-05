// api/posts/[id]/select-product.ts
import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { id } = req.query as { id: string };
    if (!id) return res.status(400).json({ error: 'post id required' });

    const { product, source = 'manual' } = req.body || {};
    if (!product?.url) return res.status(400).json({ error: 'product.url required' });

    const selected = {
      ...product,
      source,
      saved_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('posts')
      .update({ selected_product: selected })
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'select failed' });
  }
}
