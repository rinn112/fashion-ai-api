// api/resolve-product.ts
import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const UA =
  'Mozilla/5.0 (compatible; FashionAI-Bot/1.0; +https://fashion-ai-api.vercel.app)';
const FETCH_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('fetch timeout')), ms);
    p.then((v) => {
      clearTimeout(id);
      resolve(v);
    }).catch((e) => {
      clearTimeout(id);
      reject(e);
    });
  });
}

function firstMatch(html: string, regexes: RegExp[]): string | undefined {
  for (const r of regexes) {
    const m = html.match(r);
    if (m?.[1]) return decodeHTMLEntities(m[1]);
  }
}

function decodeHTMLEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function absURL(maybe: string | undefined, base: string) {
  if (!maybe) return undefined;
  try {
    return new URL(maybe, base).toString();
  } catch {
    return undefined;
  }
}

function parsePrice(text?: string) {
  if (!text) return undefined;
  const m = text.replace(/[, ]/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });

    // 既存キャッシュ確認
    const { data: cached } = await supabase.from('products').select('*').eq('url', url).maybeSingle();
    if (cached) {
      return res.status(200).json({ ok: true, product: cached, cache: 'hit' });
    }

    // 取得
    const resp = await withTimeout(
      fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*' } }),
      FETCH_TIMEOUT_MS
    );
    if (!resp.ok) {
      return res.status(502).json({ error: `fetch failed: ${resp.status}` });
    }
    const html = await resp.text();

    // Open Graph / Twitter Card / 一般メタ
    const base = url;

    const title =
      firstMatch(html, [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<title[^>]*>([^<]+)<\/title>/i,
      ]) || undefined;

    const imageRel =
      firstMatch(html, [
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/i,
      ]) || undefined;

    const image = absURL(imageRel, base);

    const priceText =
      firstMatch(html, [
        /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /"price"\s*:\s*"([^"]+)"/i, // JSON-LD fallback
      ]) || undefined;

    const brand =
      firstMatch(html, [
        /<meta[^>]+property=["']product:brand["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+name=["']brand["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      ]) || undefined;

    const faviconRel =
      firstMatch(html, [
        /<link[^>]+rel=["']icon["'][^>]+href=["']([^"']+)["'][^>]*>/i,
        /<link[^>]+rel=["']shortcut icon["'][^>]+href=["']([^"']+)["'][^>]*>/i,
      ]) || undefined;
    const favicon = absURL(faviconRel, base);

    const price = parsePrice(priceText);

    const product = {
      url,
      title,
      image,
      price,
      brand,
      favicon,
      fetched_at: new Date().toISOString(),
      meta: { priceRaw: priceText },
    };

    // UPSERT
    const { error: upErr, data: up } = await supabase
      .from('products')
      .upsert(product, { onConflict: 'url' })
      .select()
      .maybeSingle();

    if (upErr) return res.status(500).json({ error: upErr.message });

    return res.status(200).json({ ok: true, product: up ?? product, cache: 'miss' });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'resolve failed' });
  }
}
