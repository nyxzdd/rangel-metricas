import { calcMargin } from '/shared/calc.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const view = $('#view');
const modalRoot = $('#modalRoot');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = (u) => /^https?:\/\//i.test(u || '') ? esc(u) : '#';
const SOURCES = { api:'Real · API ML', pagina:'Página pública', estimativa:'Estimativa', indisponivel:'Indisponível' };

const fmt = {
  money: v => v == null ? 'Indisponível' : new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v),
  int: v => v == null ? 'Indisponível' : new Intl.NumberFormat('pt-BR').format(v),
  pct: v => v == null ? 'Indisponível' : `${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(v)}%`,
  dec: v => v == null ? 'Indisponível' : new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(v),
  dt: v => v ? new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}) : 'Indisponível'
};

let toastTimer;
function toast(msg, type='normal') {
  const t=$('#toast'); t.textContent=msg; t.className=`toast show ${type}`;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.className='toast',3800);
}
function sourceBadge(source) { return `<span class="source source-${esc(source||'indisponivel')}"><i></i>${esc(SOURCES[source]||source||'Indisponível')}</span>`; }
function statusBadge(text, tone='neutral') { return `<span class="status status-${tone}">${esc(text)}</span>`; }

async function api(path,{method='GET',body}={}) {
  let res;
  try { res=await fetch(path,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined}); }
  catch { throw new Error('Servidor offline. Inicie o Rangel Métricas em http://localhost:3000.'); }
  const data=await res.json().catch(()=>({}));
  if(!res.ok){const e=new Error(data.error||`Erro ${res.status}`);e.data=data;throw e;}
  return data;
}

function pageHead(kicker,title,subtitle='',action='') {
  return `<div class="page-head"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>${action?`<div class="page-head-action">${action}</div>`:''}</div>`;
}

function metricCard(label,value,meta,icon='◈',tone='') {
  const unavailable=value==null;
  return `<article class="metric-card ${tone}">
    <div class="metric-top"><span class="metric-icon">${icon}</span><span class="metric-label">${esc(label)}</span></div>
    <div class="metric-value ${unavailable?'unavailable':''}">${unavailable?'Indisponível':esc(value)}</div>
    <div class="metric-meta">${esc(meta||'')}</div>
  </article>`;
}

function analyzeWidget(id='quickUrl') {
  return `<div class="analyze-widget">
    <div class="analyze-icon">↗</div>
    <div class="analyze-copy"><strong>Analisar anúncio</strong><span>Cole um link do Mercado Livre para buscar os dados disponíveis.</span></div>
    <div class="analyze-form"><input id="${id}" type="url" placeholder="https://produto.mercadolivre.com.br/MLB-..." autocomplete="off"><button class="btn primary" id="${id}Btn" type="button">Analisar <span>→</span></button></div>
    <div class="inline-error" id="${id}Err"></div>
  </div>`;
}
function bindAnalyzeWidget(id='quickUrl') {
  const input=$(`#${id}`),btn=$(`#${id}Btn`),err=$(`#${id}Err`);
  if(!input||!btn)return;
  const run=()=>runAnalyze(input.value,btn,err);
  btn.addEventListener('click',run); input.addEventListener('keydown',e=>{if(e.key==='Enter')run();});
}
async function runAnalyze(url,btn,err) {
  if(!url.trim()){toast('Cole o link de um anúncio do Mercado Livre.','warn');return;}
  const old=btn.innerHTML; btn.disabled=true; btn.innerHTML='<span class="spinner"></span>Analisando…'; if(err)err.innerHTML='';
  try { const {entry}=await api('/api/products/analyze',{method:'POST',body:{url}}); location.hash=`#/analise/${entry.id}`; }
  catch(e){ if(err)err.innerHTML=`<div class="inline-error-box">${esc(e.message)}</div>`; toast(e.message,'error'); }
  finally{btn.disabled=false;btn.innerHTML=old;}
}

function productThumb(r,large=false) {
  return r.image ? `<img class="${large?'thumb-large':''}" src="${safeUrl(r.image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : `<span class="thumb-placeholder">R</span>`;
}
function productName(r) {
  return `<div class="product-cell">${productThumb(r)}<div class="product-cell-copy"><a href="#/analise/${esc(r.id)}" class="product-link">${esc(r.title||'Produto sem título')}</a><span>${esc(r.itemId||'ID indisponível')}</span></div></div>`;
}
function emptyState(title,text,button='') {
  return `<div class="empty-state"><div class="empty-icon">⌁</div><strong>${esc(title)}</strong><p>${esc(text)}</p>${button}</div>`;
}

function tableShell(headers,body,cls='') {
  return `<div class="table-scroll ${cls}"><table><thead><tr>${headers.map(h=>`<th class="${h.num?'num':''}">${h.label}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderProductsTable(rows,{market=false}={}) {
  if(!rows.length)return emptyState('Nenhum produto analisado','Analise seu primeiro anúncio para começar.',`<button class="btn primary" data-open-analyze type="button">＋ Analisar produto</button>`);
  const types=[...new Set(rows.map(r=>r.listingType).filter(Boolean))];
  return `<div class="table-toolbar">
    <div class="search-field"><span>⌕</span><input id="tableSearch" placeholder="Buscar por produto, ID ou vendedor"></div>
    <select id="typeFilter"><option value="">Todos os tipos</option>${types.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
    <select id="sortFilter"><option value="recent">Mais recentes</option><option value="price-desc">Maior preço</option><option value="price-asc">Menor preço</option><option value="margin-desc">Maior margem</option><option value="sales-desc">Mais vendas</option></select>
  </div>
  <div id="productsTable">${tableShell([
    {label:'Produto'}, {label:'Preço',num:true},{label:'Vendas',num:true},{label:'Faturamento est.',num:true},{label:market?'Margem simulada':'Margem',num:true},{label:'Origem'}
  ],'')}</div>`;
}
function bindProductsTable(rows,{market=false,marginOf}={}) {
  const draw=()=>{
    const q=($('#tableSearch')?.value||'').toLowerCase().trim(), type=$('#typeFilter')?.value||'', sort=$('#sortFilter')?.value||'recent';
    let list=rows.filter(r=>(!q||`${r.title||''} ${r.itemId||''} ${r.seller||''}`.toLowerCase().includes(q))&&(!type||r.listingType===type));
    const margin=r=>marginOf?rMargin(marginOf,r):r.margin?.marginPct;
    const rMargin=(fn,r)=>fn(r);
    list.sort((a,b)=>{
      if(sort==='price-desc')return (b.price??-Infinity)-(a.price??-Infinity);
      if(sort==='price-asc')return (a.price??Infinity)-(b.price??Infinity);
      if(sort==='margin-desc')return (margin(b)??-Infinity)-(margin(a)??-Infinity);
      if(sort==='sales-desc')return (b.sold??-Infinity)-(a.sold??-Infinity);
      return String(b.savedAt||'').localeCompare(String(a.savedAt||''));
    });
    const body=list.map(r=>{
      const m=margin(r);
      return `<tr><td>${productName(r)}</td><td class="num">${fmt.money(r.price)}</td><td class="num">${r.sold==null?'Indisponível':(r.soldSource==='pagina'?'≥ ':'')+fmt.int(r.sold)}</td><td class="num">${fmt.money(r.revenue)}</td><td class="num ${m!=null?(m>=0?'positive':'negative'):''}">${fmt.pct(m)}</td><td>${sourceBadge(r.margin?'estimativa':'api')}</td></tr>`;
    }).join('');
    $('#productsTable').innerHTML=body?tableShell([{label:'Produto'},{label:'Preço',num:true},{label:'Vendas',num:true},{label:'Faturamento est.',num:true},{label:market?'Margem simulada':'Margem',num:true},{label:'Origem'}],body):emptyState('Nenhum resultado','Ajuste os filtros para encontrar produtos.');
  };
  ['tableSearch','typeFilter','sortFilter'].forEach(id=>$('#'+id)?.addEventListener('input',draw));
  draw();
}

function fieldCard(label,field,format='text',noteOverride='') {
  const value=field?.value;
  let shown=value;
  if(format==='money')shown=fmt.money(value);
  if(format==='int')shown=fmt.int(value);
  if(format==='pct')shown=fmt.pct(value);
  if(format==='dec')shown=fmt.dec(value);
  if(format==='bool')shown=value==null?'Indisponível':(value?'Sim':'Não');
  return `<article class="detail-field"><div class="detail-field-top"><span>${esc(label)}</span>${sourceBadge(field?.source)}</div><strong class="${value==null?'unavailable':''}">${esc(shown)}</strong>${noteOverride||field?.note?`<small>${esc(noteOverride||field.note)}</small>`:''}</article>`;
}

function calcPanel({price=null,feeAmount=null,assumptions={},standalone=false,onSave=null}) {
  const v=k=>assumptions?.[k]??'';
  return `<section class="panel calc-panel" id="calc">
    <div class="panel-head"><div><div class="eyebrow">Financeiro</div><h2>${standalone?'Simulador de preço':'Lucro e margem'}</h2><p>${standalone?'Teste diferentes custos e encontre um preço de venda.':'Preencha suas premissas. O cálculo usa a mesma regra do backend.'}</p></div><span class="calc-lock">Dados reais + premissas</span></div>
    <div class="panel-body">
      <div class="calc-grid">
        ${standalone?`<label>Preço de venda (R$)<input name="price" type="number" min="0" step="0.01" value="${v('price')}" placeholder="0,00"></label>`:''}
        <label>Custo do produto (R$)<input name="cost" type="number" min="0" step="0.01" value="${v('cost')}" placeholder="0,00"></label>
        <label>Tarifa do ML (R$)<input name="feeAmount" type="number" min="0" step="0.01" value="${feeAmount??v('feeAmount')??''}" placeholder="Indisponível"></label>
        <label>Comissão do ML (%)<input name="feePct" type="number" min="0" step="0.1" value="${v('feePct')??''}" placeholder="Se não houver tarifa"></label>
        <label>Frete pago por você (R$)<input name="shipping" type="number" min="0" step="0.01" value="${v('shipping')}" placeholder="0,00"></label>
        <label>Impostos (%)<input name="taxPct" type="number" min="0" step="0.1" value="${v('taxPct')}" placeholder="0"></label>
        <label>Anúncios / Ads (%)<input name="adPct" type="number" min="0" step="0.1" value="${v('adPct')}" placeholder="0"></label>
        <label>Outros custos (R$)<input name="other" type="number" min="0" step="0.01" value="${v('other')}" placeholder="0,00"></label>
      </div>
      <div id="calcWarn"></div>
      <div class="calc-results" id="calcOut"></div>
      ${onSave?`<div class="actions end"><button class="btn primary" id="saveCalc" type="button">Salvar premissas</button></div>`:''}
    </div>
  </section>`;
}
function visitPoints(payload) {
  const raw = payload?.visits ?? payload;
  let arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.results) ? raw.results : (Array.isArray(raw?.data) ? raw.data : null));
  if (!arr && raw && typeof raw === 'object') {
    const pairs = Object.entries(raw).filter(([k,v]) => Number.isFinite(Number(v)) && /\d/.test(k));
    if (pairs.length) arr = pairs.map(([label,value]) => ({date:label, visits:Number(value)}));
  }
  if (!arr) {
    const total = raw?.total_visits ?? raw?.totalVisits ?? raw?.visits;
    return Number.isFinite(Number(total)) ? [{label:'Total',value:Number(total)}] : [];
  }
  return arr.map((x,i)=>{
    const value = Number(x?.visits ?? x?.total_visits ?? x?.value ?? x?.count ?? x?.total);
    const label = x?.date ?? x?.day ?? x?.timestamp ?? x?.date_from ?? x?.label ?? `Dia ${i+1}`;
    return Number.isFinite(value) ? {label:String(label),value} : null;
  }).filter(Boolean);
}

function visitsChart(points) {
  if (!points.length) return emptyState('Nenhum dado de visitas','A API não retornou uma série de visitas para este período.');
  const w=760,h=250,pad={l:48,r:18,t:20,b:42};
  const max=Math.max(...points.map(p=>p.value),1), min=0;
  const x=i=>points.length===1?(w/2):pad.l+i*(w-pad.l-pad.r)/(points.length-1);
  const y=v=>pad.t+(max-v)*(h-pad.t-pad.b)/(max-min||1);
  const line=points.map((p,i)=>`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area=`${pad.l},${h-pad.b} ${line} ${x(points.length-1)},${h-pad.b}`;
  const labels=points.map((p,i)=>i===0||i===points.length-1||i===Math.floor(points.length/2)?`<text x="${x(i)}" y="${h-14}" text-anchor="middle">${esc(p.label.slice(0,16))}</text>`:'').join('');
  const dots=points.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.value)}" r="3.5"><title>${esc(p.label)} · ${fmt.int(p.value)} visitas</title></circle>`).join('');
  return `<div class="visits-chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Histórico de visitas"><polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${line}" fill="none"/>${dots}<line class="chart-axis" x1="${pad.l}" y1="${h-pad.b}" x2="${w-pad.r}" y2="${h-pad.b}"/>${labels}</svg></div>`;
}

async function loadVisits(id,last) {
  const box=$('#visitsResult'),btn=$('#loadVisits');
  if(!box||!id)return;
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span>Consultando…';
  box.innerHTML='<div class="visit-loading"><span class="spinner"></span>Buscando visitas reais no Mercado Livre…</div>';
  try {
    const data=await api(`/api/visits/${encodeURIComponent(id)}?last=${encodeURIComponent(last)}`);
    const points=visitPoints(data);
    box.innerHTML=points.length?`<div class="visits-summary"><strong>${fmt.int(points.reduce((a,p)=>a+p.value,0))}</strong><span>visitas retornadas no período</span></div>${visitsChart(points)}`:visitsChart(points);
  } catch(e) {
    const auth=e.data?.needsAuth || e.data?.status===401 || /conect|autentic/i.test(e.message||'');
    box.innerHTML=auth?`<div class="alert warn"><strong>Mercado Livre não conectado.</strong><br>Conecte sua conta para consultar visitas deste anúncio.<div class="actions"><a class="btn primary small" href="/auth/mercadolivre">Conectar Mercado Livre</a></div></div>`:`<div class="alert error">${esc(e.message)}<div class="actions"><button class="btn small" id="retryVisits" type="button">Tentar novamente</button></div></div>`;
    $('#retryVisits')?.addEventListener('click',()=>loadVisits(id,last));
  } finally { btn.disabled=false; btn.innerHTML='Atualizar visitas'; }
}

function bindCalc({price=null,standalone=false,onSave=null}) {
  const root=$('#calc'); if(!root)return;
  const read=()=>Object.fromEntries($$('input',root).map(i=>[i.name,i.value===''?null:Number(i.value)]));
  const update=()=>{
    const f=read(),r=calcMargin({...f,price:standalone?f.price:price});
    if(!r.ok){$('#calcOut').innerHTML='';$('#calcWarn').innerHTML=`<div class="alert warn">${esc(r.reason)}</div>`;return;}
    $('#calcWarn').innerHTML=!r.feeKnown?'<div class="alert warn">A tarifa do Mercado Livre não está informada. O lucro ficará indisponível/superestimado até você informar uma tarifa.</div>':'';
    const cell=(label,value,tone='')=>`<div class="calc-result ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    const sign=r.profit==null?'':r.profit>=0?'positive':'negative';
    $('#calcOut').innerHTML=cell('Tarifa do ML',r.fee==null?'Indisponível':fmt.money(r.fee))+cell('Impostos',fmt.money(r.tax))+cell('Publicidade',fmt.money(r.ad))+cell('Lucro',r.profit==null?'Indisponível':fmt.money(r.profit),sign)+cell('Margem',fmt.pct(r.marginPct),sign)+cell('ROI',fmt.pct(r.roi))+cell('Ponto de equilíbrio',fmt.money(r.breakEven));
  };
  root.addEventListener('input',update);update();
  $('#saveCalc')?.addEventListener('click',()=>onSave?.(read()));
}

const views={
  async dashboard(){
    const d=await api('/api/dashboard'),m=d.metrics||{}, recent=d.recent||[];
    view.innerHTML=pageHead('Visão geral','Dashboard','Acompanhe os produtos que você já analisou e os dados disponíveis no momento.')+
      analyzeWidget()+
      `<section class="metric-grid">
        ${metricCard('Produtos analisados',fmt.int(m.analyzed),`${fmt.int(m.totalAnalyses)} análises salvas no total`,'▦')}
        ${metricCard('Total de análises',fmt.int(m.totalAnalyses),'Inclui todas as análises do histórico','↗')}
        ${metricCard('Receita estimada',m.estimatedRevenue==null?null:fmt.money(m.estimatedRevenue),m.estimatedRevenue==null?'Nenhum produto com vendas disponíveis':`${m.revenueCoverage} com receita calculável`,'$','blue')}
        ${metricCard('Margem média',m.avgMarginPct==null?null:fmt.pct(m.avgMarginPct),m.avgMarginPct==null?'Salve o custo em uma análise':`${m.marginCoverage} com margem calculável`,'%','green')}
        ${metricCard('Cobertura de receita',m.revenueCoverage||'Indisponível','Produtos com dados suficientes para receita','◌')}
        ${metricCard('Cobertura de margem',m.marginCoverage||'Indisponível','Produtos com custo e tarifa disponíveis','◍')}
      </section>
      <section class="panel section-gap">
        <div class="panel-head"><div><div class="eyebrow">Últimos dados</div><h2>Produtos recentes</h2><p>Os anúncios mais recentemente analisados.</p></div><a class="btn ghost small" href="#/historico">Ver histórico <span>→</span></a></div>
        ${recent.length?tableShell([{label:'Produto'},{label:'Preço',num:true},{label:'Vendas',num:true},{label:'Receita est.',num:true},{label:'Margem',num:true},{label:'Analisado em'}],recent.map(r=>`<tr><td>${productName(r)}</td><td class="num">${fmt.money(r.price)}</td><td class="num">${r.sold==null?'Indisponível':(r.soldSource==='pagina'?'≥ ':'')+fmt.int(r.sold)}</td><td class="num">${fmt.money(r.revenue)}</td><td class="num">${fmt.pct(r.margin?.marginPct)}</td><td>${fmt.dt(r.savedAt)}</td></tr>`).join('')):emptyState('Ainda não há análises','Cole um link acima para criar sua primeira análise.')}</section>
      <section class="info-strip"><div class="info-icon">✓</div><div><strong>Transparência de dados</strong><p>O sistema diferencia dados da API do Mercado Livre, página pública, estimativas e informações indisponíveis.</p></div><a href="#/configuracoes">Ver origem dos dados →</a></section>`;
    bindAnalyzeWidget();
  },

  async produtos(){
    const {products=[]}=await api('/api/products');
    view.innerHTML=pageHead('Catálogo','Produtos','A visão mais recente de cada anúncio já analisado.',`<button class="btn primary" data-open-analyze type="button">＋ Analisar produto</button>`)+
      `<section class="panel"><div class="panel-head"><div><h2>Todos os produtos</h2><p>${products.length} produto(s) único(s) no histórico.</p></div></div>${renderProductsTable(products)}</section>`;
    bindProductsTable(products);
  },

  async pesquisa(){
    const {products=[]}=await api('/api/products');
    view.innerHTML=pageHead('Inteligência de mercado','Pesquisa de mercado','Compare anúncios colando vários links. Cada análise é salva no histórico.')+
      `<section class="panel research-input"><div class="panel-head"><div><h2>Adicionar anúncios</h2><p>Até 20 links, um por linha. Os resultados vêm das mesmas APIs do sistema.</p></div><span class="limit-pill">20 links</span></div><div class="panel-body"><textarea id="researchLinks" placeholder="https://produto.mercadolivre.com.br/MLB-...&#10;https://produto.mercadolivre.com.br/MLB-..."></textarea><div class="actions"><button class="btn primary" id="runResearch" type="button">Analisar links <span>→</span></button></div><div id="researchErrors"></div></div></section>
      <section class="panel section-gap"><div class="panel-head"><div><h2>Premissas da comparação</h2><p>Estas premissas são usadas somente para simular a margem da tabela. Elas não alteram o histórico.</p></div></div><div class="panel-body"><div class="calc-grid compact" id="marketAssumptions"><label>Custo (% do preço)<input name="costPct" type="number" min="0" step="0.1" placeholder="Ex.: 40"></label><label>Frete (R$)<input name="shipping" type="number" min="0" step="0.01" placeholder="0,00"></label><label>Impostos (%)<input name="taxPct" type="number" min="0" step="0.1" placeholder="0"></label><label>Ads (%)<input name="adPct" type="number" min="0" step="0.1" placeholder="0"></label></div></div></section>
      <section class="panel"><div class="panel-head"><div><h2>Comparativo</h2><p>Use os filtros para encontrar oportunidades dentro dos anúncios que você forneceu.</p></div></div>${renderProductsTable(products,{market:true})}</section>`;
    const read=()=>Object.fromEntries($$('input','#marketAssumptions').map(i=>[i.name,i.value===''?null:Number(i.value)]));
    const marginOf=r=>{const a=read();if(a.costPct==null||r.price==null)return null;const out=calcMargin({price:r.price,cost:r.price*a.costPct/100,feeAmount:r.saleFee,shipping:a.shipping,taxPct:a.taxPct,adPct:a.adPct});return out.marginPct;};
    bindProductsTable(products,{market:true,marginOf});
    $('#marketAssumptions').addEventListener('input',()=>bindProductsTable(products,{market:true,marginOf}));
    $('#runResearch').addEventListener('click',async e=>{
      const urls=$('#researchLinks').value.split(/\s+/).map(s=>s.trim()).filter(Boolean);
      if(!urls.length){toast('Cole pelo menos um link.','warn');return;}
      if(urls.length>20){toast('O limite é de 20 links por análise.','warn');return;}
      const b=e.currentTarget;b.disabled=true;b.innerHTML='<span class="spinner"></span>Analisando…';
      try{const {results}=await api('/api/research',{method:'POST',body:{urls}});const bad=results.filter(x=>!x.ok);toast(`${results.length-bad.length} anúncio(s) analisado(s)${bad.length?` · ${bad.length} com erro`:''}`,bad.length?'warn':'success');if(bad.length)$('#researchErrors').innerHTML=bad.map(x=>`<div class="alert error"><strong>${esc(x.url)}</strong><br>${esc(x.error)}</div>`).join('');await views.pesquisa();}
      catch(err){toast(err.message,'error');b.disabled=false;b.textContent='Analisar links →';}
    });
  },

  async precificador(){
    view.innerHTML=pageHead('Financeiro','Precificador','Simule preço, custo e despesas antes de decidir o preço de venda.')+calcPanel({standalone:true});
    bindCalc({standalone:true});
  },

  async historico(){
    const {entries=[]}=await api('/api/history');
    view.innerHTML=pageHead('Registro','Histórico','Todas as análises salvas, com o preço registrado naquele momento.',`<button class="btn primary" data-open-analyze type="button">＋ Nova análise</button>`)+
      `<section class="panel"><div class="panel-head"><div><h2>Histórico de análises</h2><p>${entries.length} registro(s)</p></div><div class="search-field history-search"><span>⌕</span><input id="historySearch" placeholder="Buscar no histórico"></div></div><div id="historyTable"></div></section>`;
    const draw=()=>{
      const q=($('#historySearch')?.value||'').toLowerCase().trim();
      const list=entries.filter(r=>`${r.title||''} ${r.itemId||''}`.toLowerCase().includes(q));
      $('#historyTable').innerHTML=list.length?tableShell([{label:'Produto'},{label:'Preço',num:true},{label:'Vendas',num:true},{label:'Margem',num:true},{label:'Data'},{label:'Mercado Livre'},{label:''}],list.map(r=>`<tr><td>${productName(r)}</td><td class="num">${fmt.money(r.price)}</td><td class="num">${r.sold==null?'Indisponível':(r.soldSource==='pagina'?'≥ ':'')+fmt.int(r.sold)}</td><td class="num">${fmt.pct(r.margin?.marginPct)}</td><td>${fmt.dt(r.savedAt)}</td><td>${r.permalink?`<a class="table-link" href="${safeUrl(r.permalink)}" target="_blank" rel="noopener">Abrir ↗</a>`:'Indisponível'}</td><td><button class="icon-danger" data-del="${esc(r.id)}" title="Remover">×</button></td></tr>`).join('')):emptyState('Nenhum registro encontrado','Tente outra busca ou faça uma nova análise.');
      $$('[data-del]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Remover esta análise do histórico?'))return;try{await api(`/api/history/${encodeURIComponent(b.dataset.del)}`,{method:'DELETE'});toast('Análise removida.','success');await views.historico();}catch(e){toast(e.message,'error');}}));
    };
    $('#historySearch').addEventListener('input',draw);draw();
  },

  async analise(id){
    const {entry}=await api(`/api/history/${encodeURIComponent(id)}`),an=entry.analysis,f=an.fields;
    const mode=an.mode==='autenticado'?'Conta conectada':'Dados públicos';
    view.innerHTML=`<div class="back-row"><a href="#/historico">← Voltar ao histórico</a><span>${esc(fmt.dt(an.analyzedAt))}</span></div>
      <section class="product-hero"><div class="hero-product-image">${productThumb({image:f.image?.value},true)}</div><div class="product-hero-copy"><div class="eyebrow">ANÁLISE · ${esc(mode)}</div><h1>${esc(f.title?.value||'Produto sem título')}</h1><div class="hero-meta"><span>${esc(an.itemId||'ID indisponível')}</span>${sourceBadge(f.price?.source)}${statusBadge(an.kind==='catalog'?'Catálogo':'Anúncio',an.kind==='catalog'?'warn':'neutral')}</div><div class="actions"><a class="btn primary" href="${safeUrl(an.permalink)}" target="_blank" rel="noopener">Abrir no Mercado Livre ↗</a><button class="btn" id="reanalyze" type="button">↻ Atualizar análise</button><button class="btn danger-outline" id="delAnalysis" type="button">Remover</button></div></div></section>
      ${an.warnings?.length?`<div class="alert-stack">${an.warnings.map(w=>`<div class="alert warn">${esc(w)}</div>`).join('')}</div>`:''}
      <div class="section-title"><div><div class="eyebrow">Dados do anúncio</div><h2>Visão geral</h2></div></div>
      <section class="detail-grid">
        ${fieldCard('Preço atual',f.price,'money')}${fieldCard('Preço original',f.originalPrice,'money')}${fieldCard('Vendas',f.sold,'int')}${fieldCard('Faturamento estimado',f.revenue,'money')}${fieldCard('Visitas',f.visits,'int')}${fieldCard('Avaliação',f.rating,'dec')}${fieldCard('Avaliações',f.ratingCount,'int')}${fieldCard('Estoque',f.stock,'int')}${fieldCard('Vendedor',f.seller)}${fieldCard('Reputação',f.reputation)}${fieldCard('Tipo de anúncio',f.listingType)}${fieldCard('Categoria',f.category)}${fieldCard('Condição',f.condition)}${fieldCard('Frete grátis',f.freeShipping,'bool')}${fieldCard('Tarifa de venda',f.saleFee,'money')}
      </section>
      <div class="section-title"><div><div class="eyebrow">Resultado financeiro</div><h2>Custos, lucro e margem</h2></div></div>
      ${calcPanel({price:f.price?.value,feeAmount:f.saleFee?.value,assumptions:entry.assumptions||{},onSave:true})}
      <section class="panel section-gap visits-panel"><div class="panel-head"><div><div class="eyebrow">Mercado Livre</div><h2>Visitas do anúncio</h2><p>Consulta autenticada do histórico de visitas. Nenhum dado é inventado.</p></div><div class="visit-controls"><select id="visitPeriod"><option value="7">7 dias</option><option value="15">15 dias</option><option value="30" selected>30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option></select><button class="btn small" id="loadVisits" type="button">Consultar visitas</button></div></div><div class="panel-body" id="visitsResult"><div class="visit-empty">Clique em “Consultar visitas” para buscar os dados reais.</div></div></section>
      <section class="panel section-gap"><div class="panel-head"><div><div class="eyebrow">Próximo passo</div><h2>Pesquisa de mercado</h2><p>${esc(an.competitors?.note||'Compare este anúncio com outros links do Mercado Livre.')}</p></div><a class="btn" href="#/pesquisa">Comparar anúncios →</a></div></section>`;
    bindCalc({price:f.price?.value,onSave:async vals=>{try{const clean={...vals};if(clean.feeAmount===f.saleFee?.value)delete clean.feeAmount;await api(`/api/history/${encodeURIComponent(id)}`,{method:'PATCH',body:{assumptions:clean}});toast('Premissas salvas.','success');await views.analise(id);}catch(e){toast(e.message,'error');}}});
    $('#reanalyze').addEventListener('click',e=>runAnalyze(an.url,e.currentTarget));
    $('#delAnalysis').addEventListener('click',async()=>{if(!confirm('Remover esta análise do histórico?'))return;try{await api(`/api/history/${encodeURIComponent(id)}`,{method:'DELETE'});location.hash='#/historico';}catch(e){toast(e.message,'error');}});
    $('#loadVisits')?.addEventListener('click',()=>loadVisits(an.itemId||id,$('#visitPeriod').value));
  },

  async configuracoes(_,query={}){
    const s=await api('/api/status'),ml=s.ml;
    const banner=query.conectado?`<div class="alert success">Conta do Mercado Livre conectada com sucesso.</div>`:query.erro?`<div class="alert error">${esc(({credenciais:'Defina ML_CLIENT_ID e ML_CLIENT_SECRET no .env e reinicie o servidor.',negado:'A autorização foi negada no Mercado Livre.',state:'A conexão expirou ou é inválida.',token:'O Mercado Livre recusou a troca do código. Confira as configurações.'}[query.erro]||'Não foi possível conectar.'))}</div>`:'';
    view.innerHTML=pageHead('Sistema','Configurações','Integrações, conexão e transparência dos dados.')+banner+
      `<section class="settings-grid"><section class="panel"><div class="panel-head"><div><div class="eyebrow">Integração</div><h2>Mercado Livre</h2><p>OAuth oficial. Segredos e tokens ficam somente no servidor.</p></div><span class="connection-state ${ml.connected?'connected':''}"><i></i>${ml.connected?'Conectado':'Não conectado'}</span></div><div class="panel-body">
      <div class="settings-list"><div><span>Credenciais</span><strong>${ml.credentialsConfigured?'Configuradas':'Não configuradas'}</strong></div><div><span>Conta</span><strong>${ml.connected?'Conectada'+(ml.userId?` · ${esc(ml.userId)}`:''):'Não conectada'}</strong></div><div><span>Redirect URI</span><code>${esc(ml.redirectUri)}</code></div></div>
      <div class="actions">${ml.connected?'<button class="btn danger-outline" id="disconnect">Desconectar conta</button>':'<a class="btn primary" href="/auth/mercadolivre">Conectar Mercado Livre</a>'}</div>
      ${!ml.credentialsConfigured?'<div class="alert warn">Copie .env.example para .env, preencha ML_CLIENT_ID e ML_CLIENT_SECRET e reinicie o servidor.</div>':''}</div></section>
      <section class="panel"><div class="panel-head"><div><div class="eyebrow">Transparência</div><h2>Origem dos dados</h2><p>O sistema nunca transforma uma informação ausente em zero.</p></div></div><div class="panel-body origin-list">
      <div>${sourceBadge('api')}<p>Informação retornada pela API oficial do Mercado Livre.</p></div><div>${sourceBadge('pagina')}<p>Informação lida da página pública do anúncio.</p></div><div>${sourceBadge('estimativa')}<p>Valor calculado a partir de outros dados disponíveis.</p></div><div>${sourceBadge('indisponivel')}<p>Não foi possível obter o dado no momento.</p></div></div></section></section>
      <section class="panel section-gap"><div class="panel-head"><div><div class="eyebrow">Recursos</div><h2>Estado do sistema</h2></div></div><div class="panel-body settings-list"><div><span>Página pública complementar</span><strong>${s.publicPageFallback?'Ativa':'Desativada'}</strong></div><div><span>Extensão Chrome</span><strong>${s.extensionEnabled?'Endpoint ativo':'Desativada'}</strong></div><div><span>Pedidos</span><strong>Não implementado</strong></div></div></section>`;
    $('#disconnect')?.addEventListener('click',async()=>{try{await api('/auth/mercadolivre/disconnect',{method:'POST'});toast('Conta desconectada.','success');await views.configuracoes(null,{});refreshConn();}catch(e){toast(e.message,'error');}});
  }
};

function openAnalyzeModal(){
  modalRoot.innerHTML=`<div class="modal-backdrop" data-close-modal><div class="modal" role="dialog" aria-modal="true" aria-labelledby="analyzeModalTitle"><button class="modal-close" data-close-modal type="button">×</button><div class="modal-icon">↗</div><div class="eyebrow">NOVA ANÁLISE</div><h2 id="analyzeModalTitle">Analisar produto</h2><p>Cole a URL do anúncio do Mercado Livre. O sistema consulta os dados disponíveis e salva a análise.</p><label class="modal-label">URL do anúncio<input id="modalUrl" autofocus type="url" placeholder="https://produto.mercadolivre.com.br/MLB-..."></label><div id="modalErr"></div><div class="modal-actions"><button class="btn" data-close-modal type="button">Cancelar</button><button class="btn primary" id="modalAnalyze" type="button">Analisar produto →</button></div></div></div>`;
  const close=()=>modalRoot.innerHTML='';
  $$('[data-close-modal]',modalRoot).forEach(x=>x.addEventListener('click',e=>{if(e.target===x||x.dataset.closeModal!==undefined)close();}));
  $('#modalAnalyze').addEventListener('click',()=>runAnalyze($('#modalUrl').value,$('#modalAnalyze'),$('#modalErr')));
  $('#modalUrl').addEventListener('keydown',e=>{if(e.key==='Enter')runAnalyze($('#modalUrl').value,$('#modalAnalyze'),$('#modalErr'));});
  modalRoot.querySelector('.modal').addEventListener('click',e=>e.stopPropagation());
  setTimeout(()=>$('#modalUrl')?.focus(),20);
}
document.addEventListener('click',e=>{if(e.target.closest('[data-open-analyze]'))openAnalyzeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')modalRoot.innerHTML='';});

const routeLabels={dashboard:'Dashboard',produtos:'Produtos',pesquisa:'Pesquisa de mercado',precificador:'Precificador',historico:'Histórico',configuracoes:'Configurações',analise:'Análise do produto'};
async function route(){
  const [pathPart,qs='']=(location.hash.replace(/^#\/?/,'')||'dashboard').split('?');
  const [name,arg]=pathPart.split('/');
  const query=Object.fromEntries(new URLSearchParams(qs));
  $$('#nav a').forEach(a=>a.classList.toggle('active',a.dataset.route===(name==='analise'?'historico':name)));
  $('#topContext .topbar-page').textContent=routeLabels[name]||'Dashboard';
  const fn=views[name];
  if(!fn){location.hash='#/dashboard';return;}
  view.innerHTML='<div class="page-loader"><span></span><span></span><span></span></div>';
  try{await fn(arg,query);window.scrollTo({top:0,behavior:'instant'});}
  catch(e){view.innerHTML=`<div class="error-page"><div class="error-code">!</div><h2>Não foi possível carregar esta tela</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Tentar novamente</button></div>`;}
  refreshConn(); closeMobile();
}
async function refreshConn(){
  const el=$('#connBadge'); if(!el)return;
  try{const s=await api('/api/status');el.className=`connection-card ${s.ml.connected?'connected':'offline'}`;el.querySelector('.connection-text').textContent=s.ml.connected?'Mercado Livre conectado':'Mercado Livre não conectado';}
  catch{el.className='connection-card offline';el.querySelector('.connection-text').textContent='Servidor offline';}
}
function closeMobile(){document.body.classList.remove('menu-open');}
$('#themeBtn').addEventListener('click',()=>{const light=document.documentElement.classList.toggle('light');try{localStorage.setItem('rangel-theme',light?'light':'dark')}catch{};$('#themeText').textContent=light?'Modo claro':'Modo escuro';});
$('#themeText').textContent=document.documentElement.classList.contains('light')?'Modo claro':'Modo escuro';
$('#topAnalyze').addEventListener('click',openAnalyzeModal);
$('#menuBtn').addEventListener('click',()=>document.body.classList.add('menu-open'));
$('#sidebarClose').addEventListener('click',closeMobile);
$('#mobileOverlay').addEventListener('click',closeMobile);
window.addEventListener('hashchange',route);
route();
