import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, ROOT } from './config.js';
import { router } from './routes.js';
import fs from 'node:fs';
import { sendJson, readBody, serveStatic, HttpError } from './lib/http.js';
import { isDev, injectDev, handleEvents, watchPublic } from './lib/devReload.js';

const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');

// Proteção contra requisições de outros sites (CSRF): mutações vindas de navegador precisam ter a mesma origem.
// A rota de ingestão da extensão é a exceção (autenticada por chave própria e liberada por CORS).
function originAllowed(req, pathname) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  if (pathname === '/api/products/ingest' || pathname === '/webhooks') return true;
  const origin = req.headers.origin;
  if (!origin) return true; // curl/servidor a servidor
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function sendIndexDev(res) {
  const html = injectDev(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

// Confere na inicialização se o frontend está onde o servidor espera e avisa com o caminho completo.
export function checkFrontend() {
  const needed = [[PUBLIC, 'index.html'], [PUBLIC, 'style.css'], [PUBLIC, 'app.js'], [SHARED, 'calc.js']];
  const missing = needed.map(([d, f]) => path.join(d, f)).filter((f) => !fs.existsSync(f));
  console.log(`Frontend servido de: ${PUBLIC}`);
  if (missing.length) {
    console.error('\n[ERRO] Arquivos do frontend NÃO encontrados (a página abriria sem estilo/JavaScript):');
    missing.forEach((f) => console.error('  - ' + f));
    console.error('Confira se a pasta public/ e shared/ foram copiadas por inteiro.\n');
  }
  return missing;
}

export function createServer() {
  const dev = isDev();
  const watcher = dev ? watchPublic(PUBLIC) : null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    try {
      if (pathname === '/api/products/ingest') {
        res.setHeader('access-control-allow-origin', '*');
        res.setHeader('access-control-allow-headers', 'content-type,x-rangel-key');
        res.setHeader('access-control-allow-methods', 'POST,OPTIONS');
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      }
      if (dev && pathname === '/__dev/events') return handleEvents(req, res);
      if (!originAllowed(req, pathname)) throw new HttpError(403, 'Origem não permitida.');

      const route = router.match(req.method, pathname);
      if (route) {
        const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
        return await route.handler({ req, res, url, params: route.params, query: Object.fromEntries(url.searchParams), body });
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (pathname.startsWith('/shared/') && serveStatic(res, SHARED, pathname.slice('/shared/'.length))) return;
        if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) throw new HttpError(404, 'Rota não encontrada.');
        if (dev && (pathname === '/' || pathname === '/index.html')) return sendIndexDev(res);
        if (serveStatic(res, PUBLIC, pathname === '/' ? 'index.html' : pathname.slice(1))) return;
        // Fallback de página (SPA) SOMENTE para endereços sem extensão (ex.: /historico).
        // Arquivo ausente (.css, .js, .png...) NUNCA vira HTML: responde 404 de verdade,
        // senão o navegador "carrega" o CSS como HTML e o erro fica escondido.
        if (!path.extname(pathname)) {
          if (dev) return sendIndexDev(res);
          if (serveStatic(res, PUBLIC, 'index.html')) return;
        }
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(`404 - arquivo não encontrado: ${pathname}\nO frontend é servido da pasta: ${PUBLIC}`);
      }
      throw new HttpError(404, 'Não encontrado.');
    } catch (e) {
      if (res.headersSent) return res.end();
      const status = e.status || 500;
      if (!e.status) console.error('[erro]', e);
      sendJson(res, status, { error: e.message || 'Erro interno.', ...(e.extra || {}), ...(e.warnings ? { warnings: e.warnings } : {}) });
    }
  });
  server.on('close', () => watcher?.close()); // libera o vigia de public/ ao encerrar
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  checkFrontend();
  const server = createServer();
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`\n[ERRO] A porta ${config.port} já está em uso. Feche a outra janela do Rangel Métricas (ou mude PORT no .env) e tente de novo.`);
    else console.error(e);
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    console.log(`Rangel Métricas rodando em http://localhost:${config.port}${isDev() ? '  (modo desenvolvimento)' : ''}`);
  });
}
