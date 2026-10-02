import crypto from 'node:crypto';
import { config } from '../config.js';
import { mlGet } from './client.js';
import { parseMlUrl, resolveShort } from './url.js';
import { fetchPublicPage } from './publicPage.js';

// Cada campo da análise tem { value, source, note }.
// source: 'api' (API oficial) | 'pagina' (página pública) | 'estimativa' (calculado) | 'indisponivel'
const F = (value, source, note) => (value === null || value === undefined || Number.isNaN(value)
  ? { value: null, source: 'indisponivel', ...(note ? { note } : {}) }
  : { value, source, ...(note ? { note } : {}) });

const LISTING_TYPES = { gold_pro: 'Premium', gold_special: 'Clássico', gold: 'Ouro', silver: 'Prata', bronze: 'Bronze', free: 'Grátis' };
const LEVELS = { green: 'Verde', light_green: 'Verde claro', yellow: 'Amarelo', orange: 'Laranja', red: 'Vermelho' };
const POWER = { silver: 'MercadoLíder', gold: 'MercadoLíder Gold', platinum: 'MercadoLíder Platinum' };

function describeReputation(user) {
  const r = user?.seller_reputation;
  if (!r) return null;
  const level = r.level_id ? (LEVELS[String(r.level_id).replace(/^\d+_/, '')] || r.level_id) : null;
  const parts = [];
  if (level) parts.push(`Nível ${level}`);
  if (r.power_seller_status) parts.push(POWER[r.power_seller_status] || r.power_seller_status);
  if (r.transactions?.completed != null) parts.push(`${r.transactions.completed} vendas concluídas`);
  return parts.length ? parts.join(' · ') : null;
}

function pickSaleFee(data) {
  const row = Array.isArray(data) ? data[0] : data;
  const v = row?.sale_fee_amount;
  return typeof v === 'number' ? v : null;
}

function pickVisits(data, itemId) {
  if (typeof data === 'number') return data;
  if (Array.isArray(data)) { const r = data.find((x) => x.item_id === itemId) || data[0]; return r?.total_visits ?? r?.visits ?? null; }
  if (data && typeof data === 'object') { const v = data[itemId] ?? data.total_visits; return typeof v === 'number' ? v : null; }
  return null;
}

export async function analyzeUrl(inputUrl, { fetchImpl = fetch } = {}) {
  let parsed = parseMlUrl(inputUrl);
  if (!parsed.ok) throw Object.assign(new Error(parsed.error), { status: 400 });
  if (parsed.kind === 'short') {
    try { parsed = parseMlUrl(await resolveShort(parsed.url, fetchImpl)); } catch (e) { throw Object.assign(new Error(`Não consegui abrir o link curto: ${e.message}`), { status: 400 }); }
    if (!parsed.ok) throw Object.assign(new Error(parsed.error), { status: 400 });
  }

  const warnings = [];
  const site = parsed.site || 'MLB';
  const itemId = parsed.itemId || null;
  const pageUrl = parsed.url;

  const [itemRes, pageRes] = await Promise.all([
    itemId ? mlGet(`/items/${itemId}`) : Promise.resolve(null),
    config.publicPageFallback ? fetchPublicPage(pageUrl, fetchImpl) : Promise.resolve(null),
  ]);

  const item = itemRes?.ok ? itemRes.data : null;
  const page = pageRes?.ok ? pageRes.data : null;
  const authenticated = Boolean(itemRes?.authenticated);

  if (parsed.kind === 'catalog' && !itemId) warnings.push('Este é um link de catálogo (página de produto), não de um anúncio específico. A API exige o código do anúncio (MLB...). Dados vêm da página pública; para análise completa, abra um anúncio de vendedor e copie o link.');
  if (itemRes && !itemRes.ok) warnings.push(itemRes.needsAuth ? 'A API do Mercado Livre recusou a consulta sem autorização. Conecte sua conta em Configurações para liberar mais dados.' : `API de itens: ${itemRes.error}`);
  if (pageRes && !pageRes.ok) warnings.push(pageRes.error);
  if (!item && !page) throw Object.assign(new Error(warnings.join(' ') || 'Não consegui obter dados deste anúncio.'), { status: 502, warnings });

  const price = item?.price ?? page?.price ?? null;
  const priceSource = item?.price != null ? 'api' : 'pagina';

  // Vendas: só a API (com token do dono) traz o valor exato; senão, faixa mínima da página pública.
  let sold = F(null, 'indisponivel', 'A API só informa vendas ao dono do anúncio. Conecte a conta dele ou use a faixa da página pública.');
  if (typeof item?.sold_quantity === 'number') sold = F(item.sold_quantity, 'api');
  else if (page?.sold) sold = F(page.sold.quantity, 'pagina', page.sold.isMinimum ? 'Faixa mínima divulgada na página (ex.: "+500 vendidos"), não é o número exato.' : undefined);

  const revenue = (sold.value != null && price != null)
    ? F(Math.round(sold.value * price * 100) / 100, 'estimativa', 'Vendas acumuladas × preço atual. Não é faturamento de um período e ignora variações de preço.')
    : F(null, 'indisponivel', 'Depende de vendas e preço.');

  const [userRes, catRes, feeRes, visitsRes] = await Promise.all([
    item?.seller_id ? mlGet(`/users/${item.seller_id}`) : null,
    item?.category_id ? mlGet(`/categories/${item.category_id}`) : null,
    item && price != null ? mlGet(`/sites/${site}/listing_prices?price=${price}${item.category_id ? `&category_id=${item.category_id}` : ''}${item.listing_type_id ? `&listing_type_id=${item.listing_type_id}` : ''}`) : null,
    itemId ? mlGet(`/visits/items?ids=${itemId}`, { auth: 'required' }) : null,
  ]);

  const user = userRes?.ok ? userRes.data : null;
  const categoryPath = catRes?.ok ? (catRes.data.path_from_root || []).map((c) => c.name).join(' › ') || catRes.data.name : null;
  const saleFee = feeRes?.ok ? pickSaleFee(feeRes.data) : null;
  const visits = visitsRes?.ok ? pickVisits(visitsRes.data, itemId) : null;

  const lt = item?.listing_type_id;
  const analysis = {
    id: 'a_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
    analyzedAt: new Date().toISOString(),
    url: inputUrl,
    permalink: item?.permalink || pageUrl,
    itemId, site, kind: parsed.kind,
    mode: authenticated ? 'autenticado' : 'publico',
    fields: {
      title: F(item?.title ?? page?.title ?? null, item?.title ? 'api' : 'pagina'),
      image: F((item?.secure_thumbnail || item?.pictures?.[0]?.secure_url || item?.thumbnail || '').replace(/^http:/, 'https:') || page?.image || null, item ? 'api' : 'pagina'),
      price: F(price, priceSource),
      originalPrice: F(item?.original_price ?? null, 'api', 'Só aparece quando o anúncio está em promoção.'),
      sold, revenue,
      visits: F(visits, 'api', visitsRes && !visitsRes.ok ? (visitsRes.needsAuth ? 'Exige conta conectada com permissão sobre o anúncio.' : visitsRes.error) : undefined),
      rating: F(page?.rating ?? null, 'pagina', 'A API de itens não traz a nota; vem da página pública.'),
      ratingCount: F(page?.ratingCount ?? null, 'pagina'),
      seller: F(user?.nickname ?? null, 'api'),
      reputation: F(describeReputation(user), 'api'),
      listingType: F(lt ? `${LISTING_TYPES[lt] || lt}` : null, 'api', lt ? `Código: ${lt}` : undefined),
      category: F(categoryPath, 'api'),
      stock: F(typeof item?.available_quantity === 'number' ? item.available_quantity : null, 'api', 'A API só informa estoque ao dono do anúncio.'),
      condition: F(item?.condition ?? null, 'api'),
      freeShipping: F(typeof item?.shipping?.free_shipping === 'boolean' ? item.shipping.free_shipping : null, 'api'),
      saleFee: F(saleFee, 'api', 'Tarifa de venda calculada pela API (listing_prices) para este preço, categoria e tipo de anúncio.'),
    },
    competitors: { available: false, note: 'A busca por concorrentes pela API exige permissões que ainda não confirmamos. Use "Pesquisa de mercado" colando os links dos concorrentes.' },
    warnings,
  };
  return analysis;
}
