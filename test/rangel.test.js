import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockMl, tmpDataDir } from './helpers.js';

// Configura ambiente ANTES de importar o servidor.
const mock = await startMockMl();
process.env.DATA_DIR = tmpDataDir();
process.env.ML_API_BASE = mock.base;
process.env.ML_AUTH_BASE = 'https://auth.exemplo.test';
process.env.ML_CLIENT_ID = 'APP123';
process.env.ML_CLIENT_SECRET = 'segredo-teste';
process.env.ML_REDIRECT_URI = 'http://localhost:3999/auth/mercadolivre/callback';
process.env.ML_PUBLIC_PAGE_FALLBACK = 'false';
process.env.EXTENSION_API_KEY = 'chave-ext';

const { parseMlUrl } = await import('../server/ml/url.js');
const { calcMargin } = await import('../shared/calc.js');
const { parseSoldText, extractFromHtml } = await import('../server/ml/publicPage.js');
const { createServer } = await import('../server/index.js');

let app, base;
before(async () => { app = createServer(); await new Promise((r) => app.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${app.address().port}`; });
after(() => { app.close(); mock.server.close(); });

const api = async (path, opts = {}) => {
  const res = await fetch(base + path, { redirect: 'manual', ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
};

test('parseMlUrl: formatos de link e bloqueio de hosts', () => {
  assert.equal(parseMlUrl('https://produto.mercadolivre.com.br/MLB-1111111111-fone-_JM').itemId, 'MLB1111111111');
  assert.equal(parseMlUrl('https://www.mercadolivre.com.br/fone/p/MLB12345678?wid=MLB1111111111').itemId, 'MLB1111111111');
  assert.equal(parseMlUrl('https://www.mercadolivre.com.br/p/MLB57492845?pdp_filters=item_id:MLB5764953630').itemId, 'MLB5764953630');
  assert.equal(parseMlUrl('https://www.mercadolivre.com.br/p/MLB57492845?matt_tool=123&pdp_filters=item_id:MLB5764953630&ua=x').itemId, 'MLB5764953630');
  assert.equal(parseMlUrl('https://www.mercadolivre.com.br/fone/p/MLB12345678').kind, 'catalog');
  assert.equal(parseMlUrl('https://meli.la/abc').kind, 'short');
  assert.equal(parseMlUrl('https://evil.com/MLB-1111111111').ok, false);
  assert.equal(parseMlUrl('https://mercadolivre.com.br.evil.com/MLB-1111111111').ok, false);
  assert.equal(parseMlUrl('isto não é link').ok, false);
});

test('calcMargin: lucro, margem, ROI; sem custo = indisponível', () => {
  const r = calcMargin({ price: 100, cost: 40, feeAmount: 16, shipping: 10, taxPct: 6 });
  assert.equal(r.profit, 28); assert.equal(r.marginPct, 28); assert.equal(r.roi, 70); assert.equal(r.breakEven, 64.1);
  const semCusto = calcMargin({ price: 100, feeAmount: 16 });
  assert.equal(semCusto.profit, null); assert.equal(semCusto.marginPct, null);
  assert.equal(calcMargin({}).ok, false);
});

test('página pública: vendas e JSON-LD', () => {
  assert.deepEqual(parseSoldText('<span>+500 vendidos</span>'), { quantity: 500, isMinimum: true });
  assert.deepEqual(parseSoldText('Novo | +5mil vendidos'), { quantity: 5000, isMinimum: true });
  const html = '<script type="application/ld+json">{"@type":"Product","name":"X","image":"https://i/x.jpg","offers":{"price":"59.9"},"aggregateRating":{"ratingValue":4.7,"reviewCount":321}}</script>';
  const d = extractFromHtml(html);
  assert.equal(d.price, 59.9); assert.equal(d.rating, 4.7); assert.equal(d.ratingCount, 321);
});

test('estáticos: index, app.js, shared/calc.js, sem path traversal', async () => {
  assert.equal((await api('/')).status, 200);
  assert.equal((await api('/app.js')).status, 200);
  assert.equal((await api('/shared/calc.js')).status, 200);
  const t = await api('/..%2f..%2fpackage.json');
  assert.ok(!String(typeof t.data === 'string' ? t.data : JSON.stringify(t.data)).includes('"engines"'), 'não pode servir arquivos fora de public/');
  const t2 = await api('/shared/..%2fpackage.json');
  assert.ok(!String(typeof t2.data === 'string' ? t2.data : JSON.stringify(t2.data)).includes('"engines"'));
  assert.equal((await api('/api/nao-existe')).status, 404);
});

test('assets: arquivo ausente é 404 (nunca HTML); páginas sem extensão caem no index; tipos corretos', async () => {
  const raw = async (u) => { const r = await fetch(base + u); return { s: r.status, ct: r.headers.get('content-type') || '', t: await r.text() }; };
  for (const [u, ct] of [['/', 'text/html'], ['/index.html', 'text/html'], ['/style.css', 'text/css'], ['/app.js', 'javascript'], ['/shared/calc.js', 'javascript']]) {
    const r = await raw(u); assert.equal(r.s, 200, u); assert.ok(r.ct.includes(ct), `${u} → ${r.ct}`);
  }
  for (const u of ['/nao-existe.css', '/nao-existe.js', '/analise/abc/style.css', '/img/logo.png']) {
    const r = await raw(u); assert.equal(r.s, 404, u); assert.ok(!r.t.includes('<!doctype'), `${u} não pode devolver HTML`);
  }
  assert.ok((await raw('/historico')).t.includes('<!doctype html>'));
  assert.ok((await raw('/analise/abc')).t.includes('/style.css'));
});

test('sem conexão: item público é consultado sem token e vendas/estoque/visitas ficam indisponíveis', async () => {
  mock.calls.length = 0;
  const r = await api('/api/products/analyze', { method: 'POST', body: { url: 'https://produto.mercadolivre.com.br/MLB-1111111111-fone-_JM' } });
  assert.equal(r.status, 201);
  const f = r.data.entry.analysis.fields;
  assert.equal(f.title.value, 'Fone Bluetooth Teste'); assert.equal(f.title.source, 'api');
  assert.equal(f.price.value, 89.9); assert.equal(f.originalPrice.value, 119.9);
  assert.equal(f.seller.value, 'LOJA_TESTE'); assert.match(f.reputation.value, /Verde/);
  assert.equal(f.category.value, 'Eletrônicos › Fones');
  assert.equal(f.saleFee.value, 17.5);
  assert.equal(f.sold.source, 'indisponivel'); assert.equal(f.revenue.source, 'indisponivel');
  assert.equal(f.stock.source, 'indisponivel'); assert.equal(f.visits.source, 'indisponivel');
  assert.equal(f.rating.source, 'indisponivel');
  assert.ok(mock.calls.every((c) => c.auth === null), 'nenhuma chamada deveria levar token');
  assert.ok(!mock.calls.some((c) => c.path.startsWith('/visits')), 'visitas exigem token: não deve chamar sem conexão');
});

test('erros claros: link inválido, host falso, API recusando', async () => {
  assert.equal((await api('/api/products/analyze', { method: 'POST', body: { url: 'abc' } })).status, 400);
  assert.equal((await api('/api/products/analyze', { method: 'POST', body: { url: 'https://evil.com/MLB-1111111111' } })).status, 400);
  const r = await api('/api/products/analyze', { method: 'POST', body: { url: 'https://produto.mercadolivre.com.br/MLB-2222222222-x' } });
  assert.equal(r.status, 502); assert.match(r.data.error, /Conecte sua conta/);
});

test('OAuth: redireciona com state, valida state e troca o código no backend', async () => {
  let r = await api('/auth/mercadolivre');
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.origin, 'https://auth.exemplo.test'); assert.equal(loc.searchParams.get('client_id'), 'APP123');
  assert.ok(!loc.href.includes('segredo-teste'), 'o secret nunca pode ir na URL de autorização');
  const state = loc.searchParams.get('state');
  r = await api('/auth/mercadolivre/callback?code=CODIGO_OK&state=errado');
  assert.match(r.headers.get('location'), /erro=state/);
  r = await api(`/auth/mercadolivre/callback?code=CODIGO_OK&state=${state}`);
  assert.match(r.headers.get('location'), /conectado=1/);
  const st = await api('/api/status');
  assert.equal(st.data.ml.connected, true); assert.equal(st.data.ml.userId, 555);
  assert.ok(!JSON.stringify(st.data).includes('TOKEN_1'), 'token não pode vazar para o frontend');
});

test('conectado: token vai no header, visitas reais, histórico + margem + dashboard', async () => {
  mock.calls.length = 0;
  const r = await api('/api/products/analyze', { method: 'POST', body: { url: 'https://produto.mercadolivre.com.br/MLB-1111111111-fone-_JM' } });
  const f = r.data.entry.analysis.fields;
  assert.equal(r.data.entry.analysis.mode, 'autenticado');
  assert.equal(f.visits.value, 4321); assert.equal(f.visits.source, 'api');
  assert.ok(mock.calls.some((c) => c.path.startsWith('/items/MLB1111111111') && c.auth === 'Bearer TOKEN_1'));
  assert.ok(mock.calls.every((c) => !c.path.includes('TOKEN')), 'token nunca na URL');

  const id = r.data.entry.id;
  const m = await api(`/api/history/${id}`, { method: 'PATCH', body: { assumptions: { cost: 30, shipping: 12, taxPct: 4 } } });
  assert.equal(m.status, 200);
  // 89.9 - 30 - 17.5 (tarifa API) - 12 - 3.596 = 26.804
  assert.equal(m.data.entry.margin.profit, 26.8); assert.equal(m.data.entry.margin.feeSource, 'api');
  assert.equal((await api(`/api/history/${id}`, { method: 'PATCH', body: { assumptions: { cost: -5 } } })).status, 400);

  const d = await api('/api/dashboard');
  assert.equal(d.data.metrics.analyzed, 1); assert.equal(d.data.metrics.totalAnalyses, 2);
  assert.equal(d.data.metrics.estimatedRevenue, null, 'sem vendas reais não existe faturamento');
  assert.equal(d.data.metrics.avgMarginPct, m.data.entry.margin.marginPct);
  assert.equal((await api('/api/history')).data.entries.length, 2);
  assert.equal((await api(`/api/history/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/api/history/${id}`)).status, 404);
});

test('pesquisa de mercado: vários links, falhas isoladas', async () => {
  const r = await api('/api/research', { method: 'POST', body: { urls: ['https://produto.mercadolivre.com.br/MLB-1111111111-a', 'https://evil.com/x', 'https://produto.mercadolivre.com.br/MLB-2222222222-b'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.results.map((x) => x.ok), [true, false, false]);
});

test('extensão Chrome: exige chave; CSRF bloqueado; webhook e pedidos', async () => {
  const url = 'https://produto.mercadolivre.com.br/MLB-1111111111-a';
  assert.equal((await api('/api/products/ingest', { method: 'POST', body: { url } })).status, 401);
  const ok = await api('/api/products/ingest', { method: 'POST', body: { url }, headers: { 'x-rangel-key': 'chave-ext' } });
  assert.equal(ok.status, 201); assert.match(ok.data.openUrl, /#\/analise\//);
  assert.equal((await api('/api/products/analyze', { method: 'POST', body: { url }, headers: { origin: 'https://evil.com' } })).status, 403);
  assert.equal((await api('/webhooks', { method: 'POST', body: { resource: '/orders/1', topic: 'orders_v2' } })).status, 200);
  assert.equal((await api('/api/orders')).status, 501);
});

test('refresh automático: token expirado é renovado e o novo refresh token é guardado', async () => {
  const { loadTokens, saveTokens } = await import('../server/ml/tokens.js');
  saveTokens({ ...loadTokens(), expires_at: Date.now() - 1000 });
  mock.calls.length = 0;
  await api('/api/items/MLB1111111111');
  assert.ok(mock.calls.some((c) => c.path === '/oauth/token'));
  assert.equal(loadTokens().refresh_token, 'REFRESH_2');
});

test('desconectar remove os tokens', async () => {
  assert.equal((await api('/auth/mercadolivre/disconnect', { method: 'POST' })).status, 200);
  assert.equal((await api('/api/status')).data.ml.connected, false);
});
