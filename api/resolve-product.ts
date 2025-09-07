export const config = { runtime: 'edge' };

function H(extra: Record<string,string>={}){ return new Headers({ 'access-control-allow-origin':'*','content-type':'application/json', ...extra }); }
function J(body:any,status=200){ return new Response(JSON.stringify(body),{ status, headers:H() }); }
function U(base:string,rel:string){ try{ return new URL(rel,base).toString(); }catch{ return rel; } }
function pick(html:string, name:string){ const re=new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,'i'); const m=html.match(re); return m?m[1]:null; }
function firstMatch(html:string, re:RegExp){ const m=re.exec(html); return m?m[1]:null; }
function parseSrcset(ss:string){ const first = ss.split(',')[0]?.trim(); return first?.split(/\s+/)[0] || null; }

function parseProduct(html:string, base:string){
  let title = pick(html,'og:title') || pick(html,'twitter:title') || null;
  let price:string|null = null;

  const scripts=[...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for(const s of scripts){
    try{
      const obj=JSON.parse(s[1]); const arr=Array.isArray(obj)?obj:[obj];
      for(const x of arr){
        const t=(x as any)?.['@type'];
        const isP=(typeof t==='string'&&t.toLowerCase()==='product')||(Array.isArray(t)&&t.includes('Product'));
        if(isP){
          if(!title) title=(x as any).name || (x as any).title || null;
          const offers = Array.isArray((x as any).offers)?(x as any).offers[0]:(x as any).offers;
          if(offers?.price) price=String(offers.price);
          if(!price && offers?.priceSpecification?.price) price=String(offers.priceSpecification.price);
        }
      }
    }catch{}
  }

  const candidates:string[] = [];
  const push=(u?:string|null)=>{ if(u) candidates.push(U(base,u)); };

  push(pick(html,'og:image'));
  push(pick(html,'og:image:secure_url'));
  push(pick(html,'twitter:image'));
  push(pick(html,'twitter:image:src'));
  push(firstMatch(html,/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i));
  push(firstMatch(html,/<link[^>]+rel=["']preload["'][^>]+as=["']image["'][^>]+href=["']([^"']+)["']/i));
  const srcset = firstMatch(html,/<source[^>]+srcset=["']([^"']+)["']/i) || firstMatch(html,/<img[^>]+srcset=["']([^"']+)["']/i);
  push(srcset ? parseSrcset(srcset) : null);
  const imgAttrs = [...html.matchAll(/<img[^>]+(?:src|data-src|data-original|data-lazy|data-zoom-image)=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
  if(imgAttrs.length) imgAttrs.sort((a,b)=>b.length-a.length).slice(0,3).forEach(u=>push(u));
  const image = candidates.find(u=>/\.(?:jpg|jpeg|png|webp|avif)(?:\?|#|$)/i.test(u)) || candidates[0] || null;

  if(!title){
    const m=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = m?m[1].trim():'商品';
  }
  return { title, image, price };
}

function mirror(url:string){ return 'https://r.jina.ai/http://'+url.replace(/^https?:\/\//,''); }

async function get(url:string){
  const ac=new AbortController(); const t=setTimeout(()=>ac.abort(), 18000);
  try{
    const r=await fetch(url,{
      headers:{
        'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36',
        'Accept':'text/html,application/xhtml+xml',
        'Accept-Language':'ja,en;q=0.8'
      },
      redirect:'follow',
      signal:ac.signal
    });
    clearTimeout(t);
    return r;
  }catch(e:any){
    clearTimeout(t);
    throw new Error(`fetch failed: ${String(e?.message||e)}`);
  }
}

export default async function handler(req: Request){
  try{
    if(req.method==='OPTIONS') return new Response(null,{ status:204, headers:H({ 'access-control-allow-headers':'content-type', 'access-control-allow-methods':'POST,OPTIONS' }) });
    if(req.method!=='POST') return J({ ok:false, error:'Method Not Allowed' },405);
    let body:any={}; try{ body=await req.json(); }catch{}
    const url=body?.url as string|undefined;
    if(!url) return J({ ok:false, error:'missing url' },400);

    let r = await get(url);
    let html = r.ok ? await r.text() : '';
    if(!r.ok || !html || html.length<400){
      const rm = await fetch(mirror(url));
      if(rm.ok){ html = await rm.text(); }
    }
    if(!html || html.length<50) return J({ ok:false, error:'empty html' },502);

    let p = parseProduct(html, url);
    if(!p.image){
      const rm2 = await fetch(mirror(url));
      if(rm2.ok){
        const html2 = await rm2.text();
        const p2 = parseProduct(html2, url);
        if(p2.image) p.image = p2.image;
        if(!p.title && p2.title) p.title = p2.title;
        if(!p.price && p2.price) p.price = p2.price;
      }
    }

    return J({ ok:true, product:{ url, title:p.title, image:p.image, price:p.price, source:'auto', fetched_at:new Date().toISOString() } });
  }catch(e:any){
    return J({ ok:false, error:String(e?.message||e) },200);
  }
}
