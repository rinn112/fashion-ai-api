export const config = { runtime: 'edge' };

function H(extra: Record<string,string>={}){ return new Headers({ 'access-control-allow-origin':'*','content-type':'application/json', ...extra }); }
function J(body:any,status=200){ return new Response(JSON.stringify(body),{ status, headers:H() }); }
function U(base:string,rel:string){ try{ return new URL(rel,base).toString(); }catch{ return rel; } }

function pickMeta(html:string,name:string){
  const a=new RegExp(`<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']+)["'][^>]*>`,'i');
  const b=new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*?(?:property|name|itemprop)\\s*=\\s*["']${name}["'][^>]*>`,'i');
  let m=html.match(a); if(m) return m[1]; m=html.match(b); if(m) return m[1]; return null;
}
function first(html:string,re:RegExp){ const m=re.exec(html); return m?m[1]:null; }
function parseSrcset(ss:string){ const f=ss.split(',')[0]?.trim(); return f?.split(/\s+/)[0]||null; }
function flattenLD(x:any,out:any[]=[]){ if(!x) return out; if(Array.isArray(x)){ for(const v of x) flattenLD(v,out); return out; } if(typeof x==='object'){ out.push(x); if(Array.isArray(x['@graph'])) for (const v of x['@graph']) flattenLD(v,out); } return out; }
function deepImageFromJson(x:any):string|null{
  const urls:string[]=[]; const push=(u:any)=>{ if(typeof u==='string' && /^https?:\/\/.+\.(jpg|jpeg|png|webp|avif)(\?.*)?$/i.test(u)) urls.push(u); };
  const walk=(v:any)=>{ if(!v) return; if(Array.isArray(v)){ for(const t of v) walk(t); return; }
    if(typeof v==='object'){ for(const k of Object.keys(v)){ const val=(v as any)[k];
      if(/image|img/i.test(k)){ if(typeof val==='string') push(val); if(Array.isArray(val)) for(const t of val) push(t); if(val&&typeof val==='object'&&val.url) push(val.url); }
      walk(val);
    } return; }
    if(typeof v==='string') push(v);
  };
  walk(x); return urls[0]||null;
}
function sniffImageFromHtml(html:string){ const m=html.match(/https?:\/\/[^"'\\s>]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'\\s>]*)?/gi); return m?.[0]||null; }

function parseProduct(html:string, base:string){
  let title = pickMeta(html,'og:title') || pickMeta(html,'twitter:title') || pickMeta(html,'twitter:text:title') || null;
  let price:string|null = null;

  const scripts=[...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for(const s of scripts){
    try{
      const items=flattenLD(JSON.parse(s[1]));
      for(const x of items){
        const t=(x as any)?.['@type'];
        const isP=(typeof t==='string'&&t.toLowerCase()==='product')||(Array.isArray(t)&&t.map((v:any)=>String(v).toLowerCase()).includes('product'));
        if(isP){
          if(!title) title=(x as any).name || (x as any).title || null;
          const offers = Array.isArray((x as any).offers)?(x as any).offers[0]:(x as any).offers;
          if(offers?.price) price=String(offers.price);
          if(!price && offers?.priceSpecification?.price) price=String(offers.priceSpecification.price);
        }
      }
    }catch{}
  }

  const cand:string[]=[]; const push=(u?:string|null)=>{ if(u) cand.push(U(base,u)); };
  push(pickMeta(html,'og:image')); push(pickMeta(html,'og:image:url')); push(pickMeta(html,'og:image:secure_url'));
  push(pickMeta(html,'twitter:image')); push(pickMeta(html,'twitter:image:src'));
  push(first(html,/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i));
  push(first(html,/<link[^>]+rel=["']preload["'][^>]+as=["']image["'][^>]+href=["']([^"']+)["']/i));
  const srcset = first(html,/<source[^>]+srcset=["']([^"']+)["']/i) || first(html,/<img[^>]+srcset=["']([^"']+)["']/i);
  push(srcset ? parseSrcset(srcset) : null);
  const imgAttrs=[...html.matchAll(/<img[^>]+(?:src|data-src|data-original|data-lazy|data-zoom-image)=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
  if(imgAttrs.length) imgAttrs.sort((a,b)=>b.length-a.length).slice(0,6).forEach(u=>push(u));
  let image = cand.find(u=>/\.(?:jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(u)) || cand[0] || null;

  if(!image){
    const nextData=[...html.matchAll(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for(const s of nextData){ try{ const obj=JSON.parse(s[1]); const hit=deepImageFromJson(obj); if(hit){ image=U(base,hit); break; } }catch{} }
  }
  if(!image){
    const any=sniffImageFromHtml(html);
    if(any) image=U(base,any);
  }
  if(!title){
    const m=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = m?m[1].trim():'商品';
  }
  return { title, image, price };
}

function mirror(url:string){ return 'https://r.jina.ai/http://'+url.replace(/^https?:\/\//,''); }
function shot(url:string){ return 'https://image.thum.io/get/width/1200/noanimate/'+encodeURIComponent(url); }

async function get(url:string, ms=22000){
  const ac=new AbortController(); const t=setTimeout(()=>ac.abort(), ms);
  try{
    const r=await fetch(url,{ headers:{
      'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36',
      'Accept':'text/html,application/xhtml+xml',
      'Accept-Language':'ja,en;q=0.8',
      'Upgrade-Insecure-Requests':'1',
      'Cache-Control':'no-cache'
    }, redirect:'follow', signal:ac.signal });
    clearTimeout(t); return r;
  }catch(e:any){ clearTimeout(t); throw new Error(`fetch failed: ${String(e?.message||e)}`); }
}

export default async function handler(req: Request){
  try{
    if(req.method==='OPTIONS') return new Response(null,{ status:204, headers:H({ 'access-control-allow-headers':'content-type', 'access-control-allow-methods':'POST,OPTIONS' }) });
    if(req.method!=='POST') return J({ ok:false, error:'Method Not Allowed' },405);
    let body:any={}; try{ body=await req.json(); }catch{}
    const url=body?.url as string|undefined;
    if(!url) return J({ ok:false, error:'missing url' },400);

    let r=await get(url,22000);
    let html=r.ok ? await r.text() : '';
    if(!r.ok || !html || html.length<400){
      const rm=await fetch(mirror(url));
      if(rm.ok) html=await rm.text();
    }
    if(!html || html.length<50){
      return J({ ok:true, product:{ url, title:'商品', image: shot(url), price:null, source:'screenshot', fetched_at:new Date().toISOString() } });
    }

    const p=parseProduct(html,url);
    const image = p.image || shot(url);
    return J({ ok:true, product:{ url, title:p.title, image, price:p.price, source: p.image ? 'auto' : 'screenshot', fetched_at:new Date().toISOString() } });
  }catch(e:any){
    return J({ ok:true, product:{ url: (typeof e==='object' && e && 'url' in (e as any)) ? (e as any).url : '', title:'商品', image: shot(String((e as any)?.url ?? '')), price:null, source:'screenshot', fetched_at:new Date().toISOString(), error:String(e?.message||e) } },200);
  }
}
