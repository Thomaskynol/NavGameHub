# CONTINUAR — checkpoint de pausa (2026-11-05)

Documento de retomada da revisão/correção do NET WARS. Leia isto primeiro ao voltar.
Tudo abaixo foi **verificado por execução real** neste checkout (comandos citados).

---

## 0. Estado do checkout (o que é e o que não é)

- **NÃO é repositório git** (`git status` falha): não há como fazer `git diff`,
  commit, push ou PR. O estado é o conjunto de arquivos na pasta, com timestamps.
  - Arquivos alterados nesta revisão (2026-11-05): `shared/orient.js` (novo),
    `shared/physics.js` (novo), `shared/constants.js`, `shared/protocol.js`,
    `server/room.js`, `tests/room.test.js`, `tests/arena.test.js`,
    `tests/review-fix.test.js` e este documento.
  - Arquivos **ainda intocados** nesta revisão (mtime 2026-11-02/03 = original do ZIP):
    `server/main.js`, `client/*.js`, `index.html`, `README.md`,
    `INTEGRACAO_GAME_HUB.md`, `tests/ws-check.mjs`, `docs/*` (exceto este).
- Ambiente: Linux, Node **v22.14.0**, npm 10.9.2, único dep `ws@^8` em `node_modules`.
  `google-chrome` e `firefox` em `/usr/bin`. npm tem rede (verificado com
  `npm view playwright version` → 1.64.1). **Playwright NÃO está instalado** (ver §5).
- Offline em runtime: nenhum `http(s)://` em `client/ server/ shared/ index.html`
  (requisito preservado; conferir com grep ao final).

## 1. Resultado REAL dos testes neste checkpoint

Executado agora, sem simulação:

| Comando | Exit | Resultado |
|---|---|---|
| `npm test` | **0** | `# tests 26 · # pass 26 · # fail 0` |
| `node tests/ws-check.mjs` | **0** | `26 PASS · 0 FAIL · WS-CHECK OK` |

**As duas suítes passam 26/26.** Importante: isso **não** significa jogo completo.
O servidor ainda não inicia partida (§4, item A) — as suítes unitárias passam porque
os setups agora chamam `r.start()` explicitamente, e o ws-check não depende de a
partida rodar (só salas/hub/estática).

Baseline da revisão anterior (para comparação): `npm test` 26/26 e ws-check 26/26,
ambos com lacunas conhecidas; 2 crashes reproduzidos no `server/main.js` (ainda
preservados, ver §4).

## 2. O que já foi FEITO (com decisões de design)

### 2.1 `shared/orient.js` (NOVO — geometria pura de orientação)
Exporta: `TAU, wrapPi, forward, quatFromEuler, quatMul, quatAxis, rotateVec,
eulerFromQuat, applyMouseTurn, normalizeAngles`.
- `forward(yaw,pitch)` = nariz (fonte única p/ servidor+cliente; `server/room.js`
  re-exporta `forward` p/ compat com quem já importava de lá).
- `eulerFromQuat` usa canônico **YXZ** com tratamento de polos.
- `applyMouseTurn(q, dxPx, dyPx, k)`: giro **local relativo à nave** (quaternion),
  p/ FP sem cursor virtual e sem drift.

### 2.2 `shared/physics.js` (NOVO — colisão/raio/util)
Exporta: `obstacles, segSphereT, segHitsSphere, pushOutOfObstacles,
freeDistAlongRay, distToBound, expLerp`.
- `segSphereT` devolve o **primeiro t ≥ 0** do segmento na esfera (ou `null`);
  `pushOutOfObstacles` trata `d === 0` com normal fixa (sem NaN).
- `expLerp(a,b,dt,rate)` = suavização independente de FPS (p/ câmera).

### 2.3 `shared/constants.js`
- Novos: `FP_EYE_BACK(0.6), TP_CAM_DIST(12.5), TP_SHIP_DROP(1.25), CAM_MARGIN(1.5),
  FP_RAD_PER_PX(0.0022), MOUSE_PX_CLAMP(400)` (câmera), `MAX_ROOMS(512),
  MAX_WS_PAYLOAD(65536), MAX_HTTP_BODY(8192), INPUT_MIN_MS(15), HELLO_MIN_MS(100),
  WS_BACKPRESSURE_SKIP(4MB), WS_BACKPRESSURE_KILL(16MB)` (rede/limites).
- **Atenção:** `FP_YAW_RATE`/`FP_PITCH_RATE` foram removidos e depois **restaurados
  como TEMP** (3.4 rad/s, comentado) porque `client/input.js` ainda os importa —
  sem eles o módulo inteiro do cliente falhava no import (verificado: import quebrava).
  **Remover quando `client/input.js` migrar p/ `applyMouseTurn`.**

### 2.4 `shared/protocol.js`
- `MSG` ganhou `START:'start'`, `READY:'ready'`, `SHUFFLE:'shuffle'`.
- Guardas `typeof m === 'object' && !Array.isArray(m)` em todos os validadores.
- `ang()` limita `|v| ≤ 1e4` em yaw/pitch/roll (normalização 2π é do servidor).
- Novos: `validStart(m)`, `validReady(m)` (`bit(m.v)`), `validShuffle(m)`.

### 2.5 `server/room.js` (o grosso — concluído e testado)
- **Lobby autoritativo:** `constructor` nasce com `state='lobby'`, `endsAt=null`.
  `tick()` retorna `[]` se `state !== 'playing'` (sem simulação/timer/waves no hangar).
- **`start(now)`**: só de lobby → `playing`, `over=false`, `overSent=false`,
  `result=null`, `wave=0`, `endsAt = now + matchLenS*1000` (survival → `null`),
  proteção inicial nos vivos. Retorna `false` se já saiu do lobby (idempotente).
- **`setReady(id,v)`**: só lobby, só humano vivo; grava `ship.ready`.
- **`shuffleTeams()`**: só `mode==='teams'` + lobby + ≥2 humanos; embaralha e
  alterna red/blue (|Δ| ≤ 1). Retorna `false` nos casos recusados.
- **`reset()` (revanche)**: limpa projéteis/inputs/`leftScores`, zera naves
  (kills/deaths/ready), spawns válidos e vai **direto p/ `playing`**.
- **`spawnPos(cx,cy,cz,spread,minSep)`**: 48 tentativas aleatórias + fallback
  determinístico em espiral (64 anéis × 16 × 5 alturas) + clamp final → sempre
  dentro da arena, fora dos obstáculos e separado das naves. Usado em `join`,
  `reset`, `spawnWave` e respawn de `tickShip`.
- **`mkResumeToken()`**: `crypto.randomBytes(24).base64url` (não `Math.random`).
- **`scores()`**: agora inclui **`deaths`** e **`leftScores`** (quem saiu mantém
  kills/deaths; `left:true`) e times somam kills de todos incl. saídos.
  Fantasmas (`goneAt`) continuam fora.
- **`snapshot()`**: ganhou campo **`ready`** por nave (`!!s.ready || undefined`).
  Continua sem `resumeToken`/`htok` e sem fantasmas.
- **`damage()`**: incrementa `victim.deaths` (fonte de verdade p/ placar/HUD).
- **`leave()`**: grava `leftScores` (sair não muda vencedor).
- **`purge()`**: usa `this.reconnectS` (override por opts, p/ teste).
- **`tickProjectiles()` reescrito** com `firstImpactAfter(px,py,pz,nx,ny,nz,lastT,
  shipR,ownerId,now)`: impacto **ordenado por t** no segmento; pula protegidos e
  aliados (FF off) e **continua** até achar dano real ou obstáculo → laser/míssil
  atravessa aliado e ainda acerta quem está atrás no mesmo trecho; remove projéteis
  de fantasma; míssil perde lock com obstrução (`losBlocked`).
- **`tickCollisions()`**: `d===0` tratado (obstáculo e nave×nave) sem NaN; cenário
  empurra p/ fora e causa dano 2–5 com cooldown; nave×nave só afasta.
- **`tickBot()`**: clamp de `WORLD_BOUND`; **`tickShip()`**: normaliza ângulos
  (`normalizeAngles`) e usa respawn via `spawnPos`.
- Imports locais antigos (`segHitsSphere`/`OBSTACLES` manuais) removidos — vêm de
  `shared/physics.js`.

## 3. O que foi alterado nos TESTES (e por quê)

Só **adicionamos `r.start()` nos setups** (a sala agora nasce em lobby; sem start,
`tick()` não simula e os testes antigos morriam em falso). **Nenhuma asserção foi
removida ou enfraquecida** — as 26 verificações originais seguem intactas.

- `tests/room.test.js`: `r.start()` nos 3 testes (timer ×2, laser).
- `tests/arena.test.js`: `r.start()` no helper `duel()` e nos testes teams,
  power-ups, boost, FFA timer, survival ×2.
- `tests/review-fix.test.js`: `r.start()` em "derrota encerra", "laser bloqueado"
  e "disconnect limpa projéteis" (sem start o tick de lobby **enganaria** o teste
  de "hit ignorado").
- `tests/ws-check.mjs`: **inalterado**.

## 4. O que FALTA (ordem de execução recomendada)

### A. `server/main.js` — CRÍTICO (o jogo hoje **não começa partida**)
Verificado com servidor real (PORT=18099): após hello+input, snapshot fica
`state=lobby` e a nave não anda. **Nada chama `room.start()`** (grep confirma:
nenhuma chamada `.start()` fora de áudio). Falta:
1. Guard de mensagem **antes** de `m.t`: `if (!m || typeof m !== 'object' || Array.isArray(m)) return;`
   (hoje `JSON.parse('null')` → `m.t` em `null` = **TypeError, crash nº 1**, linha ~134).
2. `try/catch` em volta do handler de mensagem (1 crash não mata o processo).
3. `ws.on('error')` + erro de socket (evita `unhandled error`).
4. `new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD })`.
5. `decodeURIComponent(url.pathname)` e `new URL(req.url, …)` em try/catch → **400**
   (hoje `%zz` → **URIError, crash nº 2**, linha ~38).
6. Métodos estáticos só `GET`/`HEAD` → senão **405**; corpo HTTP > `MAX_HTTP_BODY`
   → **413**; corpo limitado também no `/__hub/close`.
7. Close do Hub com JSON **estrito**: `room` precisa ser **string**; JSON inválido ou
   `room` ausente → **400** (sem `'*'` implícito); `{"room":"*"}` **explícito** segue
   fechando tudo (contrato com `INTEGRACAO_GAME_HUB.md` §7). Manter 403/404/
   idempotência atuais.
8. Backpressure: se `ws.bufferedAmount > WS_BACKPRESSURE_SKIP` não manda snapshot;
   `> WS_BACKPRESSURE_KILL` → `ws.terminate()`.
9. Cap de salas: `getRoom` recusa com `deny(ws,'full')` quando `rooms.size >= MAX_ROOMS`.
10. Rate limits por socket: `INPUT_MIN_MS` entre inputs, `HELLO_MIN_MS` entre HELLOs
    (guardar `ws.lastInputAt`/`ws.lastHelloAt`).
11. **Rotear as mensagens novas**: `MSG.START` → `room.start()` só se `ws.id === room.hostId`
    (e só lobby; retorno falso = ignora); `MSG.READY` → `validReady` + `room.setReady`;
    `MSG.SHUFFLE` → `validShuffle` + host + lobby + teams + `room.shuffleTeams()`.
    Broadcast do snapshot/evento p/ todos (ex.: `{t:'event',kind:'lobby'}` ou o próprio
    snapshot) p/ o cliente atualizar.
12. Log da **porta real**: `server.address().port` (hoje `PORT=0` loga `:0`).
13. Passar `reconnectS` via env (`RECONNECT_S`) nas `new Room(...)` p/ teste de expiração.
14. `rematch` atual: `if (!room.over && ws.id !== room.hostId) return; room.reset();`
    — com lobby, decidir: host também pode dar start por rematch? Manter como está
    (reset = revanche) e usar START para a primeira partida.

### B. `client/input.js` — FP direto + pointer lock
- FP: mouse gira a nave **por evento** com `applyMouseTurn(q, dxPx, dyPx, k)`
  (`k = FP_RAD_PER_PX * sens`, clamp `MOUSE_PX_CLAMP`), **sem** cursor virtual/`cx,cy`
  em FP; esconder cursor `○` no FP (só retícula `✛`).
- TP: mantém cursor ○ (joystick virtual) com `TP_YAW_RATE/TP_PITCH_RATE` + bank.
- Gate `st.active` (não virar enquanto não estiver na partida).
- Pointer lock: **clique que captura não dispara tiro** (se não estava locked,
  só lock; se já locked, aí sim `firing`); fallback `freeAim` em
  `pointerlockerror`/rejeição do promise (jogo continua jogável sem lock).
- Envio: angulos normalizados (`wrapPi`) no modo TP; `thr` só TP (como hoje).
- **Remover `FP_YAW_RATE/FP_PITCH_RATE` do import e do constants.js** nessa etapa.

### C. `client/render.js` — câmera sobre a linha de tiro
- FP: olho em `FP_EYE_BACK` **atrás da origem sobre o eixo do nariz** (usa
  `shared/physics.js` p/ colisão), olhando **paralelo** ao nariz → centro da tela =
  linha de tiro em qualquer distância/obstáculo (não supor convergência).
- TP: distância `TP_CAM_DIST` com suavização `expLerp` (posição e up,
  independente de FPS), colisão do offset via `freeDistAlongRay`/`distToBound`
  (hoje usa `pointBlocked` local passo-a-passo), **nave própria deslocada
  `TP_SHIP_DROP` p/ baixo** (só visual) p/ não cobrir a mira.
- Ângulos locais do mouse sempre que possível (`local.yaw` já existe).

### D. `client/net.js` — timers e API nova
- Limpar `timer`/`pingTimer` **no `onclose`** (hoje só em `close()`; reconexão
  quebra pode deixar timer órfão).
- Expôr `start()`, `ready(v)`, `shuffle()` enviando `MSG.START/READY/SHUFFLE`.
- Guard de geração (evitar que socket antigo escreva em estado novo).
- URL: usar `wss:` quando `location.protocol === 'https:'`.

### E. `client/main.js` — fluxo lobby/ready/start + robustez
- Enviar `ready` (hoje `ready` é só visual, `l-ready` toggle local), enviar
  `start` ao clicar `l-start` (host) e `shuffle` no `l-shuffle` (hoje é "visual",
  só toast — precisa mandar `MSG.SHUFFLE`).
- `l-start`/estado do lobby devem reagir a `snapshot.state` (`lobby|playing|over`)
  e a `ship.ready` dos outros; `waiting` sincronizado do snapshot (`waitNext`).
- Reconexão limitada (**3 tentativas**, backoff), sem timers duplicados
  (hoje `startConn()` chama `conn?.close()` — ok, manter; não reaproveitar
  hooks de geração antiga).
- `onGameOver` **idempotente por chave** usando `m.result` do servidor
  (hoje depende de `m._announced` flag no objeto de snapshot; evento `over` e
  snapshot podem chegar duplicados).
- Evento `rematch` do servidor deve **levar todos à partida** (hoje só
  `hud.resetMatch()` + toast; `btn-rematch` faz `inMatch=true` só p/ quem clicou).
- Áudio de tiro com gate local (cooldown/arma) p/ não tocar em rajada falsa
  (hoje `onFired` toca a cada envio com `fire`).
- Predição: aplicar `pushOutOfObstacles` no `pred` (hoje só clamp de `WORLD_BOUND`).

### F. `client/hud.js` + textos
- Morte/respawn via **servidor** (`respawnIn`/`deaths` no snapshot já existem);
  hoje conta mortes localmente via eventos (`deaths{}`) e usa `deathAt` local.
- Trocar "servidor não envia deaths" (comentário linha 28) p/ campo do snapshot.
- `index.html`/`README.md`/`INTEGRACAO_GAME_HUB.md`: descrever lobby/ready/start,
  novas mensagens do protocolo, e a mudança de close 400 (JSON estrito).

### G. Testes novos (obrigatórios p/ fechar)
- Unit: `shared/orient.js` (wrap/quat/applyMouseTurn/eulerFromQuat polos),
  `shared/physics.js` (segSphereT, push d===0, expLerp), lobby (`start/setReady/
  shuffle/reset`), `spawnPos` (nunca dentro de obstáculo/sobreposta), colisão
  ordenada (aliado atravessa e alvo atrás leva dano), `scores` com `leftScores`.
- Integração HTTP/WS com **processo real** (`PORT=0`): crash nº 1/2 (JSON `null`,
  `%zz` → 400 e processo vivo), 405/413, close 400/`*` explícito, rate limit,
  `MAX_ROOMS`, backpressure (simular `bufferedAmount`), START/READY/SHUFFLE
  autoritativo (não-host é ignorado).
- **E2E browser** (Playwright): ver §5.

## 5. E2E de navegador (pendente — decidido, não executado)

- Decisão: Playwright com Chrome do sistema (`channel: 'chrome'` → `/usr/bin/google-chrome`),
  tentar `npx playwright install firefox` como 2º navegador; **offline após
  preparação** (instalar 1x com rede).
- `playwright` ainda **não está em `package.json`** nem em `node_modules` — instalar
  (`npm i -D playwright`) antes de escrever o teste.
- Pointer lock **real** não existe em headless → usar init script que simula
  `requestPointerLock`/`pointerlockchange` e marcar o resultado como
  **validação simulada** (separar de validação humana, exigência do pedido).
- Cobertura mínima: menu → criar sala → lobby → start (host) → partida roda
  (nave anda, snapshot `state=playing`) → placar → over → rematch; mais regressão
  dos 2 crashes via requisição malformada.
- Referência histórica: `docs/VALIDACAO.md` cita suíte CDP antiga em
  `/tmp/opencode/...` **não incluída no ZIP** — não confiar nela como reproduzível.

## 6. Contratos que NÃO podem quebrar

- **Game Hub** (`INTEGRACAO_GAME_HUB.md`): `GET /__hub/state` (sem auth);
  `POST /__hub/close` com header `x-hub-secret`; corpo `{"room":"nome"}` ou
  `{"room":"*"}` **explícito**; 403 sem secret, 404 sala inexistente, 200
  `{"closed":[...]}` idempotente. (A mudança p/ 400 em JSON inválido/`room`
  ausente precisa ser documentada nesse arquivo.)
- **3 modos** `ffa|teams|survival`, multiplayer LAN, execução
  `node server/main.js` (env `HOST/PORT/MATCH_LEN_S/HUB_SECRET`, porta 8080),
  offline após preparação, `npm test` + `node tests/ws-check.mjs` verdes.
- **Nunca** remover/enfraquecer verificação existente; nunca depender de `/tmp`
  nem de recursos externos em runtime; sem push/PR (não é git).

## 7. Comandos de verificação (rodar ao final de qualquer sessão)

```bash
cd /media/aluno/pendrive-thomas-120gb/Projetos/games_vibe_coded/net_wars
npm test                      # esperado: 26+ pass, 0 fail, exit 0
node tests/ws-check.mjs       # esperado: N PASS, 0 FAIL, exit 0
node --check server/*.js client/*.js shared/*.js   # sintaxe
grep -rn "https\?://" client/ server/ shared/ index.html   # deve ser vazio
```

Última execução neste checkpoint: `npm test` **26/26 exit 0**;
`ws-check` **26 PASS/0 FAIL exit 0**; `node --check` OK em todos.

## 8. Pendências de decisão (confirmar ao voltar)

1. Quem pode dar `start` — só host (definido) e o que acontece se o host sai
   antes do start (hoje `hostId` migra por `joinSeq`; validar).
2. `rematch` em lobby: hoje host pode mandar `rematch` e cai em `reset()` →
   `playing`. Duplicidade com `START`? Simplificar para: `START` inicia,
   `REMATCH` só quando `over`.
3. Tamanho do placar com `leftScores` no HUD (mostrar "saiu"?).
4. Se o e2e deve cobrir reconexão (30s ghost) ou ficar só no unit/ws-check.
