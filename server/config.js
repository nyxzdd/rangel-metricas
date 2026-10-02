import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carregador mínimo de .env (sem dependências). Variáveis já definidas no ambiente têm prioridade.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv(path.join(ROOT, '.env'));

const PLACEHOLDER = /^COLOQUE_/i;
const env = (k, d = '') => (process.env[k] ?? d);

export const config = {
  get port() { return Number(env('PORT', '3000')); },
  get host() { return env('HOST', '127.0.0.1'); },
  get appUrl() { return env('APP_URL', `http://localhost:${this.port}`); },
  get dataDir() { return path.resolve(ROOT, env('DATA_DIR', 'data')); },
  get mlClientId() { const v = env('ML_CLIENT_ID'); return PLACEHOLDER.test(v) ? '' : v; },
  get mlClientSecret() { const v = env('ML_CLIENT_SECRET'); return PLACEHOLDER.test(v) ? '' : v; },
  get mlRedirectUri() { return env('ML_REDIRECT_URI', `${this.appUrl}/auth/mercadolivre/callback`); },
  get mlApiBase() { return env('ML_API_BASE', 'https://api.mercadolibre.com'); },
  get mlAuthBase() { return env('ML_AUTH_BASE', 'https://auth.mercadolivre.com.br'); },
  // Usa a página pública do anúncio como complemento (nota, avaliações, faixa de vendas) quando a API não entrega.
  get publicPageFallback() { return env('ML_PUBLIC_PAGE_FALLBACK', 'true').toLowerCase() !== 'false'; },
  // Chave para a futura extensão Chrome enviar produtos (header x-rangel-key). Vazio = endpoint desativado.
  get extensionKey() { return env('EXTENSION_API_KEY'); },
};
