/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// deno-lint-ignore-file no-explicit-any

// VSCodeがNode前提だとURL importに赤線が出るため抑止（Denoでは有効）
/* @ts-ignore */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type Mode = 'openai' | 'hf' | 'mock';
const CATEGORIES = ['カジュアル','スマート','フェミニン','モード','アウトドア'] as const;

// Deno型に依存せず、エディタ赤線を避けて環境変数を取得
const OPENAI_API_KEY: string = (globalThis as any)?.Deno?.env?.get?.('OPENAI_API_KEY') ?? '';
const HF_TOKEN: string       = (globalThis as any)?.Deno?.env?.get?.('HF_TOKEN') ?? '';

// ---------------- 共通ヘルパ ----------------
function corsify(json: unknown, status = 200) {
  return new Response(JSON.stringify(json), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}
const badRequest = (msg: string, detail?: unknown) =>
  corsify({ error: msg, detail }, 400);

// 画像を bytes で取得（Buffer 不使用）
async function fetchImageBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`image fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ---------------- Backend 呼び分け ----------------
async function runHF(imageUrl: string) {
  if (!HF_TOKEN) throw new Error('HF_TOKEN not set');
  const MODEL = 'microsoft/resnet-50';
  const hfURL = `https://api-inference.huggingface.co/models/${MODEL}`;

    const u8 = await fetchImageBytes(imageUrl); // Uint8Array
    // Uint8Array → ArrayBuffer（型的に最も無難）
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

    const r = await fetch(hfURL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${HF_TOKEN}` },
    body: ab as any, // DOMの BodyInit として素直に通る
    });
  if (r.status === 503) { // コールドスタート
    await new Promise(res => setTimeout(res, 1500));
    return await runHF(imageUrl);
  }
  if (!r.ok) throw new Error(`HF inference failed: ${r.status} ${r.statusText}`);

  const out = await r.json(); // [{label, score}, ...]
  const scores: Record<string, number> = {
    カジュアル: 0, スマート: 0, フェミニン: 0, モード: 0, アウトドア: 0
  };
  if (Array.isArray(out)) {
    for (const it of out.slice(0, 8)) {
      const l = String(it.label ?? '').toLowerCase();
      const s = Number(it.score ?? 0);
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

async function runOpenAI(imageUrl: string) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  const payload = {
    model: "gpt-4o-mini",
    messages: [{
      role: "user",
      content: [
        { type: "text", text:
`次の写真の服装を5分類で判定して。必ずJSONのみで返す:
{ "category": "カジュアル|スマート|フェミニン|モード|アウトドア",
  "scores": { "カジュアル":0-1,"スマート":0-1,"フェミニン":0-1,"モード":0-1,"アウトドア":0-1 },
  "notes": "補助的な説明(任意)" }`
        },
        { type: "image_url", image_url: { url: imageUrl } }
      ]
    }],
    temperature: 0
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`OpenAI failed: ${r.status} ${r.statusText}`);

  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content ?? '{}';
  let parsed: any;
  try { parsed = JSON.parse(text); }
  catch {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  }

  const category = (parsed?.category && (CATEGORIES as readonly string[]).includes(parsed.category))
    ? parsed.category : 'カジュアル';
  const scores = parsed?.scores ?? {};
  return { category, ai_labels: { mode: 'openai', raw: parsed, scores } };
}

function runMock(imageUrl: string) {
  const h = [...imageUrl].reduce((a,c)=>(a*33 + c.charCodeAt(0))>>>0, 5381);
  const idx = h % CATEGORIES.length;
  const category = CATEGORIES[idx];
  const base = 0.6;
  const scores: Record<string, number> =
    Object.fromEntries(CATEGORIES.map((c,i)=>[c, i===idx ? 0.8 : Math.max(0.02, (base - Math.abs(i-idx)*0.12))]));
  return { category, ai_labels: { mode: 'mock', hash: h, scores } };
}

// ---------------- HTTP Entrypoint ----------------
serve(async (req: any) => {
  if (req.method === 'OPTIONS') return corsify(null, 204);
  if (req.method !== 'POST')  return badRequest('POST only. Body: { image_url, mode? }');

  let bodyJson: any;
  try { bodyJson = await req.json(); } catch { return badRequest('Invalid JSON body'); }

  const imageUrl = String(bodyJson?.image_url ?? '');
  const mode = String(bodyJson?.mode ?? 'openai') as Mode;

  if (!imageUrl) return badRequest('image_url is required');
  if (!['openai','hf','mock'].includes(mode)) return badRequest('mode must be openai|hf|mock');

  try {
    if (mode === 'hf')    return corsify(await runHF(imageUrl));
    if (mode === 'openai')return corsify(await runOpenAI(imageUrl));
    return corsify(runMock(imageUrl));
  } catch (e) {
    const fallback = runMock(imageUrl);
    return corsify({ error: String(e), fallback }, 502);
  }
});
