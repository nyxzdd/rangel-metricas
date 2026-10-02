import { isAllowedHost } from './url.js';

// Complemento opcional: lê dados da página pública do anúncio (JSON-LD / og tags).
// É "melhor esforço": o Mercado Livre pode bloquear ou mudar o HTML — nesse caso tudo vira "indisponível".
// Pode ser desligado com ML_PUBLIC_PAGE_FALLBACK=false.
function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) { try { out.push(JSON.parse(m[1])); } catch { /* ignora bloco inválido */ } }
  return out.flatMap((b) => (Array.isArray(b) ? b : b['@graph'] ? b['@graph'] : [b]));
}
const toNum = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const meta = (html, prop) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i')); return m ? m[1] : null; };

// "+500 vendidos", "+5mil vendidos", "1200 vendidos"
export function parseSoldText(html) {
  const m = html.replace(/&nbsp;/g, ' ').match(/(\+)?\s*(\d[\d.]*)\s*(mil|mi)?\s*vendidos?/i);
  if (!m) return null;
  let n = Number(m[2].replace(/\./g, ''));
  if (!Number.isFinite(n)) return null;
  if (/^mil$/i.test(m[3] || '')) n *= 1000;
  if (/^mi$/i.test(m[3] || '')) n *= 1_000_000;
  return { quantity: n, isMinimum: Boolean(m[1]) };
}

export function extractFromHtml(html) {
  const product = jsonLdBlocks(html).find((b) => String(b['@type']).includes('Product')) || {};
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers || {};
  const agg = product.aggregateRating || {};
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  return {
    title: product.name || meta(html, 'og:title'),
    image: image || meta(html, 'og:image'),
    price: toNum(offer?.price ?? offer?.lowPrice),
    rating: toNum(agg.ratingValue),
    ratingCount: toNum(agg.reviewCount ?? agg.ratingCount),
    sold: parseSoldText(html),
  };
}

export async function fetchPublicPage(url, fetchImpl = fetch) {
  try {
    const u = new URL(url);
    if (!isAllowedHost(u.hostname)) return { ok: false, error: 'Domínio não permitido.' };
    const res = await fetchImpl(u, { redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; RangelMetricas/2.0)', 'accept-language': 'pt-BR,pt;q=0.9' } });
    if (!res.ok) return { ok: false, error: `Página pública respondeu ${res.status}.` };
    if (!isAllowedHost(new URL(res.url).hostname)) return { ok: false, error: 'Redirecionamento bloqueado.' };
    return { ok: true, data: extractFromHtml(await res.text()) };
  } catch (e) { return { ok: false, error: `Página pública indisponível: ${e.message}` }; }
}
