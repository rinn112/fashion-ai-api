/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// deno-lint-ignore-file no-explicit-any

/* @ts-ignore — VSCode(Node)だとURL importに赤線が出るため抑止（Denoでは有効） */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type Mode = 'hf' | 'mock';
const CATEGORIES = ['カジュアル','スマート','フェミニン','モード','アウトドア'] as const;

// ---- Secrets（Deno.env） ----
const HF_TOKEN: string = (globalThis as any)?.Deno?.env?.get?.('HF_TOKEN') ?? '';

// ---- 共通ユーティリティ ----
function json(resBody: unknown, status = 200) {
  return new Response(JSON.stringify(resBody), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}
const badRequest = (msg: string, detail?: unknown) => json({ error: msg, detail }, 400);

// 画像を bytes で取得（Buffer 不使用）
async function fetchImageBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`image fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ---- HF 推論（無料）+ リトライ + 待機ヘッダ、失敗時は必ず Mock ----
async function runHF(imageUrl: string) {
  if (!HF_TOKEN) throw new Error('HF_TOKEN not set');

  const bytes: Uint8Array = await fetchImageBytes(imageUrl);

  // VSCode(Node) の型解決ズレ対策：Uint8Array → BlobPart 明示で Blob 化
  const bodyBlob: Blob = new Blob([bytes as unknown as BlobPart], {
    type: 'application/octet-stream',
  });

  const hfURL = 'https://api-inference.huggingface.co/models/microsoft/resnet-50';

  async function callHF(tries = 0): Promise<any> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000); // 15s/try
    try {
      const r = await fetch(hfURL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${HF_TOKEN}`, 'x-wait-for-model': 'true' } as Record<string,string>,
        body: bodyBlob,
        signal: ctrl.signal,
      } as RequestInit);
      if ((r.status === 503 || r.status === 504) && tries < 3) {
        await new Promise(res => setTimeout(res, 800 * Math.pow(2, tries))); // 0.8s,1.6s,3.2s
        return callHF(tries + 1);
      }
      return r;
    } finally { clearTimeout(t); }
  }

  let r: any;
  try { r = await callHF(0); }
  catch { return runMock(imageUrl); }           // ネットワーク/タイムアウト → Mock

  if (!r.ok) return runMock(imageUrl);          // HFがHTTPエラー → Mock
  const out = await r.json();                   // [{label, score}, ...] 想定

  // 服5分類スコアへ粗いマッピング
  const scores: Record<string, number> = { カジュアル:0, スマート:0, フェミニン:0, モード:0, アウトドア:0 };
  if (Array.isArray(out)) {
    for (const it of out.slice(0, 8)) {
      const l = String(it.label ?? '').toLowerCase(); const s = Number(it.score ?? 0);
      if (l.includes('suit') || l.includes('tie') || l.includes('coat')) scores['スマート'] += s;
      else if (l.includes('dress') || l.includes('skirt') || l.includes('gown')) scores['フェミニン'] += s;
      else if (l.includes('t-shirt') || l.includes('jacket') || l.includes('jeans') || l.includes('sneaker')) scores['カジュアル'] += s;
      else if (l.includes('hood') || l.includes('leather') || l.includes('sunglass')) scores['モード'] += s;
      else if (l.includes('backpack') || l.includes('boots') || l.includes('hat')) scores['アウトドア'] += s;
      else scores['カジュアル'] += s * 0.2;
    }
  }

  const category = (Object.entries(scores).sort((a,b)=>b[1]-a[1])[0] ?? ['カジュアル'])[0];
  return { category, ai_labels: { mode: 'hf', raw: out, scores } };
}

// ---- Mock（再現性あり）----
function runMock(imageUrl: string) {
  const h = [...imageUrl].reduce((a,c)=>(a*33 + c.charCodeAt(0))>>>0, 5381);
  const idx = h % CATEGORIES.length;
  const category = CATEGORIES[idx];
  const base = 0.6;
  const scores: Record<string, number> =
    Object.fromEntries(CATEGORIES.map((c,i)=>[c, i===idx ? 0.8 : Math.max(0.02, (base - Math.abs(i-idx)*0.12))]));
  return { category, ai_labels: { mode: 'mock', hash: h, scores } };
}

// ---- HTTP Entrypoint ----
serve(async (req: any) => {
  if (req.method === 'OPTIONS') return json(null, 204);
  if (req.method !== 'POST')  return badRequest('POST only. Body: { image_url, mode }');

  let body: any;
  try { body = await req.json(); } catch { return badRequest('Invalid JSON body'); }

  const imageUrl = String(body?.image_url ?? '');
  const mode = String(body?.mode ?? 'hf') as Mode;

  if (!imageUrl) return badRequest('image_url is required');
  if (mode !== 'hf' && mode !== 'mock') return badRequest('mode must be "hf" or "mock"');

  try {
    if (mode === 'hf') return json(await runHF(imageUrl));
    return json(runMock(imageUrl));
  } catch (e) {
    const fallback = runMock(imageUrl);
    return json({ error: String(e), fallback }, 502);
  }
});
