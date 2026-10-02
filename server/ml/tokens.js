import { readJson, writeJson } from '../lib/jsonStore.js';

// Tokens ficam SOMENTE no servidor (data/tokens.json, fora do Git). Nunca vão para o frontend.
const FILE = 'tokens.json';
export const loadTokens = () => readJson(FILE, null);
export const saveTokens = (t) => writeJson(FILE, t, { secret: true });
export const clearTokens = () => writeJson(FILE, null, { secret: true });
