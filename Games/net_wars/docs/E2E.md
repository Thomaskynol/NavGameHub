# E2E — harness versionado (v1)

## Rodar

```bash
node tests/e2e/run.mjs --flow=menu|lobby [--browser=chromium|firefox] [--game-port=N] [--keep]
```

- Sobe `server/main.js` em porta efêmera (`HOST=127.0.0.1`), derruba no fim.
- Sem dependências novas: Chromium via CDP cru sobre o `ws` já do projeto;
  Firefox via `--screenshot` one-shot. Nada é baixado (offline-after-prep intacto).
- Artefatos em `tests/e2e/artifacts/` (gitignored): `menu|lobby|hud-chromium.png`,
  `menu-firefox.png`, `fail-*.png` só em falha.

## Flows e asserts (todos condicionais — sem sleep-cego, espera por condição)

| flow | caminho | asserts |
|------|---------|---------|
| `menu` | boot → menu | menu visível; módulo bootado (sinal real: `m-room` preenchido ⇒ `wire()` rodou no mesmo tick); título; 1 screenshot; **zero pageerror**; **zero console.error** (allowlist abaixo); **zero request falhado** |
| `lobby` | menu → nome+criar → lobby → ready → start → HUD | tudo do `menu` + código da sala; piloto no hangar; ready espelhado; HUD visível; screenshots lobby+hud; 4 s de simulação p/ erros WebGL tardios |

Allowlist de console (`KNOWN_CONSOLE_ALLOW` em `run.mjs`): **vazia** — primeiro
sinal de warning conhecido entra aqui com substring, nunca cegamente.

## Matriz de browsers (2026-11-06)

| browser | versão | cobertura | evidência |
|---------|--------|-----------|-----------|
| chromium | 156.0.8078.47 | menu ✅ lobby ✅ (CDP: console+pageerror+rede) | `E2E OK`, exit 0; artifacts `*-chromium.png` |
| firefox | 158.0.1 | menu visual ✅; console/pageerror ❌ sem driver | `menu-firefox.png` (242 KB, menu renderizado); sem geckodriver no ambiente e sem pacote playwright instalável offline → captura de console do Firefox é **lacuna registrada, não afirmada** |

Para console/pageerror do Firefox: instalar `geckodriver` (ou `npx playwright install`,
com rede) e plugar Marionette/WebDriver BiDi — passos registrados, não executados
(jogo precisa seguir offline-after-prep; nada foi instalado).

## Armadilhas do ambiente (reproduzidas, não teoria)

1. **`/tmp` com quota** → cache do chromium ilegível → GPU `exit_code=133` em loop
   e `captureScreenshot` nunca responde. Fix: profile + `--disk-cache-dir` dentro de
   `tests/e2e/.profiles/` (gitignored) + timeout de 20 s por mensagem CDP (hang vira
   erro, nunca trava o harness).
2. **Menu HTML é estático**: esperar só `#screen-menu` visível passa ANTES de
   `client/main.js` rodar (o init sobrescrevia `m-name` e o clique caía no vazio).
   Sinal real de boot: `m-room.value !== ''` (init do módulo; `wire()` roda no mesmo
   tick síncrono). Nome+clique vão no **mesmo** `evaluate`.
3. **Profile do Firefox no pendrive (exFAT) = `--screenshot` no-op silencioso
   com exit 0**. Fix: profile em `~/.cache/nw-e2e-ff` (ext4) + path absoluto de saída.

## O que este E2E NÃO prova (human-pending, sem exceção)

- **Feel**: câmera TP, pilotagem War-Thunder, mira —Travado por unidade
  (`camera-invariants.test.js`: fora-de-obstáculo todo frame, convergência sem input,
  look ∥ nariz), mas feel é relato humano pendente.
- **TP-still-spins?**: não validado em browser (P0-1 cobre `wrapAngle`/roll por teste).
- **Pointer-lock real**: headless nega; clicks via `evaluate` são untrusted (sem gesto
  real). Áudio idem (WebAudio sintetiza, ninguém ouviu de verdade).
- **2 sessões completas** (morte/respawn, fim/empate, revanche, disconnect/return,
  equipes/survival em browser): implementado em `run.mjs` (`--flow=full|modes`,
  2 alvos CDP + `?len=` curto), mas **0 pass em 3 tentativas (2026-11-06)** —
  ver Bloqueio v3 abaixo. Vídeo: `ffmpeg` existe no cache playwright
  (`~/.cache/ms-playwright/ffmpeg-1013/ffmpeg-linux`) — `Page.startScreencast` →
  montar webm fica p/ v3.

## Limites de contrato conhecidos (decisão humana pendente, sem mudança de código)

- **respawnIn ausente no snapshot**: `server/room.js snapshot()` só traz
  alive/waiting + `scores[].deaths`; cliente estima respawn de `deathAt+RESPAWN_S`
  (`client/main.js:449`) — deriva da autoridade em lag/reconnect. Pendência
  opcional (§4F, já registrada no checkpoint).
- **thr (manete TP) persiste após blur visível**: `clearKeys` preserva `thr` por
  desenho (travado em `tests/input-focus.test.js:165`); aba oculta é neutralizada
  no transporte (`net.js`), mas blur com página visível segue enviando `thr`
  fresco — a nave continua acelerando. Definir se é gameplay intencional.
- **guest l-start entra na vista de partida**: `l-start` chama `enterMatch()` mesmo
  sem ser host / sem `state=playing`; servidor ignora START de não-host (fica
  lobby), mas o guest vê predição local sem autoridade até o snap >15m. Confirmar
  intenção ou aguardar `playing`.
- ~~EVER_CAP=2048 × idempotência do close~~ — RESOLVIDO (contrato Hub): `everExisted`
  removido; close de sala inexistente é `200 {ok:true, closed:false}`, idempotente
  sem memória/evicção.
- **Bloqueio v3 — RESOLVIDO (2026-11-06, lanes D+N+FIX):** `--flow=full` passa
  (47 PASS, E2E OK, exit 0; `--flow=modes` E2E OK). As 3 falhas iniciais eram
  harness/infra (launch sem retry, waits sem condição, contenção) — corrigidas
  sem mudar o jogo; nenhuma foi atribuída a contenção sem prova. Comando:
  `node tests/e2e/run.mjs --flow=full`. Screenshots em `tests/e2e/artifacts/`
  (lobby, playing TP/FP, morte, over, rematch).
