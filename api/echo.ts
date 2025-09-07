export const config = { runtime: 'edge' };
function H(extra={}){ return new Headers({ 'access-control-allow-origin': '*', ...extra }); }
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H({ 'access-control-allow-headers':'content-type', 'access-control-allow-methods':'POST,GET,OPTIONS' }) });
  return new Response(JSON.stringify({ ok: true, now: new Date().toISOString() }), { headers: H({ 'content-type':'application/json' }) });
}
