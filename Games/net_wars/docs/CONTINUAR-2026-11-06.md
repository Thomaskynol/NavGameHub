# CONTINUAR — checkpoint 2026-11-06 (pós A–F)

Retomada de 2026-11-05 concluída nos itens A–F. Ler docs/CONTINUAR-2026-11-05.md para contexto; abaixo só o delta verificado agora.

## Feito (verificado por execução real neste checkout)
- `server/main.js` (§4A completo): lobby autoritativo sai do lobby via START do host; guards objeto + try/catch + ws.on(error); maxPayload; URL try/catch→400; GET/HEAD 405; corpo ≤MAX_HTTP_BODY→413; close Hub JSON estrito→400; backpressure skip/kill; cap MAX_ROOMS→deny full; rate-limit INPUT/HELLO; rotas START/READY/SHUFFLE + lobbySync; log porta real; RECONNECT_S via env; rematch inalterado.
- `client/* + index.html/README/INTEGRACAO_GAME_HUB.md` (§4B–F): input FP por evento applyMouseTurn, TP joystick mantido, gate st.active, lock sem tiro fantasma, freeAim fallback, thr só TP, TEMP FP_YAW_RATE removido de constants; render FP/TP sobre linha de tiro com expLerp + freeDistAlongRay/distToBound + TP_SHIP_DROP visual; net timers no onclose + start/ready(v:1/0)/shuffle + guard geração + wss; main lobby/ready/start/shuffle, waiting do snapshot, reconexão 3x backoff, game-over idempotente, rematch global, gate áudio tiro, pred pushOutOfObstacles; hud deaths via scores (sem contagem local); textos lobby documentados.
- Divergência honesta: `server/room.js snapshot()` NÃO tem `respawnIn` (só alive/waiting + scores[].deaths). Cliente usa scores[].deaths + kill-event + RESPAWN_S. Adicionar respawnIn ao snapshot fica como pendência opcional do servidor (não bloqueia).

## Evidência (2026-11-06)
- `npm test` → 26/26 pass, exit 0; `node tests/ws-check.mjs` → 26 PASS WS-CHECK OK, exit 0; `node --check` server+client+shared ok.
- Smoke vivo HOST=127.0.0.1 PORT=0: lobby → guest START ignorado (fica lobby) → host START vira playing (2 ships); ready v:1 aparece no snapshot (READY-OK). Nota: v:true é rejeitado por validReady bit() — cliente envia 1/0 correto.
- `grep FP_YAW_RATE` → vazio; `grep https?://` → só dummy `http://x` (2x) + log em server/main.js, nenhum fetch externo.

## Falta (§4G + §5, não iniciado)
- Testes novos: unit orient/physics/lobby/spawnPos/colisão ordenada/scores-leftScores; integração HTTP/WS real (null, %zz→400 vivo, 405/413, close 400/`*`, rate-limit, MAX_ROOMS, backpressure, START/READY/SHUFFLE autoritativo).
- E2E browser Playwright (não instalado): menu→criar→lobby→start→playing→placar→over→rematch + regressão 2 crashes; pointer-lock real só com validação humana (headless = simulado).
