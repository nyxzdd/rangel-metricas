// Interpreta links do Mercado Livre e extrai o ID do anúncio. Também protege contra SSRF:
// só aceitamos hosts oficiais do Mercado Livre.
const HOST_OK = /(^|\.)(mercadolivre\.com(\.br)?|mercadolibre\.com(\.[a-z]{2})?|mercadolibre\.[a-z]{2}|meli\.la)$/i;
const ITEM_RE = /^(ML[A-Z])-?(\d{6,})$/i;

export function isAllowedHost(hostname) { return HOST_OK.test(hostname || ''); }

function itemIdFromValue(value) {
  if (!value) return null;
  const match = String(value).match(/\b(ML[A-Z])-?(\d{6,})\b/i);
  return match ? { site: match[1].toUpperCase(), itemId: match[1].toUpperCase() + match[2] } : null;
}

function itemIdFromQuery(u) {
  // Formatos usados pelo Mercado Livre incluem:
  // ?wid=MLB123..., ?item_id=MLB123... e
  // ?pdp_filters=item_id:MLB123... (comum em links compartilhados de catálogo).
  const direct = [u.searchParams.get('wid'), u.searchParams.get('item_id')];
  for (const value of direct) {
    const found = itemIdFromValue(value);
    if (found) return found;
  }

  const pdpFilters = u.searchParams.get('pdp_filters');
  const found = itemIdFromValue(pdpFilters);
  if (found) return found;

  // Fallback defensivo: procura um ID de anúncio em qualquer parâmetro da URL,
  // sem aceitar valores fora do formato MLB + número.
  for (const [, value] of u.searchParams) {
    const candidate = itemIdFromValue(value);
    if (candidate) return candidate;
  }
  return null;
}

export function parseMlUrl(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { return { ok: false, error: 'Link inválido. Cole a URL completa do anúncio (https://...).' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'O link precisa começar com http:// ou https://.' };
  if (!isAllowedHost(u.hostname)) return { ok: false, error: 'O link não é do Mercado Livre.' };
  if (/(^|\.)meli\.la$/i.test(u.hostname)) return { ok: true, kind: 'short', url: u.toString() };

  const queryItem = itemIdFromQuery(u);
  if (queryItem) return { ok: true, kind: 'item', ...queryItem, url: u.toString() };

  const catalog = u.pathname.match(/\/(?:p|up)\/(ML[A-Z]U?)(\d{5,})/i);
  if (catalog) return { ok: true, kind: 'catalog', site: catalog[1].toUpperCase().replace(/U$/, ''), catalogId: catalog[1].toUpperCase() + catalog[2], url: u.toString() };

  const item = u.pathname.match(/\/(ML[A-Z])-?(\d{6,})/i);
  if (item) return { ok: true, kind: 'item', site: item[1].toUpperCase(), itemId: item[1].toUpperCase() + item[2], url: u.toString() };

  return { ok: false, error: 'Não encontrei o código do anúncio (MLB...) neste link.' };
}

// Resolve links curtos (meli.la) seguindo redirecionamentos manualmente e validando cada salto.
export async function resolveShort(url, fetchImpl = fetch) {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const res = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 RangelMetricas' } });
    const loc = res.headers.get('location');
    if (!loc || res.status < 300 || res.status >= 400) return current;
    const next = new URL(loc, current);
    if (!isAllowedHost(next.hostname)) throw new Error('Redirecionamento para domínio não permitido.');
    current = next.toString();
    if (!/(^|\.)meli\.la$/i.test(next.hostname)) return current;
  }
  return current;
}
