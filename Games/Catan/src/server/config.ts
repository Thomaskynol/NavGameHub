// Configuração do servidor por variáveis de ambiente.
import type { ServerConfig } from './types';

function intEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV === 'production' ? 'production' : 'development';
  return {
    nodeEnv,
    port: intEnv(env.PORT, 3001, 1, 65535),
    host: env.HOST && env.HOST.trim() !== '' ? env.HOST : '0.0.0.0',
    dbPath: env.DB_PATH && env.DB_PATH.trim() !== '' ? env.DB_PATH : 'db/catan.db',
    allowedOrigin: env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN.trim() !== '' ? env.ALLOWED_ORIGIN.trim() : null,
    testHooks: env.CATAN_TEST_HOOKS === '1',
    hubSecret: env.HUB_SECRET && env.HUB_SECRET.trim() !== '' ? env.HUB_SECRET : undefined,
    hubTestHooks: env.HUB_TEST_HOOKS === '1',
  };
}
