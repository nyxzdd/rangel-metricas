import { config } from '../config.js';
import { loadTokens, saveTokens, clearTokens } from './tokens.js';

export const credentialsConfigured = () => Boolean(config.mlClientId && config.mlClientSecret);

export function buildAuthUrl(state) {
  const url = new URL('/authorization', config.mlAuthBase);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.mlClientId);
  url.searchParams.set('redirect_uri', config.mlRedirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

// POST /oauth/token (application/x-www-form-urlencoded) — conforme a documentação oficial.
async function tokenRequest(params) {
  const res = await fetch(`${config.mlApiBase}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.mlClientId, client_secret: config.mlClientSecret, ...params }),
    signal: AbortSignal.timeout(12000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.message || data.error || `Falha OAuth (${res.status})`); e.status = res.status; throw e; }
  return data;
}

function persist(data, previous = {}) {
  const tokens = {
    access_token: data.access_token,
    // O refresh token é de uso único: sempre guardar o novo.
    refresh_token: data.refresh_token || previous.refresh_token,
    user_id: data.user_id ?? previous.user_id ?? null,
    scope: data.scope ?? previous.scope ?? null,
    expires_at: Date.now() + (Number(data.expires_in) || 21600) * 1000,
    obtained_at: new Date().toISOString(),
  };
  saveTokens(tokens);
  return tokens;
}

export async function exchangeCode(code) {
  return persist(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.mlRedirectUri }));
}

let refreshing = null;
export async function getAccessToken() {
  const t = loadTokens();
  if (!t?.access_token) return null;
  if (t.expires_at - Date.now() > 120_000) return t.access_token;
  if (!t.refresh_token || !credentialsConfigured()) return null;
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token })
    .then((d) => persist(d, t)).catch((e) => { if (e.status === 400 || e.status === 401) clearTokens(); throw e; })
    .finally(() => { refreshing = null; });
  try { return (await refreshing).access_token; } catch { return null; }
}

export function connectionInfo() {
  const t = loadTokens();
  return { connected: Boolean(t?.access_token), userId: t?.user_id ?? null, expiresAt: t?.expires_at ?? null };
}

// GET na API. auth: 'optional' usa o token se existir; 'required' exige; 'none' nunca envia.
export async function mlGet(pathAndQuery, { auth = 'optional' } = {}) {
  const headers = { accept: 'application/json' };
  const token = auth === 'none' ? null : await getAccessToken();
  if (auth === 'required' && !token) return { ok: false, status: 401, error: 'Conecte sua conta do Mercado Livre para este dado.', needsAuth: true };
  if (token) headers.authorization = `Bearer ${token}`; // sempre no header, nunca na URL
  try {
    const res = await fetch(config.mlApiBase + pathAndQuery, { headers, signal: AbortSignal.timeout(12000) });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: data?.message || data?.error || `HTTP ${res.status}`, needsAuth: res.status === 401 || res.status === 403, data };
    return { ok: true, status: res.status, data, authenticated: Boolean(token) };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'TimeoutError' ? 'Tempo esgotado ao consultar o Mercado Livre.' : `Falha de rede: ${e.message}` };
  }
}
