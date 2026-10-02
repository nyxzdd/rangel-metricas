// Calculadora de margem — usada pelo backend e pelo frontend (mesma regra nos dois lados).
// Nenhum valor é inventado: sem custo informado, lucro/margem/ROI retornam null (indisponível).
const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const round2 = (v) => (v === null ? null : Math.round(v * 100) / 100);

export function calcMargin(input = {}) {
  const price = num(input.price);
  const cost = num(input.cost);
  const shipping = num(input.shipping) ?? 0;
  const other = num(input.other) ?? 0;
  const taxPct = num(input.taxPct) ?? 0;
  const adPct = num(input.adPct) ?? 0;
  const feeAmount = num(input.feeAmount);
  const feePct = num(input.feePct);

  if (price === null || price <= 0) return { ok: false, reason: 'Preço indisponível.' };

  let fee = null; let feeSource = 'indisponivel';
  if (feeAmount !== null) { fee = feeAmount; feeSource = input.feeSource || 'informado'; }
  else if (feePct !== null) { fee = price * feePct / 100; feeSource = input.feeSource || 'estimativa'; }

  const tax = price * taxPct / 100;
  const ad = price * adPct / 100;
  const feeUsed = fee ?? 0;
  const out = { ok: true, price, fee: round2(fee), feeSource, feeKnown: fee !== null, tax: round2(tax), ad: round2(ad), shipping, other, cost };

  if (cost === null) return { ...out, profit: null, marginPct: null, roi: null, breakEven: null, reason: 'Informe o custo do produto para calcular lucro, margem e ROI.' };

  const profit = price - cost - feeUsed - shipping - tax - ad - other;
  const variablePct = (feeUsed / price) + (taxPct + adPct) / 100; // taxas proporcionais ao preço
  const breakEven = variablePct < 1 ? (cost + shipping + other) / (1 - variablePct) : null;
  return {
    ...out,
    profit: round2(profit),
    marginPct: round2(profit / price * 100),
    roi: cost > 0 ? round2(profit / cost * 100) : null,
    breakEven: round2(breakEven),
  };
}
