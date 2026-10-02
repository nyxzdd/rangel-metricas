// Modo desenvolvimento: sobe o servidor com reinício automático do backend e recarga automática do navegador.
// Uso: npm run dev  (ou INICIAR-DEV.bat no Windows). Funciona igual em Windows, macOS e Linux.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

// Garante que o .env exista (o --watch-path precisa do arquivo) sem sobrescrever o seu.
if (!fs.existsSync('.env') && fs.existsSync('.env.example')) {
  fs.copyFileSync('.env.example', '.env');
  console.log('[dev] .env criado a partir de .env.example — preencha ML_CLIENT_ID e ML_CLIENT_SECRET para conectar ao Mercado Livre.');
}

const args = ['--watch', '--watch-path=./server', '--watch-path=./shared'];
if (fs.existsSync('.env')) args.push('--watch-path=./.env'); // mudou o .env → reinicia sozinho
args.push('server/index.js');

console.log('[dev] backend: reinicia sozinho ao salvar arquivos em server/, shared/ ou .env');
console.log('[dev] frontend: a página recarrega sozinha ao salvar arquivos em public/ (F5 também funciona)');

const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
