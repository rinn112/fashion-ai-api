export const config = { runtime: 'edge' };
function H(extra={}){ return new Headers({ 'access-control-allow-origin':'*','content-type':'application/json', ...extra }); }
function J(body:any,status=200){ return new Response(JSON.stringify(body),{ status, headers:H() }); }
function U(base:string,rel:string){ try{ return new URL(rel,base).toString(); }catch{ return rel; } }
function M(html:string,n:string){ const re=new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]+content=["']([^"']+)["'][^>]*>`,'i'); const m=html.match(re); return m?m[1]:null; }
function L(html:string){ const s=[...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]; for(const x of s){ try{ const o=JSON.parse(x[1]); const a=Array.isArray(o)?o:[o]; for(const v of a){ const t=(v as any)?.['@type']; const ok=(typeof t==='string'&&t.toLowerCase()==='product')||(Array.isArray(t)&&t.includes('Product')); if(ok) return v; } }catch{} } return null; }
function IMG(html:string,base:string){ const metas=[M(html,'og:image'),M(html,'twitter:image'),M(html,'twitter:image:src')].filter(Boolean) as string[]; if(metas.length) return U(base,metas[0]!); const imgs=[...html.matchAll(/<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]); if(imgs.length){ const c=imgs.sort((a,b)=>b.length-a.length)[0]; return U(base,c); } return null; }
function mirror(url:string){ return 'https://r.jina.ai/http://'+url.replace(/^https?:\/\//,''); }
async function fetchHtml(url:string){ const ac=new AbortController(); const t=setTimeout(()=>ac.abort(),12000);
  try{ const r=await fetch(url,{ headers:{ 'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36','Accept':'text/html,application/xhtml+xml','Accept-Language':'ja,en;q=0.8' }, redirect:'follow', signal:ac.signal }); clearTimeout(t); return r; }catch(e:any){ clearTimeout(t); throw new Error(`fetch failed: ${String(e?.message||e)}`); } }
export default async function handler(req: Request){
  try{
    if(req.method==='OPTIONS') return new Response(null,{ status:204, headers:H({ 'access-control-allow-headers':'content-type', 'access-control-allow-methods':'POST,OPTIONS' }) });
    if(req.method!=='POST') return J({ ok:false, error:'Method Not Allowed' },405);
    let body:any={}; try{ body=await req.json(); }catch{}
    const url=body?.url as string|undefined;
    if(!url) return J({ ok:false, error:'missing url' },400);

    let r=await fetchHtml(url);
    if(!r.ok){ r=await fetch(mirror(url)); }
    let html=await r.text();
    if(!html || html.length<200){ const r2=await fetch(mirror(url)); if(r2.ok){ html=await r2.text(); } }

    if(!html || html.length<20) return J({ ok:false, error:'empty html' },502);

    const ld:any=L(html);
    let title=M(html,'og:title')||M(html,'twitter:title')||null;
    let price:string|null=null;
    let image=IMG(html,url);
    if(ld){
      if(!title) title=ld.name||ld.title||null;
      if(!image){ const im=(ld as any).image; if(typeof im==='string') image=U(url,im); else if(Array.isArray(im)&&im.length) image=U(url,im[0]); }
      const offers=Array.isArray((ld as any).offers)?(ld as any).offers[0]:(ld as any).offers;
      if(offers?.price) price=String(offers.price);
      if(!price && offers?.priceSpecification?.price) price=String(offers.priceSpecification.price);
    }
    if(!title){ const m=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); title=m?m[1].trim():'商品'; }
    return J({ ok:true, product:{ url, title, image, price, source:'auto', fetched_at:new Date().toISOString() } });
  }catch(e:any){
    return J({ ok:false, error:String(e?.message||e) },200);
  }
}
