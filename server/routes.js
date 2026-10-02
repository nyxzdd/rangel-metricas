import crypto from 'node:crypto';
import { createRouter, sendJson, HttpError } from './lib/http.js';
import { appendLine } from './lib/jsonStore.js';
import { config } from './config.js';
import { credentialsConfigured, buildAuthUrl, exchangeCode, connectionInfo, mlGet } from './ml/client.js';
import { clearTokens } from './ml/tokens.js';
import { analyzeUrl } from './ml/analyze.js';
import * as history from './history.js';

export const router = createRouter();
const oauthStates = new Map(); // state -> timestamp (válido por 10 min)

const requireUrl = (body) => {
  if (!body?.url || typeof body.url !== 'string') throw new HttpError(400, 'Envie o link do anúncio no campo "url".');
  return body.url.trim();
};

async function analyzeAndSave(url) {
  const analysis = await analyzeUrl(url);
  return history.add(analysis);
}

// ---------- Saúde / status ----------
router.get('/api/health', ({ res }) => sendJson(res, 200, { ok: true, service: 'Rangel Métricas', time: new Date().toISOString() }));

router.get('/api/status', ({ res }) => sendJson(res, 200, {
  ml: { credentialsConfigured: credentialsConfigured(), ...connectionInfo(), redirectUri: config.mlRedirectUri },
  publicPageFallback: config.publicPageFallback,
  extensionEnabled: Boolean(config.extensionKey),
}));

// ---------- OAuth Mercado Livre ----------
router.get('/auth/mercadolivre', ({ res }) => {
  if (!credentialsConfigured()) { res.writeHead(302, { location: '/#/configuracoes?erro=credenciais' }); return res.end(); }
  for (const [s, t] of oauthStates) if (Date.now() - t > 600_000) oauthStates.delete(s);
  const state = crypto.randomBytes(18).toString('hex');
  oauthStates.set(state, Date.now());
  res.writeHead(302, { location: buildAuthUrl(state) });
  res.end();
});

router.get('/auth/mercadolivre/callback', async ({ res, query }) => {
  const redirect = (hash) => { res.writeHead(302, { location: `/#/configuracoes?${hash}` }); res.end(); };
  if (query.error) return redirect('erro=negado');
  if (!query.code || !query.state || !oauthStates.has(query.state)) return redirect('erro=state');
  oauthStates.delete(query.state);
  try { await exchangeCode(query.code); redirect('conectado=1'); }
  catch (e) { console.error('[oauth] falha na troca de código:', e.message); redirect('erro=token'); }
});

router.post('/auth/mercadolivre/disconnect', ({ res }) => { clearTokens(); sendJson(res, 200, { ok: true }); });

// ---------- Produtos ----------
router.post('/api/products/analyze', async ({ res, body }) => {
  const entry = await analyzeAndSave(requireUrl(body));
  sendJson(res, 201, { entry });
});

// Entrada para a futura extensão Chrome: ela envia a URL da aba atual. Exige o header x-rangel-key.
router.post('/api/products/ingest', async ({ req, res, body }) => {
  if (!config.extensionKey) throw new HttpError(404, 'Ingestão por extensão desativada. Defina EXTENSION_API_KEY no .env.');
  const key = String(req.headers['x-rangel-key'] || '');
  const a = Buffer.from(key), b = Buffer.from(config.extensionKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Chave da extensão inválida.');
  const entry = await analyzeAndSave(requireUrl(body));
  sendJson(res, 201, { id: entry.id, openUrl: `${config.appUrl}/#/analise/${entry.id}` });
});

router.get('/api/products', ({ res }) => {
  const seen = new Set(); const products = [];
  for (const e of history.list()) { const k = e.analysis.itemId || e.analysis.permalink; if (seen.has(k)) continue; seen.add(k); products.push(history.summarize(e)); }
  sendJson(res, 200, { products });
});

// ---------- Itens (consulta ao vivo, sem salvar) ----------
router.get('/api/items/:id', async ({ res, params }) => {
  if (!/^ML[A-Z]\d{6,}$/i.test(params.id)) throw new HttpError(400, 'ID de anúncio inválido.');
  const r = await mlGet(`/items/${params.id.toUpperCase()}`);
  if (!r.ok) throw new HttpError(r.status || 502, r.error, { needsAuth: Boolean(r.needsAuth) });
  sendJson(res, 200, { item: r.data, authenticated: r.authenticated });
});

// ---------- Visitas (exigem conta conectada) ----------
router.get('/api/visits/:id', async ({ res, params, query }) => {
  if (!/^ML[A-Z]\d{6,}$/i.test(params.id)) throw new HttpError(400, 'ID de anúncio inválido.');
  const last = Math.min(Math.max(parseInt(query.last, 10) || 30, 1), 150);
  const r = await mlGet(`/items/${params.id.toUpperCase()}/visits/time_window?last=${last}&unit=day`, { auth: 'required' });
  if (!r.ok) throw new HttpError(r.status || 502, r.error, { needsAuth: Boolean(r.needsAuth) });
  sendJson(res, 200, { visits: r.data });
});

// ---------- Pedidos ----------
router.get('/api/orders', ({ res }) => sendJson(res, 501, {
  available: false,
  message: 'Pedidos ainda não implementados: o endpoint e as permissões precisam ser confirmados na documentação oficial antes de usar.',
}));

// ---------- Dashboard (somente dados reais do histórico) ----------
router.get('/api/dashboard', ({ res }) => {
  const seen = new Set(); const latest = [];
  for (const e of history.list()) { const k = e.analysis.itemId || e.analysis.permalink; if (!seen.has(k)) { seen.add(k); latest.push(history.summarize(e)); } }
  const withRevenue = latest.filter((p) => p.revenue != null);
  const withMargin = latest.filter((p) => p.margin?.marginPct != null);
  sendJson(res, 200, {
    connection: connectionInfo(),
    metrics: {
      analyzed: latest.length,
      totalAnalyses: history.list().length,
      estimatedRevenue: withRevenue.length ? withRevenue.reduce((s, p) => s + p.revenue, 0) : null,
      revenueCoverage: `${withRevenue.length} de ${latest.length}`,
      avgMarginPct: withMargin.length ? Math.round(withMargin.reduce((s, p) => s + p.margin.marginPct, 0) / withMargin.length * 100) / 100 : null,
      marginCoverage: `${withMargin.length} de ${latest.length}`,
    },
    recent: latest.slice(0, 6),
  });
});

// ---------- Histórico ----------
router.get('/api/history', ({ res }) => sendJson(res, 200, { entries: history.list().map(history.summarize) }));
router.get('/api/history/:id', ({ res, params }) => {
  const e = history.get(params.id);
  if (!e) throw new HttpError(404, 'Análise não encontrada.');
  sendJson(res, 200, { entry: e });
});
router.patch('/api/history/:id', ({ res, params, body }) => {
  const a = body?.assumptions;
  if (!a || typeof a !== 'object') throw new HttpError(400, 'Envie "assumptions" com custo, frete, impostos etc.');
  const clean = {};
  for (const k of ['cost', 'shipping', 'taxPct', 'adPct', 'other', 'feeAmount', 'feePct']) {
    if (a[k] === '' || a[k] === null || a[k] === undefined) continue;
    const n = Number(a[k]);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `Valor inválido em "${k}".`);
    clean[k] = n;
  }
  const e = history.setAssumptions(params.id, clean);
  if (!e) throw new HttpError(404, 'Análise não encontrada.');
  sendJson(res, 200, { entry: e });
});
router.delete('/api/history/:id', ({ res, params }) => {
  if (!history.remove(params.id)) throw new HttpError(404, 'Análise não encontrada.');
  sendJson(res, 200, { ok: true });
});

// ---------- Pesquisa de mercado: vários links de uma vez ----------
router.post('/api/research', async ({ res, body }) => {
  const urls = [...new Set((Array.isArray(body?.urls) ? body.urls : []).map((u) => String(u).trim()).filter(Boolean))].slice(0, 20);
  if (!urls.length) throw new HttpError(400, 'Envie ao menos um link em "urls".');
  const results = [];
  for (let i = 0; i < urls.length; i += 3) {
    const batch = await Promise.allSettled(urls.slice(i, i + 3).map((u) => analyzeAndSave(u)));
    batch.forEach((r, j) => results.push(r.status === 'fulfilled'
      ? { url: urls[i + j], ok: true, item: history.summarize(r.value) }
      : { url: urls[i + j], ok: false, error: r.reason?.message || 'Falha na análise.' }));
  }
  sendJson(res, 200, { results });
});

// ---------- Webhooks do Mercado Livre ----------
// Responde 200 imediatamente e só registra a notificação; processamento futuro lê data/webhooks.jsonl.
router.post('/webhooks', ({ res, body }) => {
  try { appendLine('webhooks.jsonl', JSON.stringify({ receivedAt: new Date().toISOString(), body })); } catch (e) { console.error('[webhook] falha ao registrar:', e.message); }
  sendJson(res, 200, { ok: true });
});
