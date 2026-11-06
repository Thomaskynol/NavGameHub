# Relatório de validação

Projeto: Catan multijogador 3–4 pt-BR (cliente React+Vite, servidor Node+Socket.IO autoritativo, SQLite `node:sqlite`, motor de regras puro em `src/engine`).

Data da última verificação completa: 2026-10-15.

## 1. Evidências de verificação (estado final)

| Comando | Resultado | Exit code |
|---|---|---|
| `npm test` | 19 arquivos, **130/130 testes passando** (motor, servidor/integração, geometria do cliente) | 0 |
| `npx tsc --noEmit` | `No errors found` (src, tests e e2e) | 0 |
| `npx eslint .` | `No issues found` | 0 |
| `npm run build` | typecheck + Vite build (86 módulos) + esbuild `dist/server.mjs` | 0 |
| `npm run test:e2e` | Playwright **4/4 specs** (~22s com build; servidor production em :4173 com `CATAN_TEST_HOOKS=1`) | 0 |

Reprodutibilidade: execuções repetidas do e2e verdes (5+ seguidas).

## 2. Cobertura dos testes

### 2.1 Motor (`tests/engine/**`)
- Topologia: ilha 54 vértices / 72 arestas / 19 hexes; portos 9 em arestas costeiras.
- Mapa por seed: determinístico, sem 6/8 adjacentes.
- Setup snake (ida e volta), recursos do 2º assentamento.
- Produção com escassez (2+ beneficiários com banco insuficiente → ninguém; 1 beneficiário → mínimo).
- 7: descarte `floor(n/2)`, ladrão obrigatório, mudança de hex, vítima, roubo.
- Trocas: banco 4:1, portos 3:1/2:1, taxa pelo recurso entregue (lotes homogêneos).
- Dev cards: cavaleiro, construção de estradas (fim antecipado <2 locais), monopólio, fartura (banco esgotado), VP na compra, `boughtThisTurn`/1 ação por turno.
- Maior estrada (DFS sem repetir aresta, bloqueio adversário, empate) e maior exército.
- Vitória aos 10 pontos.

### 2.2 Servidor (`tests/server/**`)
- Salas: criação/código/entrada/cores/prontidão/host/kick.
- `bind_session` resume/takeover/claim + `SESSION_CONFLICT`.
- Fila por sala, idempotência (`requestId`+hash), `baseVersion` → `STALE_VERSION`.
- Transação SQLite antes de ack; `fullgame.test.ts` joga partida real do setup à vitória e valida persistência após restart.
- Projeções sem vazamento de mão/dev cards alheios; histórico `renderHistoryEvent` pt-BR.
- Test hooks (`force_next_dice`, `seed_rng`, `load_near_win_fixture`) só com `CATAN_TEST_HOOKS=1`.

### 2.3 E2E (`e2e/game.spec.ts`, 3 abas)
1. Lobby com 3 abas no mesmo contexto: cores, prontidão, início da partida, tabuleiro visível nas 3.
2. Partida completa pela UI: setup snake (12 colocações), dados, troca marítima modal, carta dev, 7 forçado → descarte → ladrão/roubo, fixture de vitória → construção → tela **Vitória!** nas 3 abas.
3. Sessão em 2º contexto: conflito de sessão → takeover → reload com resume.
4. Chat entre abas, código de sala inválido → erro, screenshots (`screenshots/{home,lobby,jogo,resultado}.png`).

## 3. Auditoria de qualidade

- Revisão independente (`code-reviewer`) sobre regras/autoridade/projeções/segurança: 12 achados (1 bloqueante, 1 alto, 5 médio, 5 baixo). **Todos corrigidos** (commits na mesma sessão de trabalho):
  - bloqueante: rehydrate do cliente congelava hints de setup/ladrão/estradas gratuitas → `GameView` agora expõe `setupQueue`/`setupPos`/`setupLastSettlementVertex` + `pending` completo;
  - taxa marítima valida lotes homogêneos pelo recurso entregue (decisão clássica, registrado em `docs/rules.md` §4);
  - `bind_session` passou a fazer broadcast de estado; rate limit de lobby; dev cards pré-roll liberados na UI conforme regra; produção sem destinatário-fantasma; docs; `lastRoll`/`PAYLOAD_LIMITS` mortos removidos; `baseVersion` obrigatório em `cmd`; transição lobby→jogo por `phase`.
- Bug latente de geometria (associação hex↔vértice espelhada, 240 divergências em 5 seeds) encontrado pelo e2e, corrigido na raiz (`axialToCube(q, r)`) + 9 testes de regressão (`tests/client/geometry.test.ts`) — agora 0 divergências em 7 seeds.
- Oracle de arquitetura indisponível no ambiente (2 falhas de tier) → substituído pela auditoria acima.

## 4. Screenshots

`screenshots/`: `home.png`, `lobby.png`, `jogo.png`, `resultado.png` (gerados pela suíte e2e).

## 5. Limitações conhecidas

1. Sem tempo por turno (decisão de design, `docs/rules.md` §4.4).
2. Variantes oficiais (barcos, cartas de progresso, 5-6 jogadores, confisco) fora de escopo.
3. Conexão com dispositivo móvel não testada em emulador real (responsividade CSS presente; e2e em 1366×768).
4. Fases `dev_monopoly`/`dev_year_of_plenty` são inalcançáveis: monopólio/fartura resolvem atomicamente na jogada (comportamento correto, fases residuais no tipo).
5. Suíte de e2e: 4 specs serial; não cobre todos os caminhos de erro de rede (ex.: drop no meio de um ack).
6. Backup/restauração SQLite documentado (`docs/persistence.md`) mas sem teste automatizado de restauração a partir de backup.
