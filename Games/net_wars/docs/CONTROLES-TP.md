# Controles TP — instructor (bolinha × arma, curva w_max, E/D, mira=impacto)

Só 3ª pessoa (TP) e 1ª pessoa (FP): ambas usam desejo ○ + perseguição w_max
(ver docs/CONTROLES-FP.md; FP sem auto-bank e sem manete).

## Bolinha ○ vs arma ✛/◆

- **○ = DESEJO (para onde você quer ir).** Direção absoluta no mundo
  (`dyaw/dpitch`), movida pelo mouse (mesmo ganho por pixel do FP).
  Estável no mundo com o mouse parado. Regras do ponto:
  - *vazio* (raio sem obstáculo até 150m): ponto a 150m (nunca some);
  - *oculto* (raio bloqueado): ponto de entrada no obstáculo mais próximo
    (o tiro morreria aqui);
  - *fora-da-tela/atrás*: continua no mundo; o HUD prende o ○ na borda;
  - *muito-perto* (< 6m do nariz): empurra p/ 6m.
- **✛ central = NARIZ = para onde o tiro REALMENTE vai.** As 2 câmeras olham
  ao longo do nariz, então o centro da tela é a linha de tiro em qualquer
  distância (câmera TP é paralela, FP é colinear — ver camera-invariants).
- **◆ = impacto previsto da trajetória real.** Raio ao longo do NARIZ com os
  MESMOS colisores do servidor (`rayHitObstacle` ≡ `firstImpactAfter` p/
  obstáculos): ◆ forte na superfície = tiro vai bater; ◆ fraco no ponto
  máximo (150m) = caminho livre. O laser do servidor nasce no nariz e morre
  no 1º impacto — estabilizada + alinhada ⇒ impacto real (não só retículo).

## Curva / limite w_max

- `shared/turn.js:stepNose` (fonte única client/server): cada eixo anda no
  máx. `TP_YAW_RATE`/`TP_PITCH_RATE` (1.8 rad/s) por segundo. 180° leva
  ~1.7s de curva — nunca flip/teleporte (erro decresce monótono, testado).
- **Servidor autoritativo:** com `dyaw/dpitch` no input, o servidor ignora a
  orientação instantânea (`yaw/pitch`) e integra o nariz com w_max. Sem
  desejo = cópia direta (fallback só p/ cliente legado; FP e TP atuais
  sempre enviam `dyaw/dpitch`).
- **Cliente prediz** com a MESMA função (nunca impõe o final); o snapshot
  (10Hz) corrige divergência grande/teleporte/respawn, como antes.
- Mouse parado ⇒ desejo fixo ⇒ nariz converge e PARA (nada gira sozinho).
  Alvo rápido ⇒ ○ (desejo) muda no evento, nariz chega depois (lag de w_max).

## E/D (resolvido)

- **E = esquerda da tela, D = direita** (não são teclas): mouse p/ E move o
  desejo à esquerda e o nariz/trajetória vão p/ esquerda (`dyaw+`, −X rumo
  −Z); mouse p/ D espelha. Mouse p/ cima sobe. Direita é sempre direita,
  independente de bank.
- **Teclas:** `E` continua míssil e `D` continua rolagem/bank à direita —
  sem conflito porque E/D aqui são lados da tela. `A/D` = bank + leme fino
  (o leme move o DESEJO, não o nariz direto, p/ não divergir do servidor);
  `Q` não é usado; `E` nunca virou leme.

## Verificado / falta (lane T)

- Verificado: `npm test` (inclui `tests/turn.test.js`: curva/limite/180°,
  marcas, E/D, autoridade do servidor, impacto real, predição do cliente,
  FP desejo/perseguição) + `node tests/ws-check.mjs` FULL.
- Verificado 2 browsers: `tests/e2e/run.mjs --flow=full` abre 2 sessões CDP
  (A TP + B FP) + bot WS — coerência Δpos/Δyaw, morte/respawn, resume,
  TP→FP→TP. Gap real = feel/mouse físico (pointer-lock real, áudio audível),
  human-pending.
- Falta (fora do incremento): paralaxe perto/borda, latência/FPS sob carga.

## Apêndice Lane R — o que se vê (retículos × câmera × radar)

### Paralaxe TP / hold-under (documentado, sem convergência)

- A câmera TP é **paralela** ao nariz (offset constante TP_H = 4.2m acima da
  linha de tiro): a ✛ central = direção do nariz **no infinito**.
- Medido (Lane D Q2): alvo a 50m aparece **3.8° / 41px abaixo da ✛**; o erro
  angular cai com a distância (offset em px ≈ const/dist).
- Regra arcade: **mire pela ◆, não pela ✛, em curta distância** — a ◆ 3D
  (mesmos colisores do servidor) marca o impacto real em qualquer alcance.
  FP é colinear (paralaxe zero) — o modo precisão.

### ◆ estados (client/render.js via client/camera.js gunSolution)

- **forte** (opaco): bloqueado — raio do nariz bate no cenário; tiro morreria
  aqui. Origem no nariz **+3m** (igual ao spawn do laser no servidor).
- **fraco** (0.3, pequeno): vazio — caminho livre até 150m (AIM_MAX_DIST).
- **dim pequeno** (0.55, 0.6×): muito-perto — impacto a < 6m do nariz
  (AIM_MIN_DIST) ou nariz dentro da rocha (fisicamente inalcançável);
  indicador coerente em vez de blob. Em curva o nariz move a cada frame
  (60fps, sem salto de 10Hz).

### ○ regras na projeção (camera.js desiredSolution/clampAim, sem divergir)

- Mundo: mesmas funções de turn.js (vazio 150m / oculto superfície /
  muito-perto → 6m). Fora-da-tela/atrás: prende na borda com
  AIM_EDGE_MARGIN (20px), espelha X quando atrás, **nunca some**.

### Radar E/D (corrigido — era espelhado)

- Era `x: -rx`: contato à direita caía à esquerda. Agora sem espelho —
  **direita da tela = direita no radar**, esquerda = esquerda (vale p/ naves,
  mísseis, lasers e pickups; E/D de turn.js).
- Frente = **abaixo** no radar (convenção do HUD, linha branca p/ baixo);
  ▲/▼ = acima/abaixo de ±8m. O radar mostra posição atual, sem lead.

### TP_SHIP_DROP 1.25u (só-visual, não mascara hitbox)

- Câmera e raio da arma usam a posição VERDADEIRA; só o mesh desce 1.25m p/
  não cobrir a mira. DROP (1.25) ≤ SHIP_RADIUS (2.4): o visual ainda cruza a
  hitbox real do servidor. Laser/◆ nascem no nariz verdadeiro (+3m).

### Câmeras (estabilidade)

- FP: RÍGIDA ship-locked (posição+atitude do nariz local 60fps, sem damp);
  nada gira sozinho; polos ±90° sem flip; up banca junto (cockpit, sem
  auto-nivelar). Nave própria oculta (não tapa a visão).
- TP: chase com suavização + re-teste contra rocha (nunca atravessa);
  teleporte/troca de modo dá snap. Ver docs/CONTROLES-FP.md (1ª pessoa).

## Bank / screen-relative (Lane B, 2026-11-06)

- **Convenção (War-Thunder mouse-aim):** no TP o vetor de mouse `(dx,dy)`
  é girado por **−roll** antes de integrar o desejo
  (`moveDesired(..., roll)`: `ex=dx·cos+dy·sin`, `ey=−dx·sin+dy·cos`),
  e o cursor ○ gira o erro por **+roll** p/ a tela
  (`cursorFromError(..., roll)`). Efeito: **cursor-direita move o nariz p/
  a direita DA TELA** com roll ∈ {0, ±90°, 180°}; cima/baixo idem
  (incl. `invertY`, aplicado antes da rotação). `roll=0` é bit-idêntico ao
  antigo; `w_max`, wrap `[-π,π]`, mouse-parado→para e FP intacto preservados.
- **Por que assim:** sem o giro, `yaw` de mundo com bank-90° anda na
  vertical da tela e com 180° inverte (provado em
  `.planning/2026-11-06-net-wars-pilotagem/repro-q1-tp-bank.mjs`, 25 checks
  EXIT 0). A rotação alinha mouse↔tela sem tocar no `stepNose`/servidor
  (perseguição continua por eixo-mundo com `w_max` — saturação assimétrica
  pode só arredondar a diagonal em erros grandes, sem salto/NaN/trava).
- **Fiação:** `client/input.js` passa `st.roll` nas duas chamadas; `nx/ny`
  retornados já são de tela, então `autoBank`/deadzone operam na tela sem
  código extra. `A/D` (leme fino em `dyaw` de mundo) mantido como está —
  fora do escopo do bug do mouse.
- **Verificado:** `tests/turn.test.js` 22 testes (5 novos banqueados) +
  suítes determinísticas 82/82 (`turn,orient,room,camera-invariants,
  input-focus,p1-regressions`) + `node tests/ws-check.mjs` FULL OK.
  `npm test` FULL oscila em lanes paralelos (portas/browser) — sem relação
  com este incremento (isolado: `turn`+`authority-latency` 29/29).
