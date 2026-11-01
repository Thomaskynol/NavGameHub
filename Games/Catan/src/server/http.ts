// HTTP + Socket.IO no mesmo servidor. Em produção serve dist/client com SPA fallback.
import express, { type Express } from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { join, resolve } from 'node:path';
import { Server as IOServer } from 'socket.io';
import type { AppContext, AppIo } from './handlers';
import { attachSocket, closeHubRoom, forceHubWin } from './handlers';
import { openDb, roomCodeExists } from './db';
import { logInfo } from './log';
import { Store } from './rooms';
import { MAX_PLAYERS } from '../shared/constants';
import type { ServerConfig } from './types';
import type { GameEngineApi } from './engine';

export interface App {
  ctx: AppContext;
  httpServer: HttpServer;
  /** Escuta e resolve com a porta efetiva (útil com PORT=0 em testes). */
  start(): Promise<number>;
  stop(): Promise<void>;
}

function buildExpress(config: ServerConfig): Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.allowedOrigin) {
    app.use((req, res, next) => {
      res.setHeader('access-control-allow-origin', config.allowedOrigin as string);
      res.setHeader('vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  if (config.nodeEnv === 'production') {
    const clientDir = resolve(process.cwd(), 'dist/client');
    app.use(
      express.static(clientDir, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.includes('/assets/')) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
          else res.setHeader('cache-control', 'no-cache');
        },
      }),
    );
  }
  return app;
}

// SPA fallback por último: após as rotas /__hub/* (senão o catch-all engole GET /__hub/state em produção).
function attachSpaFallback(app: Express, config: ServerConfig): void {
  if (config.nodeEnv !== 'production') return;
  const clientDir = resolve(process.cwd(), 'dist/client');
  app.get('*', (_req, res) => {
    res.setHeader('cache-control', 'no-cache');
    res.sendFile(join(clientDir, 'index.html'));
  });
}

// ---------- Hub (hub/PROTOCOLO.md): estado, fechamento e hooks de teste ----------

type HubPhase = 'lobby' | 'playing' | 'results';

function hubPhaseOf(room: { state: { phase: string } | null; phase: string }): HubPhase {
  if (room.state === null && room.phase === 'lobby') return 'lobby';
  if (room.phase === 'game_over') return 'results';
  return 'playing';
}

function attachHubRoutes(app: Express, ctx: AppContext): void {
  const hubSecret = ctx.config.hubSecret ?? process.env.HUB_SECRET ?? '';
  const hubTestHooks = ctx.config.hubTestHooks ?? process.env.HUB_TEST_HOOKS === '1';

  const guard = (req: express.Request, res: express.Response): boolean => {
    if (!hubSecret || req.header('x-hub-secret') !== hubSecret) {
      res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      return false;
    }
    return true;
  };
  const roomParam = (req: express.Request): string => String(req.query.room ?? '').toUpperCase().trim();

  app.get('/__hub/state', (req, res) => {
    if (!guard(req, res)) return;
    const code = roomParam(req);
    const room = ctx.store.getOpenRoom(code);
    if (!room) {
      // Histórico preservado bloqueia reutilização (rooms com closed=1 ou
      // qualquer linha com o código): 409 CODE_TAKEN para o Hub tentar outro
      // código. Livre de verdade (sem linha) => 404. Nunca mandar o grupo
      // para sala alheia: 409 não é "livre".
      // Escolha documentada (Lane A): state distingue livre (404) × bloqueado
      // (409) em vez de create→Hub confiável — preserva independência do Catan
      // (legado sem Hub segue igual) e evita feedback do cliente.
      let blocked = false;
      try {
        blocked = roomCodeExists(ctx.db, code);
      } catch {
        // Erro de leitura do banco NÃO é CODE_TAKEN: 500 para o Hub tolerar
        // como transitório (retry até o prazo) em vez de pular código à toa.
        res.status(500).json({ ok: false, error: 'INTERNAL' });
        return;
      }
      if (blocked) {
        res.status(409).json({ ok: false, error: 'CODE_TAKEN' });
        return;
      }
      res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      return;
    }
    res.json({
      ok: true,
      room: {
        code: room.code,
        phase: hubPhaseOf(room),
        players: room.members.size,
        capacity: MAX_PLAYERS,
        joinable: room.state === null && room.phase === 'lobby',
        // Dono da instância (htok do launch); null = sem dono/legado.
        hubOwner: room.hubToken === '' ? null : room.hubToken,
      },
    });
  });

  app.post('/__hub/close', (req, res) => {
    if (!guard(req, res)) return;
    // htok: dono da instância (query ?htok=). Com dono, só fecha se conferir;
    // divergente/ausente => 403 FORBIDDEN e a sala segue intacta. Sem dono
    // (legado): só fecha sem htok; COM htok => 403 preserva (tardio de outra
    // partida). Inexistente => 200 idempotente {ok:true, closed:false}.
    // Contrato-alvo (Lane A+C): sucesso/inexistente => 200 {ok:true, closed};
    // proibido => 403 (409 reservado a state bloqueado); Hub trata 200 como
    // confirmado sem retry e 403 como notMine sem retry.
    const htok = typeof req.query.htok === 'string' ? req.query.htok : undefined;
    const result = closeHubRoom(ctx, roomParam(req), htok);
    if (!result.ok) {
      res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      return;
    }
    res.json({ ok: true, closed: result.closed });
  });

  // Contrato: POST /__hub/test/win (Catan). Aceita /__hub/test/finish como alias.
  const testWin = (req: express.Request, res: express.Response): void => {
    if (!guard(req, res)) return;
    if (!hubTestHooks) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      return;
    }
    if (!forceHubWin(ctx, roomParam(req))) {
      res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      return;
    }
    res.json({ ok: true });
  };
  app.post('/__hub/test/win', testWin);
  app.post('/__hub/test/finish', testWin);
}

export function createApp(opts: { config: ServerConfig; engine: GameEngineApi }): App {
  const { config, engine } = opts;
  const app = buildExpress(config);
  const httpServer = createServer(app);
  // allowRequest: mesma origem por padrão; com ALLOWED_ORIGIN, só a origem configurada.
  const io: AppIo = new IOServer(httpServer, {
    cors: { origin: config.allowedOrigin ?? true, credentials: false },
    maxHttpBufferSize: 200_000,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (!origin) {
        callback(null, true); // clientes nativos/testes sem Origin
        return;
      }
      const allowed = config.allowedOrigin ?? `http://${req.headers.host ?? ''}`;
      callback(null, origin === allowed);
    },
  });
  const db = openDb(config.dbPath);
  const store = Store.load(db);
  const ctx: AppContext = {
    config,
    db,
    store,
    engine,
    io,
    sessions: new Map(),
    queues: new Map(),
    chatRate: new Map(),
  };
  attachSocket(ctx);
  attachHubRoutes(app, ctx);
  attachSpaFallback(app, config);
  return {
    ctx,
    httpServer,
    start(): Promise<number> {
      return new Promise((resolveStart, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(config.port, config.host, () => {
          const address = httpServer.address();
          const port = typeof address === 'object' && address ? address.port : config.port;
          logInfo('listening', { host: config.host, port, env: config.nodeEnv, testHooks: config.testHooks });
          resolveStart(port);
        });
      });
    },
    async stop(): Promise<void> {
      // io.close() também fecha o http server embutido.
      await new Promise<void>((resolveStop) => {
        io.close(() => resolveStop());
      });
      await new Promise<void>((resolveStop) => {
        httpServer.close(() => resolveStop()); // noop se já fechado
      });
      db.close();
    },
  };
}
