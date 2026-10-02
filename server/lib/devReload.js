import fs from 'node:fs';

// Recarga automática do navegador — SOMENTE em desenvolvimento (NODE_ENV=development).
// Em produção/`npm start` nada disto é ativado: nenhum script é injetado e a rota não existe.
export const isDev = () => process.env.NODE_ENV === 'development';

const clients = new Set();

const SNIPPET = `<script>(function(){try{var down=false,es=new EventSource('/__dev/events');
es.addEventListener('reload',function(){location.reload()});
es.onopen=function(){if(down)location.reload()};
es.onerror=function(){down=true}}catch(e){}})()</script>`;

export function injectDev(html) {
  return html.includes('</body>') ? html.replace('</body>', SNIPPET + '</body>') : html + SNIPPET;
}

export function handleEvents(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write('retry: 500\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

let timer;
export function watchPublic(dir) {
  const fire = () => { clearTimeout(timer); timer = setTimeout(() => { for (const c of clients) c.write('event: reload\ndata: 1\n\n'); }, 120); };
  let w;
  try { w = fs.watch(dir, { recursive: true }, fire); }
  catch { try { w = fs.watch(dir, fire); } catch (e) { console.warn('[dev] não consegui vigiar public/:', e.message); } }
  return w;
}
