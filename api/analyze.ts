// api/analyze.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Vercel 要件: 'nodejs20.x' ではなく 'nodejs'
export const config = { runtime: 'nodejs' }

// ==== 設定 ====
// HF_TOKEN は Vercel の環境変数に設定（なくても匿名で一部モデルは叩ける）
const HF_TOKEN = process.env.HF_TOKEN || ''

// とりあえず動作確認用の軽量モデル（画像分類）
const MODEL = 'microsoft/resnet-50'
const HF_URL = `https://api-inference.huggingface.co/models/${MODEL}`

// Node の型環境で DOM の AbortSignal 型が無い場合の赤線回避
type LooseAbortSignal = any

// 画像を ArrayBuffer → Uint8Array で取得（Buffer 不使用で型エラー回避）
async function fetchImageBytes(url: string, signal?: LooseAbortSignal): Promise<Uint8Array> {
  const r = await fetch(url as any, { signal } as any)
  if (!r.ok) throw new Error(`image fetch failed: ${r.status}`)
  const ab = await r.arrayBuffer()
  return new Uint8Array(ab)
}

// HF 呼び出し（コールドスタート/ロード中を考慮して軽くリトライ）
async function callHuggingFace(bytes: Uint8Array, signal?: LooseAbortSignal) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {}),
  }

  let lastErr: unknown
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(HF_URL as any, {
        method: 'POST',
        headers,
        body: bytes as any,
        signal,
      } as any)

      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json')) {
        const text = await r.text()
        throw new Error(`HF non-JSON: ${r.status} ${text.slice(0, 200)}`)
      }

      const data = await r.json()

      // モデルロード中シグナル
      const msg = (data && (data as any).error) || ''
      if (
        typeof msg === 'string' &&
        msg.toLowerCase().includes('currently loading')
      ) {
        await new Promise((res) => setTimeout(res, 2000))
        continue
      }
      if ((data as any)?.estimated_time) {
        await new Promise((res) => setTimeout(res, 2000))
        continue
      }

      return data
    } catch (e) {
      lastErr = e
      await new Promise((res) => setTimeout(res, 2000))
    }
  }
  throw lastErr
}

// ラベル -> 5分類マップ（暫定）
function mapToFiveCategories(
  label: string
): 'casual' | 'smart' | 'feminine' | 'mode' | 'outdoor' {
  const lower = label.toLowerCase()
  if (/(outdoor|hiking|mountain|trek|parka|down)/.test(lower)) return 'outdoor'
  if (/(dress|skirt|blouse|feminine|lace|floral)/.test(lower)) return 'feminine'
  if (/(suit|blazer|oxford|derby|formal|smart)/.test(lower)) return 'smart'
  if (/(leather|black|avant|mode|monochrome)/.test(lower)) return 'mode'
  return 'casual'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    // --- body を安全にパース（赤線/型崩れ対策）---
    let body: unknown = req.body ?? {}
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body' })
      }
    }
    const { imageUrl } = (body as { imageUrl?: string }) ?? {}
    if (!imageUrl || typeof imageUrl !== 'string') {
      return res.status(400).json({ error: 'Missing imageUrl' })
    }

    // タイムアウト（120s）
    const controller = new AbortController() as unknown as { signal: LooseAbortSignal; abort: () => void }
    const timer = setTimeout(() => controller.abort(), 120_000)

    // 画像取得 → HF 推論
    const bytes = await fetchImageBytes(imageUrl, controller.signal)
    const hf = await callHuggingFace(bytes, controller.signal)

    clearTimeout(timer)

    // resnet-50 形式: [{label, score}, …]
    const preds = Array.isArray(hf) ? (hf as Array<{ label: string; score: number }>) : []
    if (!preds.length) {
      return res.status(200).json({
        ok: true,
        category: 'casual',
        ai_labels: { model: MODEL, raw: hf, note: 'empty predictions -> default casual' },
      })
    }

    const top = preds[0]
    const category = mapToFiveCategories(top.label)

    return res.status(200).json({
      ok: true,
      category, // ← posts.category の初期値に
      ai_labels: {
        model: MODEL,
        top1: top,
        top3: preds.slice(0, 3),
        raw: preds,
      },
    })
  } catch (err: any) {
    // 常に JSON で返す（curl | jq が壊れない）
    return res.status(200).json({
      ok: false,
      error: String(err?.message || err),
    })
  }
}
