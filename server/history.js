import { readJson, writeJson } from './lib/jsonStore.js';
import { calcMargin } from '../shared/calc.js';

const FILE = 'history.json';
const MAX = 2000;
const all = () => readJson(FILE, []);

// Resumo plano de uma análise para listagens.
export function summarize(entry) {
  const f = entry.analysis.fields;
  return {
    id: entry.id, savedAt: entry.savedAt, url: entry.url, itemId: entry.analysis.itemId, permalink: entry.analysis.permalink,
    title: f.title.value, image: f.image.value, price: f.price.value, sold: f.sold.value, soldSource: f.sold.source,
    revenue: f.revenue.value, rating: f.rating.value, seller: f.seller.value, listingType: f.listingType.value,
    saleFee: f.saleFee.value, assumptions: entry.assumptions || null, margin: entry.margin || null,
  };
}

export const list = () => all().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
export const get = (id) => all().find((e) => e.id === id) || null;

export function add(analysis) {
  const entry = { id: analysis.id, savedAt: analysis.analyzedAt, url: analysis.url, analysis, assumptions: null, margin: null };
  writeJson(FILE, [entry, ...all()].slice(0, MAX));
  return entry;
}

export function setAssumptions(id, assumptions) {
  const rows = all();
  const e = rows.find((r) => r.id === id);
  if (!e) return null;
  const f = e.analysis.fields;
  const margin = calcMargin({ ...assumptions, price: f.price.value, feeAmount: assumptions.feeAmount ?? f.saleFee.value, feeSource: assumptions.feeAmount != null ? 'informado' : 'api' });
  e.assumptions = assumptions; e.margin = margin;
  writeJson(FILE, rows);
  return e;
}

export function remove(id) {
  const rows = all();
  const next = rows.filter((r) => r.id !== id);
  if (next.length === rows.length) return false;
  writeJson(FILE, next);
  return true;
}
