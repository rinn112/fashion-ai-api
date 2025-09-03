import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withCORS } from '../helpers/cors';

export default withCORS(async (_req: VercelRequest, res: VercelResponse) => {
  res.status(200).json({ ok: true, region: process.env.VERCEL_REGION ?? 'unknown' });
});
