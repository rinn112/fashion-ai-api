import type { VercelRequest, VercelResponse } from '@vercel/node';

export function withCORS(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<any> | any,
  opts: { origin?: string } = {}
) {
  const allowOrigin = opts.origin ?? "*";
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,x-cron-secret");
    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }
    return handler(req, res);
  };
}
