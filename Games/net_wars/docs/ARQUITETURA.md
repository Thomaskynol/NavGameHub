# Net Wars — Arquitetura

3D space combat multiplayer. Stack: Node 20 + `ws`, Three.js vendorizado local, ESM sem build, 100% offline (sem CDN).

## Pastas

- `server/main.js` — `http` estático + upgrade WS + rotas Hub. Único ponto de `process.env`.
- `server/room.js` — classe `Room(name)`: `{ships:Map, lasers:[], endsAt}` + `tick(dt)`, `snapshot()`. 1 room = 1 objeto; mapa `rooms` em `main.js`.
- `shared/constants.js` — física/balance (valores em findings.md). `shared/protocol.js` — `MSG = {HELLO:'hello',...}` + validadores leves.
- `client/main.js` (boot) / `net.js` (WS + input 20Hz + snapshot buffer) / `render.js` (Three scene, naves-box, lasers-linha, câmera chase) / `input.js` (WASD+mouse pointer-lock, click=fire) / `hud.js` (HP, timer, placar, killfeed) / `hub.js` (overlay `?hub=1`, fetch `/__hub/state`) / `audio.js` (`beep()` WebAudio).
- `index.html` — importmap `three → /vendor/three.module.js` + `<script type=module src=/client/main.js>`.
- `vendor/three.module.js` — Three pinado (baixar 1x, commitado).

## Protocolo WS (JSON, campos exatos)

C→S: `{"t":"hello","name":"..","room":"ffa1"}` · `{"t":"input","seq":N,"w":0/1,"s":0/1,"yaw":f,"pitch":f,"fire":0/1,"boost":0/1,"w2":0/1}` · `{"t":"ping","t0":ms}`
S→C: `{"t":"welcome","id":"..","room":".."}` · `{"t":"snapshot", ...campos em findings...}` · `{"t":"event","kind":"kill|pickup|over|respawn","a":"killerId","b":"victimId","scores":{}}` · `{"t":"pong","t0":ms}`

## Loop autoritativo (20Hz tick / 10Hz snapshot)

`setInterval 50ms: room.tick()` → move naves/lasers, colisões, mortes/respawns, power-ups → a cada 2º tick broadcast `snapshot`. Cliente: aplica snapshot, interpola naves remotas (`lerp` 100ms), prediz só a própria entre snapshots; não confia em HP/score do cliente.

## Hub

- `GET /__hub/state → {"rooms":[{"room","players","endsInS"}],"uptimeS":N}` (leitura, sem auth).
- `POST /__hub/close {"room":"ffa1"|"*"}` → remove rooms, broadcast `event over`, retorna `{"closed":[...]}`.
- Client: `?hub=1` injeta `client/hub.js` (painel canto sup. direito, polling 2s). `HOST`/`PORT` só em `server/main.js`.

## Primeiro incremento (fixer implementa só isto)

1. `shared/constants.js` (3 consts: SPEED/ACCEL/LASER) + `shared/protocol.js` (tipos hello/input/snapshot/event).
2. `server/main.js` (~80 linhas: static + WS + rooms map + `/__hub/*`) + `server/room.js` (~120 linhas: tick/move laser reto/colisão esfera/timer).
3. `index.html` + importmap + `client/{main,net,input,render,hud}.js` (câmera chase, box colorido por jogador, `Line` p/ laser, HUD div: HP+timer+placar).
4. Controles: `W/S` thrust, mouse yaw/pitch (pointer lock no click), click fire. Validar: 2 abas `?room=x`, `MATCH_LEN_S=30 node server/main.js`, voar+atirar+ver `over`.

Skipped: times/bots/míssil/boost/power-ups/áudio — fases 2-4. Risco: `ws` e pin Three devem constar em `package.json`/vendor; snapshot 10Hz pode dar jitter em rede lenta (aceitar no incr.1, interpolar).
