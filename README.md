# Rangel Métricas

Cole o link de um anúncio do Mercado Livre → o sistema busca os dados disponíveis → calcula as métricas → mostra a análise completa → salva no histórico.

Princípio do projeto: **nenhum número é inventado.** Cada dado tem um selo de origem:

| Selo | Significa |
|---|---|
| **Real · API ML** | veio da API oficial do Mercado Livre |
| **Página pública** | lido da página do anúncio (melhor esforço; pode ser faixa, ex.: "+500 vendidos") |
| **Estimativa** | calculado a partir de outros dados (ex.: faturamento = vendas × preço) |
| **Indisponível** | não foi possível obter; o sistema diz o motivo |

## Como rodar

Requer Node.js 18.17 ou superior. **Não há dependências para instalar.**

```
node server/index.js        # ou: npm start  (Windows: INICIAR-RANGEL.bat)
```

Abra http://localhost:3000. Não abra `public/index.html` direto pelo arquivo.

### Desenvolvimento (recarga automática)
```
npm run dev                 # Windows: INICIAR-DEV.bat
```
- Salvou algo em `server/`, `shared/` ou `.env` → o backend **reinicia sozinho**.
- Salvou algo em `public/` → o navegador **recarrega sozinho** (F5 também funciona).
- Endereço continua `http://localhost:3000`. `npm start` / `INICIAR-RANGEL.bat` seguem iguais e **sem** recarga automática.

### Se a página abrir sem estilo / "Carregando…"
Olhe o terminal: o servidor imprime `Frontend servido de: <pasta>` e lista qualquer arquivo ausente (`public/style.css`, `public/app.js`, `shared/calc.js`). Arquivo ausente responde **404** (aba Network do navegador mostra em vermelho). Abra sempre `http://localhost:3000`, nunca o `index.html` direto pelo explorador de arquivos.

### Conectar ao Mercado Livre (OAuth)
1. Crie um app em https://developers.mercadolivre.com.br e cadastre a Redirect URI `http://localhost:3000/auth/mercadolivre/callback`.
2. Copie `.env.example` para `.env` e preencha `ML_CLIENT_ID` e `ML_CLIENT_SECRET`.
3. Reinicie e clique em **Configurações → Conectar Mercado Livre**.

Os tokens são guardados só no servidor (`data/tokens.json`, ignorado pelo Git) e renovados automaticamente.

## O que a API do Mercado Livre entrega (confirmado na documentação oficial)

| Dado | Fonte | Observação |
|---|---|---|
| Título, preço, preço original, tipo de anúncio, categoria, frete grátis | `GET /items/{id}` | |
| Vendas (`sold_quantity`) e estoque (`available_quantity`) | `GET /items/{id}` | **Só aparecem com o token do dono do anúncio.** Para concorrentes ficam indisponíveis (ou "faixa" da página pública). |
| Tarifa de venda | `GET /sites/{site}/listing_prices` | Usada na margem |
| Visitas | `GET /visits/items?ids=` | Exige token |
| Categoria (caminho) | `GET /categories/{id}` | |
| Vendedor e reputação | `GET /users/{id}` | Não confirmado em doc nesta sessão; falha vira "indisponível" |
| Nota e nº de avaliações | página pública (JSON-LD) | A API de itens não traz |

## Arquitetura

```
public/            Frontend (HTML/CSS/JS puro, sem segredos)
shared/calc.js     Regra de margem usada pelo frontend E pelo backend
server/
  index.js         Servidor HTTP, estáticos, CORS/CSRF
  routes.js        Rotas: /auth/mercadolivre, /api/products, /api/items, /api/orders,
                   /api/visits, /api/dashboard, /api/history, /api/research, /webhooks
  ml/              Integração Mercado Livre (url, client+OAuth, tokens, analyze, publicPage)
  history.js       Histórico de análises
  lib/             Utilitários (router, estáticos, armazenamento JSON)
data/              Histórico e tokens (fora do Git)
test/              Testes automatizados (API do ML simulada)
```

O armazenamento é um arquivo JSON (`server/lib/jsonStore.js`), suficiente para uso local. Para multiusuário/hospedagem, troque esse módulo por um banco (SQLite/Postgres) mantendo a interface.

## Extensão Chrome (preparada)

1. Defina `EXTENSION_API_KEY` no `.env`.
2. A extensão, estando numa página de produto, envia:
```
POST http://localhost:3000/api/products/ingest
x-rangel-key: <sua chave>
content-type: application/json

{ "url": "<URL da aba atual>" }
```
3. Resposta: `{ "id": "...", "openUrl": "http://localhost:3000/#/analise/<id>" }` — a extensão abre essa URL.

CORS já está liberado só para essa rota, protegida pela chave.

## Pendências conhecidas
- `/api/orders` responde 501: o endpoint e as permissões de pedidos ainda precisam ser confirmados na documentação oficial.
- Busca automática de concorrentes pela API não foi implementada (permissões não confirmadas). Use **Pesquisa de mercado** colando links.
- `/webhooks` só registra as notificações em `data/webhooks.jsonl`; o processamento será implementado junto com pedidos.

## Testes
```
npm test    # 12 testes de backend com a API do Mercado Livre simulada
```

## Segurança
- Client Secret e tokens nunca vão ao frontend nem à URL (token só no header `Authorization`).
- Servidor escuta apenas em `127.0.0.1` por padrão (`HOST`).
- Só links de domínios do Mercado Livre são aceitos (proteção SSRF); mutações exigem mesma origem (CSRF).
- Nunca envie `.env` nem `data/` ao GitHub (já estão no `.gitignore`).
