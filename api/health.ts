// api/health.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = { runtime: 'nodejs' }

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const hasHF = !!process.env.HF_TOKEN
    const region = process.env.VERCEL_REGION || 'unknown'

    // 失敗しない・常に JSON で返す
    res.status(200).json({
      ok: true,
      region,
      hasHF,
      // 任意のプローブ（増やしたければここに boolean を足す）
      env: {
        HF_TOKEN: hasHF ? 'set' : 'missing',
      },
    })
  } catch {
    // ここも「絶対落とさない」
    res.status(200).json({
      ok: false,
      error: 'health handler error',
    })
  }
}
