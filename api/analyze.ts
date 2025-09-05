// api/analyze.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Buffer } from 'node:buffer';

const HF_TOKEN = process.env.HF_TOKEN!;
const MODEL = 'microsoft/resnet-50';
const HF_URL = `https://api-inference.huggingface.co/models/${MODEL}`;

// 画像を Buffer で取得（Node ならこれが一番素直）
async function fetchImageBuffer(url: string, signal?: AbortSignal): Promise<Buffer> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`image fetch failed: ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

// Buffer をそのまま POST（Buffer は Uint8Array なので Node の fetch が受け付ける）
async function classifyImage(buf: Buffer, signal?: AbortSignal) {
  const r = await fetch(HF_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      'X-Wait-For-Model': 'true',
      'Content-Type': 'application/octet-stream',
    },
    // 型の取り回しで赤線が出る環境向けに as any を付けておくと安全です
    body: buf as any,
    signal,
  });

  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HF ${r.status}: ${t.slice(0, 400)}`);
  }
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

// req.body の型赤線対策
type ReqWithBody = VercelRequest & { body?: any };

export default async function handler(req: ReqWithBody, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const raw = req.body ?? {};
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const { imageUrl } = (parsed as { imageUrl?: string });

    if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 120_000);

    const t0 = Date.now();
    const buf = await fetchImageBuffer(imageUrl, ac.signal);
    const labels = await classifyImage(buf, ac.signal);
    clearTimeout(to);

    const top5 = labels
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 5)
      .map((x: any) => ({ label: x.label, score: x.score }));

    return res.status(200).json({
      ok: true,
      model: MODEL,
      imageUrl,
      top5,
      elapsedMs: Date.now() - t0,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'analyze failed' });
  }
}
