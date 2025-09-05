// api/health.ts
import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    region: process.env.VERCEL_REGION,
    hasHF: Boolean(process.env.HF_TOKEN),
    hasURL: Boolean(process.env.SUPABASE_URL),
    hasKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}
