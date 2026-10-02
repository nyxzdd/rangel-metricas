import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// Persistência simples em arquivo JSON (escrita atômica). Suficiente para uso local de um usuário.
// Para multiusuário/produção, troque este módulo por um banco (SQLite/Postgres) mantendo a mesma interface.
export function readJson(name, fallback) {
  const file = path.join(config.dataDir, name);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(name, value, { secret = false } = {}) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, name);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: secret ? 0o600 : 0o644 });
  fs.renameSync(tmp, file);
}

export function appendLine(name, line) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.appendFileSync(path.join(config.dataDir, name), line + '\n');
}
