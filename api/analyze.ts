// api/analyze.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const HF_TOKEN = process.env.HF_TOKEN; // Vercel に登録済みの Hugging Face Access Token

// ① 分類したいラベル（必要に応じて編集）
const LABELS = [
  't-shirt', 'shirt', 'sweater', 'hoodie', 'jacket', 'coat',
  'dress', 'skirt', 'pants', 'jeans', 'shorts',
  'sneakers', 'shoes', 'boots',
  'bag', 'backpack', 'hat', 'cap', 'scarf',
  'watch', 'belt', 'glasses'
];

// ② ラベル→リンク先URL のマッピング（ここを “適切なURL” に差し替えていく）
const CATEGORY_URLS: Record<string, string> = {
  't-shirt': 'https://example.com/category/t-shirt',
  'shirt': 'https://example.com/category/shirt',
  'sweater': 'https://example.com/category/sweater',
  'hoodie': 'https://example.com/category/hoodie',
  'jacket': 'https://example.com/category/jacket',
  'coat': 'https://example.com/category/coat',
  'dress': 'https://example.com/category/dress',
  'skirt': 'https://example.com/category/skirt',
  'pants': 'https://example.com/category/pants',
  'jeans': 'https://example.com/category/jeans',
  'shorts': 'https://example.com/category/shorts',
  'sneakers': 'https://example.com/category/sneakers',
  'shoes': 'https://example.com/category/shoes',
  'boots': 'https://example.com/category/boots',
  'bag': 'https://example.com/category/bag',
  'backpack': 'https://example.com/category/backpack',
  'hat': 'https://example.com/category/hat',
  'cap': 'https://example.com/category/cap',
  'scarf': 'https://example.com/category/scarf',
  'watch': 'https://example.com/category/watch',
  'belt': 'https://example.com/category/belt',
  'glasses': 'https://example.com/category/glasses'
};

// HF Inference API（CLIP）エンドポイント
const HF_ENDPOINT =
  'https://api-inference.huggingface.co/models/openai/clip-vit-base-patch32?wait_for_model=true';

async function hfZeroShotImageClassify(imageUrl: string, labels: string[]) {
  const body = {
    inputs: imageUrl,
    parameters: { candidate_labels: labels }
  };

  const res = await fetch(HF_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  // モデルのスリープや準備中で 503/504 が返ることがあるので中身は上位でリトライ
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HF ${res.status}: ${text.slice(0, 300)}`);
  }

  // 返り値は [{label, score}, ...] 想定
  const data = await res.json();
  return data as Array<{ label: string; score: number }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!HF_TOKEN) return res.status(500).json({ error: 'HF_TOKEN is not set' });

  try {
    const { imageUrl } = (req.body ?? {}) as { imageUrl?: string };
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

    // ③ リトライ（モデル起動待ち・一時的な 504/503 に備える）
    const MAX_RETRY = 3;
    const SLEEP = (ms: number) => new Promise(r => setTimeout(r, ms));

    let result: Array<{ label: string; score: number }> = [];
    let lastErr: unknown;

    for (let i = 0; i < MAX_RETRY; i++) {
      try {
        result = await hfZeroShotImageClassify(imageUrl, LABELS);
        if (Array.isArray(result) && result.length) break;
      } catch (e) {
        lastErr = e;
        // 次のリトライまで少し待つ
        await SLEEP(1500 * (i + 1));
      }
    }

    if (!result.length) {
      throw lastErr ?? new Error('classification failed');
    }

    // ④ 最上位スコアのラベルを採用
    const top = result[0];
    const url = CATEGORY_URLS[top.label] ?? 'https://example.com/';

    return res.status(200).json({
      ok: true,
      imageUrl,
      topLabel: top.label,
      score: top.score,
      url,
      ranked: result // デバッグ・確認用。不要なら消してOK
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'analyze failed' });
  }
}
