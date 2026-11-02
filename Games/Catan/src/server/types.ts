// Tipos compartilhados do servidor.
export interface ServerConfig {
  nodeEnv: 'production' | 'development';
  port: number;
  host: string;
  dbPath: string;
  /** Origem permitida para CORS; null = mesma origem. */
  allowedOrigin: string | null;
  /** Hooks de teste (CATAN_TEST_HOOKS=1) — nunca ativos em produção normal. */
  testHooks: boolean;
  /** Segredo do Hub (HUB_SECRET); sem ele, /__hub/* responde 403. */
  hubSecret?: string;
  /** Hooks de teste do Hub (HUB_TEST_HOOKS=1). */
  hubTestHooks?: boolean;
}
