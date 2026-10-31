#!/usr/bin/env node
// Servidor de produção para E2E (Playwright): hooks de teste habilitados e
// banco temporário limpo a cada execução. NUNCA usar em produção normal.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = join(root, 'dist', 'server.mjs');

if (!existsSync(serverPath)) {
  console.error('[e2e-server] dist/server.mjs ausente — rode `npm run build` antes de iniciar o servidor de E2E.');
  process.exit(1);
}
if (!existsSync(join(root, 'dist', 'client', 'index.html'))) {
  console.error('[e2e-server] dist/client ausente — rode `npm run build` antes de iniciar o servidor de E2E.');
  process.exit(1);
}

const port = process.env.PORT ?? '4173';
const host = process.env.HOST ?? '127.0.0.1';
const dbPath = join(root, 'db', `e2e-${process.pid}.db`);
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });
rmSync(`${dbPath}-journal`, { force: true });

const child = spawn(process.execPath, [serverPath], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    CATAN_TEST_HOOKS: '1',
    DB_PATH: dbPath,
    PORT: port,
    HOST: host,
  },
});

const cleanup = () => {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  rmSync(`${dbPath}-journal`, { force: true });
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});
