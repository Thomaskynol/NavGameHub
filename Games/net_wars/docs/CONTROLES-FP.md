# Controles FP — 1ª pessoa cockpit (padrão NetWars 1993)

Só 1ª pessoa. 3ª pessoa (instructor ○/✛/◆, bank, manete): ver
docs/CONTROLES-TP.md. FP usa o MESMO desejo/perseguição do TP (missão §3);
a diferença é a câmera (rígida no nariz) e a rolagem (manual, sem auto-bank).

## Marcas (o que cada uma é)

- **○ = DESEJO (para onde você quer ir).** Direção absoluta no mundo
  (`dyaw/dpitch`), movida pelo mouse (mesmo ganho por pixel do TP:
  `FP_RAD_PER_PX × sens`). Estável no mundo com o mouse parado. Regras do ponto:
  - *vazio* (raio sem obstáculo até 150m): ponto a 150m (nunca some);
  - *oculto* (raio bloqueado): ponto de entrada no obstáculo mais próximo
    (o tiro morreria aqui);
  - *fora-da-tela/atrás*: continua no mundo; o HUD prende o ○ na borda;
  - *muito-perto* (< 6m do nariz): empurra p/ 6m.
  Em curva o ○ muda no evento e o nariz chega depois (lag de w_max) —
  `window.__nw.aim` publica `ball`/`cursor` em FP como no TP.
- **✛ central (fixa) = NARIZ = para onde o tiro REALMENTE vai.** A câmera FP
  é colinear ao nariz (olho sobre a linha de tiro, olhando paralelo), então
  o centro da tela é a linha de tiro em **qualquer distância, curva ou
  obstáculo** — paralaxe zero. Sem supor convergência.
- **◆ = impacto previsto da trajetória real.** Raio ao longo do NARIZ com os
  MESMOS colisores do servidor (origem no nariz +3m, como o laser): ◆ forte
  na superfície = tiro vai bater; ◆ fraco no ponto máximo (150m) = caminho
  livre; ◆ dim pequeno = muito-perto (< 6m, fisicamente inalcançável).
  Vale nas 2 câmeras; em curva segue o nariz a 60fps.

## Curva / limite w_max (igual ao TP)

- `shared/turn.js:stepNose` (fonte única client/server): cada eixo anda no
  máx. `TP_YAW_RATE`/`TP_PITCH_RATE` (1.8 rad/s) por segundo. 180° leva
  ~1.7s de curva — nunca flip/teleporte.
- **Servidor autoritativo:** com `dyaw/dpitch` no input (FP envia, como o TP),
  o servidor ignora a orientação instantânea (`yaw/pitch`) e integra o nariz
  com w_max. Sem desejo = cópia direta (fallback, só se o cliente não mandar).
- **Cliente prediz** com a MESMA função (nunca impõe o final); o snapshot
  (10Hz) corrige divergência grande/teleporte/respawn, como antes.
- Mouse parado ⇒ desejo fixo ⇒ nariz converge e PARA (nada gira sozinho).

## Câmera (estável, sem giro espontâneo)

- RÍGIDA ship-locked: posição = olho FP_EYE_BACK (0.6m) atrás da origem SOBRE
  o eixo do nariz (recuo limitado pelo cenário, nunca dentro de rocha);
  atitude = nariz local 60fps; up = up da nave (banca junto, sem
  auto-nivelar). Mouse parado = imagem parada (nada gira sozinho);
  polos ±90° sem flip/NaN (travado em tests/reticles-camera.test.js).
- Nave própria oculta (mesh + etiqueta) — não tapa a visão.

## E/D na tela com roll (convenção Lane B, vale em FP)

- **E = esquerda da tela, D = direita** (não são teclas): mouse p/ E move o
  desejo à esquerda e o nariz/trajetória vão p/ esquerda (`dyaw+`, −X rumo
  −Z); mouse p/ D espelha. Mouse p/ cima sobe. Direita é sempre direita,
  independente de bank (vetor do mouse girado por −roll antes de integrar).
- **Teclas:** em FP `A/D` = rolagem MANUAL (sem auto-bank); `E` = míssil.

## Sens / inversão / lock (preservados, input.js)

- Sensibilidade: `FP_RAD_PER_PX × sens` (0.3–2.5); inverter Y troca o sinal
  do dy; clamp 400px/evento (sem salto pós-lag).
- Pointer lock: clique que captura NÃO atira (só trava); sem lock o jogo
  segue em mira livre (freeAim). Tiro só com a mira travada.
- Teclas FP: `W/S` empuxo (ré 60%), `A/D` rolagem manual, click rajada,
  `E`/botão-dir míssil (lock ◉ 12°/140m), `F` arma, `Shift+W` boost,
  `Tab` placar, `Esc` pausa, `M` mudo, `H` ajuda.
- Blur/unlock/espera: desejo recentra no nariz (sem giro ao voltar);
  respawn/teleporte: desejo = nariz (voa reto).

## Verificado (Lane F2)

- `tests/fp-desire.test.js`: parado, eixos+inversão, cursor-antes-do-nariz,
  180° no tempo, ○+◆ FP, E/D banqueado, lock/foco/pausa/respawn, sens/A-D.
- `npm test` FULL + `node tests/ws-check.mjs` FULL (165 baseline verde).
