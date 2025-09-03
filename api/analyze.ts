import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';
import { join } from 'path';
import { withCORS } from '../helpers/cors';

// ---- 設定 ----
const HF_TOKEN = process.env.HF_TOKEN!;
const CLIP_MODEL = 'openai/clip-vit-base-patch32';

// ラベル（必要に応じて後で調整）
const TYPE_LABELS = [
  { ja: 'Tシャツ', en: 't-shirt' }, { ja: 'シャツ', en: 'shirt' },
  { ja: 'パーカー', en: 'hoodie' }, { ja: 'スウェット', en: 'sweatshirt' },
  { ja: 'ジャケット', en: 'jacket' }, { ja: 'コート', en: 'coat' },
  { ja: 'ニット', en: 'knit sweater' }, { ja: 'ワンピース', en: 'dress' },
  { ja: 'スカート', en: 'skirt' }, { ja: 'パンツ', en: 'pants' },
  { ja: 'ジーンズ', en: 'jeans' }, { ja: 'ショーツ', en: 'shorts' },
  { ja: 'スニーカー', en: 'sneakers' }, { ja: 'ブーツ', en: 'boots' },
  { ja: 'バッグ', en: 'bag' }, { ja: '帽子', en: 'hat' }, { ja: 'アクセサリー', en: 'accessory' },
];

const STYLE_LABELS = [
  { ja: 'カジュアル', en: 'casual style' }, { ja: 'ストリート', en: 'streetwear style' },
  { ja: 'フォーマル', en: 'formal style' }, { ja: 'ミニマル', en: 'minimal style' },
  { ja: 'ガーリー', en: 'girly style' }, { ja: 'スポーティ', en: 'sporty style' },
  { ja: 'キレイめ', en: 'smart casual style' }, { ja: 'モード', en: 'high fashion style' },
  { ja: 'ヴィンテージ', en: 'vintage style' }, { ja: 'ナチュラル', en: 'natural style' },
];

// ---- ユーティリティ ----
const flatten = (x: any): number[] => (Array.isArray(x) ? x.flat(10) : x);
function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const ai = a[i], bi = b[i];
    dot += ai * bi; na += ai * ai; nb += bi * bi;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

async function hfEmbedImageByUrl(imageUrl: string): Promise<number[]> {
  const img = await fetch(imageUrl);
  if (!img.ok) throw new Error('image fetch failed');
  const buf = Buffer.from(await img.arrayBuffer());
  const resp = await fetch(`https://api-inference.huggingface.co/models/${CLIP_MODEL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'x-wait-for-model': 'true',
    },
    body: buf,
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  return flatten(data);
}

async function hfEmbedText(text: string): Promise<number[]> {
  const resp = await fetch(`https://api-inference.huggingface.co/models/${CLIP_MODEL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
      'x-wait-for-model': 'true',
    },
    body: JSON.stringify({ inputs: text }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  const arr = flatten(await resp.json());
  const dim = 512;
  if (arr.length > dim) {
    const tokens = Math.floor(arr.length / dim);
    const out = new Array(dim).fill(0);
    for (let t = 0; t < tokens; t++) for (let d = 0; d < dim; d++) out[d] += arr[t*dim + d];
    return out.map(v => v / tokens);
  }
  return arr;
}

async function classifyZeroShot(imageVec: number[], labels: {ja:string; en:string}[]) {
  const scored = [];
  for (const lab of labels) {
    const t = await hfEmbedText(`a photo of ${lab.en}`);
    scored.push({ ...lab, score: cosine(imageVec, t) });
  }
  scored.sort((a:any,b:any)=>b.score-a.score);
  return scored;
}

async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const html = await r.text();
    const $ = cheerio.load(html);
    const og = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content');
    if (!og) return null;
    if (/^https?:\/\//.test(og)) return og;
    const base = new URL(url);
    return new URL(og, `${base.protocol}//${base.host}`).toString();
  } catch { return null; }
}

function loadCatalog(): { title: string; url: string; imageUrl?: string }[] {
  const p = join(process.cwd(), 'data', 'catalog.json');
  const txt = readFileSync(p, 'utf-8');
  return JSON.parse(txt);
}

export default withCORS(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { imageUrl } = req.body as { imageUrl?: string };
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

  try {
    // 1) 画像ベクトル
    const imgVec = await hfEmbedImageByUrl(imageUrl);

    // 2) 種類・雰囲気
    const typeRank = await classifyZeroShot(imgVec, TYPE_LABELS);
    const styleRank = await classifyZeroShot(imgVec, STYLE_LABELS);
    const type = typeRank[0]?.ja ?? '不明';
    const styles = styleRank.slice(0, 3).map(s => s.ja);

    // 3) 類似検索（MVP：catalog.json を総当り）
    const catalog = loadCatalog();
    const results: { title:string; url:string; imageUrl?:string; score:number }[] = [];
    for (const item of catalog) {
      let u = item.imageUrl || await fetchOgImage(item.url) || undefined;
      if (!u) continue;
      const v = await hfEmbedImageByUrl(u);
      results.push({ title: item.title, url: item.url, imageUrl: u, score: cosine(imgVec, v) });
    }
    results.sort((a,b)=>b.score-a.score);
    const similar = results.slice(0,8);

    res.status(200).json({ type, styles, similar });
  } catch (e:any) {
    res.status(500).json({ error: e?.message || 'server error' });
  }
});
