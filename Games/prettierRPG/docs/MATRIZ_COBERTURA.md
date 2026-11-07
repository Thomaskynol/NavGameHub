# MATRIZ_COBERTURA — PrettierRPG (revisão)

Fonte de dados: `data/equipment.json` via `lib/catalog.js`. Números do jogo vêm do catálogo
(`sim.skillParams` lê o catálogo; FULL `TODAS as skills têm custo/CD/alcance = sim` prova a igualdade).
Nenhuma célula afirma fidelidade ao Albion oficial; `APROX` = hipótese jogável documentada.

Códigos de evidência (efeito NUNCA provado só por leitura):
`CALC` = tests/catalog.test.js (validação+cálculo) · `BEH` = tests/sim-catalog-behavior.test.js
(gasto/CD observados na execução == catálogo) · `EFF` = teste de efeito nomeado abaixo ·
`PROTO` = tests/protocol-ws.test.js (7 testes via WebSocket contra servidor real) ·
`E2E` = tests/e2e/s*.cjs (bots via WS contra servidor real) · `BROWSER` = Playwright
Chromium + Firefox isolados (s6 41/41, ui-smoke 8/8) · `INSP` = só inspeção (NÃO prova efeito).

## 1. Armas — Q/W/E (efeito + gasto/CD por skill)

Todas: `CALC` (valida+calcula) + `BEH` (gasto/CD == catálogo) + `PROTO` rejeita inválida/sem gasto.
Efeito principal e teste correspondente:

| Skill | Efeito principal | Evidência efeito | Tooltip=C=S? | PvP/PvE | APROX |
|---|---|---|---|---|---|
| rending-strike | 195 + bleed 83/carga x3 + healRecv-12% em 3 | EFF `battleaxe Q` | sim | sem split | media; ticks pendentes |
| rending-spin | 231/264 por distância + bleed | EFF `battleaxe Q` + BEH sweep | sim | sem split | media; valores antigos |
| rending-rage | cone Q1/Q2 165+carga, Q3 salto+root 5m ~1,61s; CD 1,2s (2,5s é janela combo) | EFF `battleaxe Q` + EFF `sweep Q combo rending-rage` + cone `rending-rage: cone NÃO atinge quem está atrás` | sim (cat 1.2 = sim cdMs 1200) | sem split | baixa; custo/etapa |
| deadly-chop | cast 0,4s; 502 + vuln 16% 8s SÓ ao concluir | EFF `battleaxe W` + EFF `C-deadly-chop` + `C-cast cancelado` | sim | sem split | media |
| adrenaline-boost | +25% dano/+40% mov/+40% AA até 9s (cai após 3s sem dano) | EFF `battleaxe W` + BEH | sim | sem split | media |
| battle-rush | dash 12m; inimigos heal-20% 3s / aliados heal+20% 4s | EFF `battleaxe W` (`rush teleporta`) | sim | FFA/2v2 healRecv distinto | media |
| internal-bleeding | 193 + 66/0,5s até 8s se mover | EFF `battleaxe W` | sim | sem split | media; ticks pendentes |
| raging-blades | aura 5m 3s, 73/0,5s, +4% por inimigo (máx 10) | EFF `battleaxe W` | sim | sem split | media |
| blood-bandit | E1 528-825 por cargas; E2 363 + cura 110-331; sem cura se E2 bloqueada | EFF `battleaxe E` + EFF `E etapa2 não cura quando dano é bloqueado` + BEH | sim | sem split | media; consumo cargas pendente |
| sunder-armor | 230 + cargas -resistência 8s (máx 3) | EFF `dagger Q` | sim | -4% players/-6% mobs | media |
| deadly-swipe | salto 4,5m área 3m 258 + 21EN + carga +6% (máx 3) | EFF `dagger Q` | sim | sem split | media |
| assassin-spirit | toggle 15s, carga/2s +6% (máx 3), -4% defense | EFF `dagger Q` | sim | sem split | media |
| throwing-blades | cone 3 lâminas 207 + buffs por alvo único (máx 3) | EFF `dagger W` | sim | sem split | baixa; unidade 207 |
| dash | dash 8m +15% dano 4s; custo 1 (catálogo) | EFF `dagger W` + EFF `7-dash custa 1` | sim | sem split | baixa; CD 23,5s |
| forbidden-stab | 290 + interrompe + nega cura 1,5s | EFF `dagger W` | sim | alta | — |
| shadow-edge | projétil 22m, teleporta, stun ~1,68s, SEM dano (removido inventado) | EFF `dagger W` + EFF `8-shadow-edge sem dano` | sim | player stun vs mob pendente | media |
| chain-slash | saltos 3 alvos 379/482/689, imune durante | EFF `dagger W` | sim | sem split confirmado | media |
| bloodthirsty-blade | AA +172/+103, rouba 100%, +30% mov, auto-dano 2,5%/s, 6s | EFF `dagger E` + EFF `D-bloodthirsty` x2 + `5-AA no monstro` | sim | 172 PvP/103 PvE | alta |
| fire-bolt | cast 0,8s; 178 + burn 57/4s; CD 0 | EFF `fire Q` + BEH | sim (cat 0 = sim cdMs 0) | sem split | media |
| burning-field | ponto 3m 201 + campo 4s 158/57 | EFF `fire Q` + BEH | sim | 158 PvP/57 PvE | media |
| searing-flame | combo 3x284+burn126, final 574+burn126 | EFF `fire Q` + BEH direção | sim | sem split | media |
| flame-blast | inimigo 402 (raio 5m, 1,6s) + 115 primário; aliado/self +60% mov | EFF `fire W` | sim | alvos distintos | alta |
| wall-of-flames | parede 5s; toque = burn 417/4s + FUGA 0,5s (mob 1×) | EFF `fire W` + EFF `W-wall-of-flames` | sim (fuga no texto) | mob 1× | media |
| fire-wave | cone 497 (+201 sob fogo) + knockback ~5,59m | EFF `fire W` + EFF `A-fire-wave não atinge fora do cone` | sim | condicional fogo | media |
| fire-artillery | orbes 158 + DoT 43/16 até 4 stacks | EFF `fire W` + EFF `pve split` (16 mob) | sim | 43 PvP/16 PvE | media; nº orbes pendente |
| pyroblast | estágios 402/689/976 + knockback 3,5m no completo; interrupção volta estágio | EFF `fire E` + EFF `C-pyroblast` + BEH | sim | sem split | media |
| frostbite | cone 293 + stack (3 = stun ~1,12s) | EFF `frost Q` + EFF `A-frostbite fora do cone` | sim | sem split | media |
| ice-shard | ponto 373/258; CD 0 | EFF `frost Q` | sim (cat 0 = sim cdMs 0) | 373 PvP/258 PvE | baixa; custo 8 |
| frozen-surge | faixa 258 + slow 20% 3s | EFF `frost Q` | sim | sem split | media |
| frost-bomb | slow 30% + explosão 477 + slow 20% 5s | EFF `frost W` | sim | sem split | media |
| frost-beam | canal 2,7s 90/0,3s + slow/AA-15% (máx 5) | EFF `frost W` | sim | raio 4m dano APROX | baixa; raio conflito |
| frost-nova | teleporte 11m (sem atravessar parede) 201 + stun 1,4s + imune 0,2s | EFF `frost W` + EFF `B-dash/teleportes param em borda` | sim | sem split | media |
| frost-lance | 425 + -12% resist 3s | EFF `frost W` | sim | sem split | media |
| glacial-obelisk | objeto 6s: +20% dano/CD 10 aliados; recast 221+slow | EFF `frost W` | sim | aliados | media |
| freezing-wind | cone frontal 574 + root 2,8s; NÃO atinge atrás | EFF `frost E` + EFF `A-freezing-wind atrás/não atinge` x2 + BEH | sim | sem split | alta |
| generous-heal | aliado 201 + healRecv +5% 4s (máx 3) | EFF `holy Q/W/E` | sim | aliado; FFA só si | media |
| smite | área 330/390 + 109 no próximo dano 3s; acerto -50% CD | EFF `holy Q/W/E` + EFF `pve split` (390) | sim | 330 PvP/390 PvE | alta |
| holy-flash | área 5m cura 213 (máx 10) | EFF `holy Q/W/E` | sim | aliados | media |
| sacred-pulse | aliado: cura 81 (máx 5) + 321/482 + empurrão 12,58m | EFF `holy W/E restantes` | sim | 321 PvP/482 PvE | media |
| holy-beam | canal 3s 101+12/tick (máx 959); SEM self (FFA informa sem gastar) | EFF `holy Q/W/E` + PROTO auto-alvo rejeitado sem gastar | sim | só outro aliado | media |
| holy-blessing | +86 armor +30% healRecv 4s, anti-forced-movement | EFF `holy W/E restantes` | sim | aliado | media |
| holy-orb | projétil 25m, cura 272 (máx 10, raio 7m) | EFF `holy W/E restantes` | sim | aliado | media |
| reawaken | aliado CAÍDO levanta 30%; 66EN/30s | EFF `reawaken` + EFF `6-finish/reawaken` + PROTO? (não) | sim | só caído; PvE/FFA sem alvo | media |
| desperate-prayer | 201 (>40%) / 443 (<40%) + healCast +5% 15s (máx 3) | EFF `holy W/E restantes` + BEH | sim | limiar 40% | media |

## 2. Armaduras + passivas + capas

Todas: `CALC` + `BEH` (gasto/CD) + tooltip=C=S verificado abaixo.

| Skill | Evidência efeito | Tooltip=C=S? | APROX |
|---|---|---|---|
| energizing-shield (3 elmos) 505/25% 3s CD25 | EFF `mend-wounds só fora...`? NÃO — EFF `capas automáticas`? NÃO. Cobertura: BEH + `armor: dodge/deslize...`? NÃO cobre. **Efeito: INSP + BEH (gasto 0/CD 25 observados); sem teste de escudo 505 isolado → PARCIAL** | sim (texto confere) | baixa; mesmo valor 3 elmos |
| cleanse | BEH; **PARCIAL (sem teste de purge isolado)** | sim 0/30 | baixa |
| howl 163+slow35%/-30% 4s, cone, interrompe | EFF `armor: ... howl-cone` + EFF `A-fire-wave/how` + EFF `9-howl custo 0` | sim 0/30 | baixa cone/CD |
| mend-wounds 9%/7,5% canal 7s fora combate | EFF `mend-wounds só fora de combate` + BEH CHEST | sim | media; pulsos |
| inferno-shield reflect 20% 5s | EFF `10-inferno custo0/CD30/reflect` | sim 0/30 | baixa; ficha parcial |
| bloodlust 30% dano direto cap 120/600, 6s | EFF `11-bloodlust` (+mutation? sim — `4.6-bloodlust` antigo) + PROTO? não | sim (tooltip reescrito) | baixa; 30%/120/600 hipótese |
| dodge 5m + i-frame 0,8s + 40% 5s; NÃO termina em obstáculo | EFF `mend/dodge i-frames` + EFF `B-dodge para antes da parede` + EFF `B-dash/teleportes` | sim | media |
| refreshing-sprint +40%/+20% 5s | EFF `12-refreshing` | sim | baixa |
| break-free dash 12m purge sob stun | EFF `armaduras ativas têm efeito real` + BEH | sim | media |
| stone-skin +33% 4s | EFF `armaduras ativas têm efeito real` | sim | media |
| block imune 2,5s podendo mover | EFF `armaduras ativas têm efeito real` | sim | media; atacar durante pendente |
| taunt +20%/-25% 3s + threat; CD 20 (cat 20 = sim cdMs 20000) | EFF `armor: ... taunt` + BEH | sim | baixa; 8m |
| fury 8 stacks +8%/+5% 10s | EFF `armaduras ativas`? + `onDirectDamage` coberto em `review-fixes`? Cobertura: BEH + INSP do stack → **PARCIAL (stacks não contados isoladamente)** | sim 29/35 | media |
| rejuvenating-sprint +80% + 40/s 5s | EFF `13-rejuvenating` | sim | baixa; cura 40 |
| wanderlust +80% 8s, cancela em combate | EFF `14-wanderlust` | sim | baixa |
| force-field 177 + empurrão 9m, custo 0 CD 30 | EFF `armor: ... force-field` | sim (custo 0 corrigido) | media |
| aegis-of-energy +105/+28 + 42EN por dano | EFF `armaduras ativas têm efeito real` | sim | alta |
| frost-shield +83 + 15% + slow 40% | EFF `armaduras ativas` | sim 26/40 | alta |
| speed-caster -50%/-70% 8s | EFF `armaduras ativas` | sim 26/30 | alta |
| energetic-sprint +80% + 11EN/s | EFF `armaduras ativas` | sim | media |
| focused-run canal 4,5s +70% + 11/0,5s | EFF `armaduras ativas`? + BEH? Cobertura: **PARCIAL (canal não verificado isoladamente)** | sim | media |
| passivas arma (16): deep-cuts, life-leech 15%, burn 72, frost 1,2s, magic 2,99m, stacks | EFF `1..6` (v2core) + EFF `passivas contínuas` | sim | maioria baixa/media; ascended +5% |
| passivas armadura (18+2+courier inerte) | EFF `passivas contínuas` + CALC exatos (2372/316, 236/193, +40%) | sim | baixa botas=elmo; Scholar alta |
| 6 capas (bridgewatch 75s, fort-sterling 139s/1s, lymhurst 182s, martlock 225s, thetford ICD15s, caerleon 60s hipótese) | EFF `capas automáticas` + EFF fort-sterling (mutation) + lymhurst/thetford fortes | sim | baixa; tooltips 2021 |
| soldier 2 passivas obrigatórias | EFF `Soldier Armor: 2 passivas` + `pronto-toast` | sim | — |

## 3. Contratos (servidor prova, não leitura)

| Contrato | Prova |
|---|---|
| build completa + validação servidor | CALC FULL 97 skills + PROTO join inválido? (PROTO não testa build inválida — **PARCIAL**: validação provada em CALC + sim; via WS só build válida usada). Rejeição via WS: cobrir? `join` com build ruim → erro (não testado via WS → PARCIAL). |
| salas isoladas, nick único, sem mid-match | PROTO `salas isoladas` + `apelido duplicado` + E2E s4 |
| reconexão 30s com segredo | PROTO `reconexão` + E2E (s4/s6 anterior) |
| pronto/modo/equipe/criador/retorno lobby | EFF `regras lobby §6` (sim) + E2E s1/s2 (WS real) + BROWSER s6 |
| pveReset independente | EFF `pveReset independente` (sim) + PROTO `PvE resets` (WS real: dano zerado preserva cura 227; heal:true zera só cura) |
| snapshot real | EFF `snapshot valores reais` + CALC maxHp/maxEn + PROTO usa snapshot (HP cai, pve stats) |
| Hub (state/close, secret, htok) | EFF `hub ...` + E2E s8 (anterior); sem Hub real → PARCIAL |
| stop.sh só próprio / porta / offline | EFF `stop.sh ...` (3/3 com TMPDIR alternativo; EDQUOT é do ambiente) |

## 4. Lacunas honestas (não-verificado ou parcial)

- Efeito isolado: energizing-shield (valor 505), cleanse (purge), fury (stacks), focused-run (canal) — só BEH+INSP.
- Join com build inválida via WS não testado (só CALC/sim).
- Humano real (Thomas+amigos), 60 FPS em hardware real, 12 clientes UI simultâneos.
- Fidelidade ao Albion: todos `baixa/media` = hipótese; capas usam tooltips 2021; sem cliente oficial.
- Wave 2v2 de 4min em tempo real: coberta por unit (dano) + timer E2E; fim natural de 4min não aguardado.
