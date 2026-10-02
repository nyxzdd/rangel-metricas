import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler });
  };
  return {
    get: (p, h) => add('GET', p, h), post: (p, h) => add('POST', p, h),
    patch: (p, h) => add('PATCH', p, h), delete: (p, h) => add('DELETE', p, h),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(pathname);
        if (m) {
          const params = {};
          r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
          return { handler: r.handler, params };
        }
      }
      return null;
    },
  };
}

export function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

export function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Corpo da requisição muito grande.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) { try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, 'JSON inválido.')); } }
      else if (ct.includes('application/x-www-form-urlencoded')) resolve(Object.fromEntries(new URLSearchParams(raw)));
      else resolve({ raw });
    });
    req.on('error', reject);
  });
}

// Serve arquivos estáticos de `dir` sob o prefixo `prefix`, bloqueando path traversal.
export function serveStatic(res, dir, relPath) {
  const root = path.resolve(dir);
  const file = path.resolve(root, '.' + path.sep + decodeURIComponent(relPath));
  if (file !== root && !file.startsWith(root + path.sep)) return false;
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}
