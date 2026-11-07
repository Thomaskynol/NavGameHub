# Validação — comandos, resultados e checklist

Data: 2026-11-02. Ambiente: Linux, Node v24.22.1 (requisito: 20+).

## 1. Comandos e resultados reais

### `npm test` — exit 0, 18 pass / 0 fail

```
ℹ tests 18 · suites 11 · pass 18 · fail 0 · cancelled 0 · skipped 0
```

Cobertura: protocolo hello/input (válidos e inválidos), timer encerra 1× + rematch limpa,
laser com cadência (~5 s TTK), DPS combinado dos buffs ~2x, lock/recarga 9 s do míssil,
fogo amigo off, coleta única + respawn + sem acúmulo de power-ups, boost dreno>regen,
empate FFA explícito, waves + derrota + late-join survival, 12 vagas, reconnect 30 s sem
duplicar + purge, proteção 2 s (atirar encerra), campos novos opcionais do protocolo.

### `node tests/ws-check.mjs` — exit 0, 14/14 PASS

Sobe/derruba servidores próprios nas portas 18091/18092. Resultado real:

```
PASS  2 salas isoladas: ra tem 2 players …  PASS  rb tem 1 player …
PASS  snapshot A contém só a sala A · PASS  snapshot B contém só a sala B
PASS  salas isoladas: nenhum ship compartilhado
PASS  snapshot tem missiles/powerups/obstacles
PASS  13ª conexão rejeitada (denied=full close=1013)
PASS  sala ra manteve 12 vagas
PASS  POST /__hub/close sem HUB_SECRET → 403
PASS  sala tmp criada · PASS  close sem header → 403
PASS  close sala inexistente → 404
PASS  close fecha sala ({"closed":["tmp"]})
PASS  close idempotente: 2º → closed:[]
WS-CHECK OK
```

### Navegador headless (Chromium + CDP, suíte `/tmp/opencode/nw-cdp.mjs`) — 26/26 PASS

Zero erros de console em 6 abas. Cobre: menu → criar/entrar por código, lobby (código,
copiar link, roster ao vivo 2 abas, host ♛, ocupação n/12, regras por modo), partida com
HUD completa, laser em rajada replicado p/ aba 2, míssil real replicado + `RECARREGANDO 9s`,
mira central livre, vinheta só nas bordas, timer do servidor, radar+▲▼, ping/fps,
teams (time red, anel vermelho, placar RED×BLUE), survival (ONDA 1 + 2 bots, timer ∞),
`?hub=1&room&name&expect=3` sem redigitar + hub-box, fim (`?len=6`) com revanche.
Prints em `/tmp/opencode/nw-{menu,lobby,match1,match2,combat,missile,teams,survival,hub,over}.png`.

### Offline estático — limpo

```bash
$ grep -rn "https\?://" client/ server/ shared/ index.html
server/main.js:36:  const url = new URL(req.url, 'http://x');     # dummy local p/ parse
server/main.js:51:  (idem)
server/main.js:170: console.log(`net-wars on http://${HOST}:${PORT} …`)  # log
```

Nenhum `http(s)` externo em runtime: sem CDN, sem fetch externo, Three.js local,
áudio sintetizado. (`docs/` e `README.md` contêm URLs documentais — permitido.)

## 2. Checklist (18 itens)

Legenda: ✅ comprovado · ⚠️ parcial · ❌ não medido/testado.

| # | Item | Estado | Evidência / motivo |
|---|------|--------|-------------------|
| 1 | `npm i` + `node server/main.js` sobe em `PORT` | ✅ | `npm test` 18/18; ws-check subiu 2× (18091/18092) |
| 2 | 2 abas, mesma sala, veem-se mover | ✅ | CDP 26/26 (roster ao vivo + replicação); WS prova snapshots nas 2 salas |
| 3 | Laser replicado nas 2 telas | ✅ | CDP: rajada replicada p/ aba 2 |
| 4 | HUD: HP, timer, placar | ✅ | CDP partida completa |
| 5 | Timer curto encerra + tela resultados + revanche | ✅ | CDP `?len=6` → "VENCEU!" + revanche volta à partida; unit: encerra 1× |
| 6 | Controles W/S + mouse + click | ⚠️ | input 20 Hz provado via WS; pointer-lock real negado no headless (fallback com catch) — mira com mouse físico não testada |
| 7 | Míssil real (35, lock, 9 s) replicado | ✅ | CDP: míssil real replicado + RECARREGANDO 9 s; unit: lock/recarga/swap |
| 8 | Boost dreno > regen | ⚠️ | unit ✅ (dreno/regen/Propulsão); medidor/FOV/efeito só visual local, autoridade é do servidor |
| 9 | 6 power-ups: spawn, coleta, respawn 20 s, 15 s sem acúmulo | ⚠️ | unit ✅ (coleta única/respawn/sem acúmulo/limites 40); visual = âncoras girando + toast, sem conferência de posição 1:1 |
| 10 | Modos FFA / teams / survival + placar por modo | ✅ | CDP teams + survival ONDA 1; unit empate FFA, FF off, waves/derrota/late-join |
| 11 | 12 jogadores/sala, 13ª recusada | ⚠️ | servidor ✅ (ws-check: 12 + `denied full`/1013); **12 pessoas reais, ❌** |
| 12 | Timer 5 min server-side + empate explícito | ✅ | unit; `endsInS` oficial, survival sem timer |
| 13 | Reconexão 30 s sem duplicar; sala cheia `FULL`; host migra | ⚠️ | unit ✅ (reconnect/purge/host); **em navegador real, ❌** |
| 14 | Hub `?hub=1`: autopreenchimento, salas, voltar validado | ✅ | CDP `expect=3` sem redigitar + hub-box; voltar só `http/https` |
| 15 | Endpoints `/__hub/state`, `/__hub/close` + `HUB_SECRET` | ✅ | ws-check 403/404/idempotente; formato real diverge da referência (ver INTEGRACAO_GAME_HUB.md §7) |
| 16 | Offline: sem dependência externa em partida | ⚠️ | `grep` estático limpo ✅; **offline real com rede desligada, ❌** |
| 17 | Áudio sintetizado sem assets | ⚠️ | código 100% WebAudio ✅; **ouvido de verdade, ❌** (headless mudo) |
| 18 | Telas < 720 px · perda de pacote · host migration · LAN 2 PCs · internet | ❌ | só CSS básico; cenários de rede real não executados |

## 3. O que NÃO foi afirmado

- Browser externo com GPU/pointer-lock real, 12 pessoas, outra distro Linux, NTFS/pendrive,
  offline com cabo desplugado: **não executados** (§9 do complemento proíbe afirmar).
- Fim forçado por hook seria declarado como tal — não foi preciso: `?len=6` usa o timer real.
- Hub real: indisponível; integração testada só do lado do jogo.
