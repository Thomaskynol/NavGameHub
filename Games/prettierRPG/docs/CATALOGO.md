# CATÁLOGO — PrettierRPG v1 (T8.0 Normal, IP1100, base 1200HP/120EN)

Fonte: `docs/PRODUTO.md` §§3,4,14,15 (Anexos A–F). Snapshot: Dragonfire Patch 4,
nov/2026. Precedência: **produto > 3º levantamento > 2º levantamento > histórico 2025**.
Dados vivos em `data/equipment.json`; acesso via `lib/catalog.js`
(`ITEMS, SKILLS, getItem, getSkill, calcStats, APPROX`) e `lib/build.js`
(validação + mesmos getters). Nomes PT-BR são rótulos de trabalho.

## 1. Itens (23) — origem e confiança

| Item | Stats T8 IP1100 | Origem | Confiança |
|---|---|---|---|
| Machado de Batalha (Elder's Battleaxe) | AA98, 1,1/s, DPS108, alcance 3m, AP138, +95 HP | C.1/D.2, 3º round B | alta |
| Adaga (Elder's Dagger) | AA55, 2/s, DPS110, alcance 2m, AP144 | C.1/D.3 | alta |
| Cajado de Fogo/Frost/Holy (básico T8_MAIN_HOLYSTAFF) | AA53, 1,35/s, DPS71, alcance 9m, AP120 | C.1/D.4–D.6, B (Holy ≠ artefato) | alta |
| Escudo | CCR+50, Def.Players +5,2%, Def.Mobs +5,2%, Threat +20,5% | C.2 | alta |
| Tomo (Rosalia's Diary = Tome T8) | +29 EN máx, +0,37 EN/s, -2,1% cast | C.2/B | alta |
| Tocha | +12,3% AA speed, +0,6% Cooldown Rate | C.2 | alta |
| Mercenary Hood / Soldier Helmet / Scholar Cowl | +269 HP, +98 EN, +2,7 HP/s, +1,22 EN/s | C.3 | alta (stats) |
| Mercenary Jacket | 188/188 Armor/MR, CCR138, +539HP/+49EN, dano/cura +20%, +5,4HP/s e +150%, +0,61EN/s e +6%, CC +20% | C.3 | alta |
| Soldier Armor | 236/193 Armor/MR, CCR156, +539HP/+49EN, dano/cura +10%, +5,4HP/s e +150%, +0,61EN/s e +4%, CC +40% | C.3/B confirmado | alta |
| Scholar Robe | 133/159 Armor/MR, CCR127, +539HP/+49EN, dano/cura +40%, +5,4/+150%, +0,61/+12% | C.3/B | alta |
| Botas 3 conjuntos | +269HP/+29EN, +2,7/+0,37 regen, +59 carga (sem efeito no jogo) | C.3 | alta |
| Capas (6: Bridgewatch/FortSterling/Lymhurst/Martlock/Thetford/Caerleon) | +20 EN, +0,24 EN/s cada | E | alta (stats); efeitos: ver §3 |

Armor/MR de capuzes/botas: **não listados na linha consultada → adotado 0**
(não prova ausência). Threat só importa no PvE (treino).

## 2. Matriz de opções (D.1) — 130 seleções

Armas (65): Battleaxe Q{Rending Strike, Rending Spin, Rending Rage}
W{Deadly Chop, Adrenaline Boost, Battle Rush, Internal Bleeding, Raging Blades}
E{Blood Bandit} P{Deep Cuts, Life Leech, Increased Defense, Aggressive Rush} ·
Dagger Q{Sunder Armor, Deadly Swipe, Assassin Spirit}
W{Throwing Blades, Dash, Forbidden Stab, Shadow Edge, Chain Slash} E{Bloodthirsty Blade}
P{Deep Cuts, Life Leech, Auto-Attack Speed, Aggressive Rush} ·
Fire Q{Fire Bolt, Burning Field, Searing Flame} W{Flame Blast, Wall of Flames,
Raging Flare, Fire Wave, Fire Artillery} E{Pyroblast} P{Burn, Energetic,
Aggressive Caster, Furious} ·
Frost Q{Frostbite, Ice Shard, Frozen Surge} W{Frost Bomb, Frost Beam, Frost Nova,
Frost Lance, Glacial Obelisk} E{Freezing Wind} P{Frost, Energetic, Aggressive Caster, Furious} ·
Holy Q{Generous Heal, Smite, Holy Flash} W{Sacred Pulse, Holy Beam, Holy Blessing,
Holy Orb, Reawaken} E{Desperate Prayer} P{Adrenaline Driven Charity, Energetic, Magic Force, Ascended}.

Armaduras (59): Merc Hood{Energizing Shield, Cleanse, Howl}+{Balanced Mind, Swiftness, Quick Thinker} ·
Merc Jacket{Mend Wounds, Inferno Shield, Bloodlust}+idem ·
Merc Shoes{Dodge, Refreshing Sprint, Break Free}+{Courier + idem} ·
Soldier Helmet{Energizing Shield, Stone Skin, Block}+{Toughness, Authority, Tenacity} ·
Soldier Armor{Mend Wounds, Taunt, Fury}+{Toughness/Authority/Tenacity}+{Spirit Crush/Protective Instinct} ·
Soldier Boots{Dodge, Rejuvenating Sprint, Wanderlust}+{Courier + Toughness/Authority/Tenacity} ·
Scholar Cowl{Energizing Shield, Force Field, Aegis of Energy}+{Aggression, Concentration, Efficiency} ·
Scholar Robe{Mend Wounds, Frost Shield, Speed Caster}+idem ·
Scholar Sandals{Dodge, Energetic Sprint, Focused Run}+{Courier + idem}.

Capas (6, automáticas): Sandstorm (E→aura slow), Untouchable (purge+imune),
Energy Reserve (<40% EN→70% em 10s), Shield of Protection (<25% HP→+50% Def 5s),
Chain Lightning (AA→242 até 4 alvos), Caerleon (Q→reseta CD do Q; **CD 60s hipótese §14**).

## 3. APROX — aproximações adotadas (unidade + versão)

| # | Alvo | Campo/valor (unidade) | Justificativa | Origem |
|---|---|---|---|---|
| 1 | rending-rage | custo 4/etapa, CD 2,5s | custos por etapa corrompidos | D.2 |
| 2 | throwing-blades | 207 por alvo | unidade por lâmina/alvo pendente | D.3 |
| 3 | dash (dagger) | custo 1, CD 23,5s | campo bruto 0,08; tooltip não confirmado | D.3 |
| 4 | ice-shard | custo 8 | custo atual pendente | D.5 |
| 5 | frost-beam | raio dano 4m | conflito 4m dano x 5m debuff | D.5 |
| 6 | frost | root 1,2s | captura 2025 traz 0,86s | D.5 |
| 7 | magic-force | só empurrão 2,99m | interrupção antiga não confirmada | D.6 |
| 8 | ascended | +5% dano/cura contínuo | efeito atual não recuperado | D.6 |
| 9 | deep-cuts | 55 (axe)/57 (dagger), duração pênd. | captura antiga | D.2/D.3 |
| 10 | life-leech | 15% do dano efetivo | fórmula pós-defesa a testar | D.2/D.3 |
| 11 | increased-defense | +29% por 2s | unidade % x pontos a confirmar | D.2 |
| 12 | aggressive-rush | +8% axe/+6% dagger/3s | refresh/stack pendente | D.2/D.3 |
| 13 | auto-attack-speed | +30%/3s após 5 AA | valor atual a confirmar | D.3 |
| 14 | burn | 72/3s | ticks/acúmulo pendentes | D.4 |
| 15 | cleanse | custo 0, CD 30s | ficha sem números | D.7 |
| 16 | howl | cone 8m, custo 0, CD 30s | alcance/cone/custo/CD não fechados | D.7 |
| 17 | inferno-shield | reflect 20%/5s, CD 30s | ficha não recuperada | D.7 |
| 18 | bloodlust | cura 30% do dano direto, cap 120/acerto e 600/buff, 6s | ficha sem %/limite; hipótese preserva efeito principal (cura escala com dano direto, não flat por AA) | D.7 + §4 |
| 19 | refreshing-sprint | +40% mov/+20% CD 5s | ficha incompleta | D.7 |
| 20 | rejuvenating-sprint | cura 40/s x5s | cura atual não encontrada | D.7 |
| 21 | wanderlust | +80% 8s, cancela em combate | duração/cancelamento pendentes | D.7 |
| 22 | taunt | custo 15, CD 20s, range 8m | custo/CD/range não fechados | D.7 |
| 23 | force-field | custo 0, CD 30s, stand 0,5s (dado D.6; sem APROX de custo) | custo confirmado em D.6; era 15 por leitura de D.7 | D.6 |
| 24 | mend-wounds | 1 pulso/s (9%/7,5%) | nº de pulsos/1º tick por item a validar | D.7 |
| 25 | energizing-shield | 505/25% nos 3 elmos | comparação individual pendente | D.7 |
| 26 | balanced-mind/swiftness/quick-thinker | 1,5%/6%/2,5% nas 3 peças | confirmação por peça pendente | D.7 |
| 27 | toughness/authority/tenacity botas | 2,5%/5%/10% (= elmo) | sem valor publicado p/ botas | D.7 |
| 28 | capuz/botas | Armor/MR = 0 | não listado ≠ zero; piso adotado | C.3 |
| 29 | capas 5 cidades | CD 75/139/182/225/15s | tooltip atual não observado (últimos arquivados) | E/B |
| 30 | caerleon-reset | CD 60s | sem valor confiável; hipótese §14 | §14 |
| 31 | courier | inerte + tooltip | sem peso/inventário nesta versão | §14 |
| 32 | stacking dano/cura/passivas | soma aditiva | ordem/multiplicação não confirmada | F.2/F.3 |
| 33 | regen | 1%/1% paz, HP 0% + EN 0,5% combate, janela 10s | HP zerado em combate (BARRAGEM §4 prevalece sobre hipótese §14 0,1%) | §14 + BARRAGEM §4 |

`APPROX` em `lib/catalog.js` espelha esta tabela em forma testável
(42 entradas: 36 marcas `approx` nas skills + 6 estruturais, incluindo
"passivas repetidas por peça" — mesmo nome não garante mesmo valor;
Scholar confirmado por peça, demais adotadas, origem B.3/D.7).
Tooltip/cliente deve usar estes mesmos valores — proibido X/NaN/placeholder/botão sem efeito.

> Fidelidade NÃO comprovada: nenhum número acima afirma paridade com o
> cliente oficial. Valores marcados `baixa`/`media` são hipóteses jogáveis
> até teste em cliente; ver MATRIZ_COBERTURA.md. Correções aplicadas nesta
> revisão: Bloodlust deixa `+50/+30 por AA` e passa a `cura 30% do dano direto,
> cap 120/acerto e 600/buff, 6s` (D.7 diz "heal por aplicação/janela/stacks e
> eventos elegíveis" sem números; flat por AA suprimia o efeito principal);
> Force Field custo 15→0 (D.6 confirma custo 0; 15 era leitura de D.7).
> Divergências sim-vs-catálogo não editadas nesta lane estão em
> `.planning/prettierRPG-v2-findings.md` com path:linha.

### Aproximação numérica × simplificação de comportamento

- **Aproximação numérica (§3 acima):** campo sem fonte confiável ganha valor
  inicial coerente, explícito e testável (ex.: Bloodlust 30%/120/600; capas
  75/139/182/225/15s dos últimos tooltips arquivados, não do cliente atual).
  Não elimina efeito principal nem genericiza (não trocar % por flat).
- **Simplificação de comportamento (§4 abaixo):** geometria/ordem/ticks
  simplificados no sim com `shortcut:` no código (ex.: cone→alvo+direção,
  bleed 1/s, escudo absorve valor final). Número vem do catálogo; o que muda
  é como o motor aplica.

## 3.4 Contadores independentes do PvE (contrato p/ client/server)

- `pve = { dmgTotal, dmgWindow (p/ DPS5s), healTotal }` — dano e cura são
  contadores independentes.
- Morte/respawn do monstro zera só `{dano,dps}` (`dmgTotal=0, dmgWindow=[]`);
  `healTotal` é preservado (sim `tick` respawn; E2E S3 comprova dano zerado).
- Reset manual (`{type:'pveReset', heal:true/false}` no servidor; botão "zerar"
  no cliente): sempre zera `{dano,dps}`; `heal` só zera se `heal:true`.
  Cliente local (fallback offline) deve espelhar: zerar dano/DPS sempre, cura
  só quando o usuário pede.
- Origem: PRODUTO §9 (dano/DPS zeram no reaparecer; cura com contador separado)
  + `lib/sim.js` respawn + `server.js#case 'pveReset'` (leitura; sem editar sim).

## 4. APROX restantes no sim (lógica/geometria, `shortcut:` em `lib/sim.js`)

Estruturados (custo/CD/alcance/AA/HP/EN) vêm do catálogo; o que segue é
simplificação de comportamento documentada no código, com teste:

| # | Local | Hipótese | Quando ajustar |
|---|---|---|---|
| S1 | `SK.E` Blood Bandit | 2 etapas direcionais em cone 30°/17m + LOS segmentBlocked (mira=servidor por ponto ou posição do inimigo; permite errar; cura etapa2 pelo mais próximo na trajetória, candidatos ordenados por projeção); custo40/CD10s/janela9s do catálogo; sem projétil/cone exato Albion | geometria real por skill |
| S2 | `useWeaponSkill` deadly-chop | cast 0,4s simplificado (trava breve, sem interrupção por movimento) | interrupção de cast |
| S3 | `dealDamage` vuln | W −16% resistência aplicado como +16% dano recebido 8s | fórmula Armor/MR exata (F.1) |
| S4 | `tick` bleeds | tick de sangramento 1/s (cadence real pendente) | ticks oficiais |
| S5 | `dealDamage` stone-skin | Defense ~33% como −16,7% dano recebido | curva exata de Defense |
| S6 | `dealDamage` escudos | escudo absorve o valor final (ordem exata por escudo pendente, F.3) | ordem pré/pós-resistência |
| S7 | `tick` monstro PvE | AA do monstro ~90 físico (hipótese, ajustar com teste) | medição em cliente |
| S8 | `MOVE_SPEED`/loop | 6 u/s, tick 20Hz, broadcast 10Hz (pressupostos operacionais §13) | teste de rede/latência |

Contagem: 32 linhas na tabela §3 (23 removida de APROX por virar dado D.6; 18 corrigida sem mudar contagem) + 6 estruturais no código + 8 de lógica acima = 46 marcas documentadas.

> Nenhuma afirmação de fidelidade comprovada com o cliente oficial; toda linha
> `baixa`/`media` é hipótese até observação em cliente (ver MATRIZ_COBERTURA.md).
