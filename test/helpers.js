import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Servidor falso da API do Mercado Livre, para testar sem rede e sem credenciais reais.
export function startMockMl({ ownerView = false } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: url.pathname + url.search, auth: req.headers.authorization || null });
    const json = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (url.pathname === '/oauth/token') {
      let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
        const p = new URLSearchParams(raw);
        if (p.get('client_secret') !== 'segredo-teste') return json(401, { message: 'bad secret' });
        if (p.get('grant_type') === 'authorization_code' && p.get('code') === 'CODIGO_OK') return json(200, { access_token: 'TOKEN_1', refresh_token: 'REFRESH_1', expires_in: 21600, user_id: 555 });
        if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === 'REFRESH_1') return json(200, { access_token: 'TOKEN_2', refresh_token: 'REFRESH_2', expires_in: 21600, user_id: 555 });
        json(400, { message: 'invalid_grant' });
      });
      return;
    }
    const authed = req.headers.authorization === 'Bearer TOKEN_1' || req.headers.authorization === 'Bearer TOKEN_2';
    if (url.pathname === '/items/MLB1111111111') {
      const item = { id: 'MLB1111111111', title: 'Fone Bluetooth Teste', price: 89.9, original_price: 119.9, seller_id: 42, category_id: 'MLB1000', listing_type_id: 'gold_pro', condition: 'new', permalink: 'https://produto.mercadolivre.com.br/MLB-1111111111-fone-_JM', secure_thumbnail: 'https://http2.mlstatic.com/x.jpg', shipping: { free_shipping: true } };
      if (ownerView) { item.sold_quantity = 120; item.available_quantity = 30; }
      return json(200, item);
    }
    if (url.pathname === '/items/MLB2222222222') return json(403, { message: 'forbidden', error: 'forbidden' });
    if (url.pathname === '/users/42') return json(200, { id: 42, nickname: 'LOJA_TESTE', seller_reputation: { level_id: '5_green', power_seller_status: 'gold', transactions: { completed: 1500, total: 1600 } } });
    if (url.pathname === '/categories/MLB1000') return json(200, { id: 'MLB1000', name: 'Fones', path_from_root: [{ name: 'Eletrônicos' }, { name: 'Fones' }] });
    if (url.pathname === '/sites/MLB/listing_prices') return json(200, [{ listing_type_id: 'gold_pro', sale_fee_amount: 17.5 }]);
    if (url.pathname === '/visits/items') return authed ? json(200, { MLB1111111111: 4321 }) : json(401, { message: 'unauthorized' });
    json(404, { message: 'not found' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, base: `http://127.0.0.1:${server.address().port}` })));
}

export function tmpDataDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rangel-test-')); }
