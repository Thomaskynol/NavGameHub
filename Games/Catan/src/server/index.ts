// Bootstrap do servidor autoritativo.
import { loadConfig } from './config';
import { loadEngine } from './engine';
import { createApp } from './http';
import { logError, logInfo } from './log';

async function main(): Promise<void> {
  const config = loadConfig();
  let engine;
  try {
    engine = await loadEngine();
  } catch (err) {
    logError('engine_unavailable', {
      message: err instanceof Error ? err.message : String(err),
      hint: 'src/engine ainda não existe? Implemente o motor antes de subir o servidor.',
    });
    process.exit(1);
  }
  const app = createApp({ config, engine });
  const port = await app.start();
  logInfo('ready', { port, dbPath: config.dbPath, testHooks: config.testHooks });

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logInfo('shutting_down', { signal });
    void app
      .stop()
      .catch((err) => logError('shutdown_failed', { message: err instanceof Error ? err.message : String(err) }))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main().catch((err) => {
  logError('boot_failed', { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
