import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.js';

process.env.DATA_DIR = tmpDataDir();
const { createServer } = await import('../server/index.js');

async function boot(nodeEnv) {
  process.env.NODE_ENV = nodeEnv;
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

test('produção (npm start): nada de recarga injetada e rota de eventos não existe', async () => {
  const { srv, base } = await boot('production');
  const html = await (await fetch(base + '/')).text();
  assert.ok(!html.includes('/__dev/events'));
  assert.equal((await fetch(base + '/__dev/events')).headers.get('content-type')?.includes('event-stream'), false);
  srv.closeAllConnections(); srv.close();
});

test('desenvolvimento: injeta o recarregador, mantém a página e as rotas funcionando, e avisa mudanças em public/', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { srv, base } = await boot('development');
  const html = await (await fetch(base + '/')).text();
  assert.ok(html.includes('/__dev/events') && html.includes('<title>Rangel Métricas</title>'));
  assert.ok((await (await fetch(base + '/historico-qualquer')).text()).includes('/__dev/events'), 'fallback SPA também injeta');
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal((await fetch(base + '/app.js')).status, 200);

  const ctrl = new AbortController();
  const res = await fetch(base + '/__dev/events', { signal: ctrl.signal });
  assert.match(res.headers.get('content-type'), /event-stream/);
  const reader = res.body.getReader();
  const target = path.resolve(import.meta.dirname, '../public/style.css');
  const original = fs.readFileSync(target);
  let got = '';
  const wait = (async () => { const dec = new TextDecoder(); while (!got.includes('event: reload')) { const { value, done } = await reader.read(); if (done) break; got += dec.decode(value); } })();
  await new Promise((r) => setTimeout(r, 300));
  fs.writeFileSync(target, original); // "salvar" o arquivo
  await Promise.race([wait, new Promise((_, rej) => setTimeout(() => rej(new Error('sem evento de reload')), 4000))]);
  assert.ok(got.includes('event: reload'));
  ctrl.abort(); srv.closeAllConnections(); srv.close();
});
