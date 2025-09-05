const HF_MODEL = 'google/vit-base-patch16-224'; // 起動が速い画像分類
const HF_API = `https://api-inference.huggingface.co/models/${HF_MODEL}?wait_for_model=true`;

async function callHF(imageUrl: string, signal: AbortSignal) {
  const resp = await fetch(HF_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN!}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: imageUrl }),
    signal,
  });

  if (resp.status === 503) {
    throw new Error(`HF 503 (model loading): ${await resp.text()}`);
  }
  if (!resp.ok) {
    throw new Error(`HF ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { imageUrl } = (req.body || {}) as { imageUrl?: string };
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);

  try {
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        const result = await callHF(imageUrl, ac.signal);
        clearTimeout(timer);
        return res.status(200).json({ ok: true, model: HF_MODEL, result });
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message ?? '');
        if (msg.includes('503') || msg.includes('504') || msg.includes('Gateway Timeout')) {
          await new Promise(r => setTimeout(r, 1500 * (i + 1))); // 1.5s, 3s, 4.5s
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  } catch (e: any) {
    clearTimeout(timer);
    const message = String(e?.message ?? 'analyze failed');
    const isHtml = /<\/html>/i.test(message) || /<head>/i.test(message);
    return res.status(500).json({
      error: isHtml ? 'Hugging Face returned an HTML error page (likely timeout).' : message,
    });
  }
}
