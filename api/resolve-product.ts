import type { VercelRequest, VercelResponse } from '@vercel/node';
export const config = { runtime: 'nodejs' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function resolveUrl(base: string, maybeRel: string): string {
  try { return new URL(maybeRel, base).toString(); } catch { return maybeRel; }
}
function pickMeta(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}
function extractJsonLd(html: string): any | null {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of scripts) {
    try {
      const obj = JSON.parse(s[1]);
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const x of arr) {
        const t = x?.['@type'];
        const isProduct = (typeof t === 'string' && t.toLowerCase() === 'product') || (Array.isArray(t) && t.includes('Product'));
        if (isProduct) return x;
      }
    } catch {}
  }
  return null;
}
function bestImgFromHtml(html: string, baseUrl: string): string | null {
  const metas = [pickMeta(html, 'og:image'), pickMeta(html, 'twitter:image'), pickMeta(html, 'twitter:image:src')].filter(Boolean) as string[];
  if (metas.length) return resolveUrl(baseUrl, metas[0]!);
  const imgs = [...html.matchAll(/<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
  if (imgs.length) {
    const cand = imgs.sort((a, b) => b.length - a.length)[0];
    return resolveUrl(baseUrl, cand);
  }
  return null;
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', CORS['Access-Control-Allow-Headers']);
      res.setHeader('Access-Control-Allow-Methods', CORS['Access-Control-Allow-Methods']);
      return res.status(204).end();
    }
    if (req.method !== 'POST') {
      return res.status(405).setHeader('Allow', 'POST, OPTIONS').json({ ok: false, error: 'Method Not Allowed' });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const url = body?.url;
    if (!url) { res.setHeader('Access-Control-Allow-Origin', '*'); return res.status(400).json({ ok: false, error: 'missing url' }); }
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 12000);
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FashionAppBot/1.0; +https://vercel.com)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.8',
      },
      redirect: 'follow',
      signal: ac.signal,
    }).catch((e) => { throw new Error(`fetch failed: ${String(e?.message || e)}`); }) as Response;
    clearTimeout(to);
    if (!r?.ok) { res.setHeader('Access-Control-Allow-Origin', '*'); return res.status(502).json({ ok: false, error: `upstream ${r?.status ?? 0}` }); }
    const html = await r.text();
    const jsonld = extractJsonLd(html);
    let title = pickMeta(html, 'og:title') || pickMeta(html, 'twitter:title') || null;
    let price: string | null = null;
    let image = bestImgFromHtml(html, url);
    if (jsonld) {
      if (!title) title = jsonld.name || jsonld.title || null;
      if (!image) {
        const im = jsonld.image;
        if (typeof im === 'string') image = resolveUrl(url, im);
        else if (Array.isArray(im) && im.length) image = resolveUrl(url, im[0]);
      }
      const offers = Array.isArray(jsonld.offers) ? jsonld.offers[0] : jsonld.offers;
      if (offers?.price) price = String(offers.price);
      if (!price && offers?.priceSpecification?.price) price = String(offers.priceSpecification.price);
    }
    if (!title) {
      const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      title = m ? m[1].trim() : '商品';
    }
    const product = { url, title, image, price, source: 'auto', fetched_at: new Date().toISOString() };
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ ok: true, product });
  } catch (e: any) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}
