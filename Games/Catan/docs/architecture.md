# Arquitetura — Catan Deluxe (independente, não oficial)

## Layout do projeto (monopacote TypeScript)

```
src/shared/    # contratos: constantes, tipos de estado, protocolo, validação runtime
src/engine/    # motor de regras PURO (sem io/rede/banco); testável isolado
src/server/    # autoridade: HTTP + Socket.IO, salas, identidade, persistência, projeções
src/client/    # React + Vite: UI, tabuleiro SVG, áudio, tutorial
tests/         # vitest: tests/engine/**, tests/server/**
e2e/           # Playwright: múltiplas abas/contextos
docs/          # rules.md, architecture.md (este arquivo), protocol.md, persistence.md
```

Camadas (dependência só para baixo):
`client -> shared <- server -> engine -> shared`

## API pública do motor (CONTRATO — não quebrar)

`src/engine/index.ts` exporta exatamente:

```ts
import type { GameState, RandomSource, BoardLayout } from '../shared/types';
import type { GameCommand } from '../shared/protocol';
import type { PlayerColor, PlayerId, ResourceKind, VertexId, EdgeId, HexId } from '../shared/constants';

/** Mapa determinístico a partir da seed (apenas o tabuleiro; nunca usa a RNG de dados/baralho). */
export function generateBoard(boardSeed: string): BoardLayout;

/** Cria estado inicial: fase setup_settlement, fila snake na ordem do array, ladrão no deserto. */
export function createGame(opts: {
  players: { id: PlayerId; name: string; color: PlayerColor }[]; // 3–4; ordem do array = ordem de turno
  boardSeed: string;
  rng: RandomSource; // usada por applyCommand para dados/baralho/roubo
}): GameState;

/** Transição pura. NUNCA muta a entrada. Erro => { ok:false, error } sem efeitos parciais. */
export function applyCommand(
  state: GameState,
  playerId: PlayerId,
  cmd: GameCommand,
  deps: { rng: RandomSource },
): EngineResult;

/** Longest road: DFS de caminho simples nas estradas do jogador; edifícios adversários bloqueiam passagem (não chegada). */
export function computeLongestRoad(state: GameState, playerId: PlayerId): number;

export function publicVictoryPoints(state: GameState, playerId: PlayerId): number; // construções + títulos
export function totalVictoryPoints(state: GameState, playerId: PlayerId): number;   // + pontos ocultos de VP
export function bestBankRate(state: GameState, playerId: PlayerId, resource: ResourceKind): 2 | 3 | 4;

/** Auxiliares para UI (destaques legais). Incluem contexto: preparação, construção normal, estradas gratuitas. */
export function legalBuildTargets(state: GameState, playerId: PlayerId): {
  settlementVertices: VertexId[];
  cityVertices: VertexId[];
  roadEdges: EdgeId[];          // inclui estradas gratuitas quando fase dev_road_building
  freeRoadEdges: EdgeId[];      // só estradas gratuitas restantes
  setupVertices: VertexId[];
  setupEdges: EdgeId[];
};
export function legalRobberHexes(state: GameState, playerId: PlayerId): HexId[];
export function robberVictims(state: GameState, hexId: HexId, byPlayerId: PlayerId): PlayerId[];
```

Invariantes do motor (testes obrigatórios):
- Recursos nunca negativos; conservação por tipo entre banco + mãos (trocas/descartes/monopólio/fartura/produção respeitam o total do sistema).
- Dev cards: só 25 instâncias; nenhuma duplicada/desaparecida fora das transições previstas.
- Estoque de peças consistente (15/5/4).
- 54 vértices, 72 arestas, 19 hexes; identidade por strings inteiras (sem float).
- Comandos fora de fase ou após game_over sempre rejeitados.

## Concorrência e idempotência (servidor)

- Fila de mutação POR SALA (promise-chain): mutações nunca intercalam.
- `requestId` idempotente persistido (tabela `processed_commands`) com hash do payload:
  - igual => devolve resposta armazenada, sem novo efeito;
  - payload diferente => REQUEST_CONFLICT.
- `baseVersion` do cliente deve bater com `state.version`; divergência => STALE_VERSION + visão atual.
- Transição + snapshot + comando processado gravados em UMA transação SQLite antes do ack/broadcast.
- Chat/lobby não alteram `state.version`.

## Identidade e sessão (por aba)

- `create_room`/`join_room` criam jogador com `recoveryCode` (32 bytes aleatórios, base64url). Servidor guarda apenas SHA-256.
- Cliente guarda em `sessionStorage` por sala: chave `catan:room:<CÓDIGO>` = `{ playerId, recoveryCode, ... }`. `localStorage` só preferências (áudio).
- Bind de socket: `bind_session` com `mode`:
  - `resume`: assume se ninguém detém; se outro socket ativo detém => `bind_conflict` (cliente oferece "recuperar controle" explícito ou "entrar como novo").
  - `takeover`: assume explícita; socket anterior recebe `session_replaced` e perde o controle.
  - `claim`: recuperação por código colado (novo navegador/aba).
- Um socket = no máximo um jogador numa sala. Comandos validados contra o jogador vinculado.
- Reconexão reenvia a projeção completa; requestId já processado não re-executa efeitos.

## Projeções (nunca estado interno completo)

- `GameView` (público) vs `YouView` (mão de recursos, tipos das dev cards, VP real, taxa de banco).
- Servidor monta: `buildGameView(state, room, youId)`. Deck/baralho/credenciais nunca saem do servidor.
- Roubo: tipo da carta transferida só em evento privado para envolvidos.
- Histórico: eventos privados filtrados por audiência antes de virar texto.

## Aleatoriedade

- Dados, ordem do baralho e vítima/roubo: RNG criptográfica do servidor (`crypto`), injetada no motor como `RandomSource`.
- Seed do tabuleiro: string pública, PRNG próprio determinístico (mulberry32+hash), SEM relação com a RNG secreta.

## Persistência

- `node:sqlite` (DatabaseSync). Banco em `DB_PATH` (default `db/catan.db`).
- Tabelas: `rooms` (snapshot JSON do estado do jogo + metadados), `members` (hash de recuperação), `processed_commands` (idempotência), `chat` (limite por sala).
- Transições atômicas (transaction). Boot: carrega todas as salas abertas, presença inicia desconectada.
- Migração inicial: `PRAGMA user_version` + tabela `meta`. Detalhes em docs/persistence.md.

## Fases e pendências

Fases em `shared/types.ts`. Pendências em `state.pending`. Dev card pré-dados usa `returnPhase`. Nenhuma ação nova é aceita enquanto houver pendência obrigatória de outro jogador (exceto as da própria pendência).

## Testes

- Motor: `tests/engine/**` (vitest) — cobre invariantes e fluxos da §15 do briefing.
- Servidor: `tests/server/**` — salas, auth, idempotência, concorrência, projeções, restart/restore.
- Harness de partida completa: `tests/server/fullgame.test.ts` — joga partida real via `applyCommand` + fila do servidor com RNG determinística.
- E2E: `e2e/**` Playwright, 3 páginas no mesmo contexto + contextos separados; servidor de produção com `CATAN_TEST_HOOKS=1` (hooks inacessíveis sem a env; produção normal não define).
