# Valor & Balance final

Fonte única: `shared/constants.js`. Base de comparação ("antes") = valores antigos do
`findings.md` (fase 1) e iterações intermediárias do incremento 2.

## Tabela final

| Sistema | Valor | Antes |
|---------|-------|-------|
| Nave HP / raio | 100 / 2,4 | 100 / 3 |
| Vel. máx / aceleração / roll | 28 u/s · 26 u/s² · 2,4 rad/s | 60 u/s · 50 u/s² (rápido demais p/ arena) |
| Laser dano / cadência | **10** / **0,5 s** → 20 DPS, TTK ~5 s | 25 sem cadência (DPS ilimitado no hold) → 12 intermediário |
| Laser alcance | vel. 130 × vida 1,2 s ≈ 156 m | 220 × 1,5 s ≈ 330 (atravessava a arena) |
| Buff Cadência | cooldown ×0,8 (→ 25 DPS) | `rapid 8s cd 0,1s` (10x DPS — quebrava o jogo) |
| Buff Sobrecarga | dano ×1,2 (→ 24 DPS) | `double-dmg 8s` (2x sozinho, sem tradeoff) |
| Buff Triplo | 2 laterais a **20%** (×1,4 se todos acertarem) | sem equivalente |
| Combinados | 1,25×1,2×1,4 ≈ **2,1x DPS** (~42) | — |
| Míssil dano / recarga | **35** / **9 s** por nave | 50 / 2 s / ammo 3 (spam de one-shot relativo) |
| Míssil voo | vel. 55, curva 1,7 rad/s, vida 6 s | 90 + homing 2,5 rad/s (grudava demais) |
| Míssil lock | cone ~12° até 140 m **com linha de visada**; perde alvo obstruído; sem aliado | lock no mais próximo do cone, sem LOS |
| Boost | dreno **28/s**, regen **10/s** (×1,9 Propulsão), vel. ×1,7 | ×1,8, 30 dreno / 15 regen (uptime alto demais) |
| Colisão cenário | **2–5** por impacto (escala com velocidade), cooldown 1 s/nave | sem colisão (fase 1) |
| Nave × nave | só afasta, sem dano | — |
| Power-ups | 6 fixos, respawn **20 s**, efeito **15 s** renovável sem acúmulo, removido ao morrer | respawn 10 s, 8 pontos, durações 5–8 s |
| Reparo / Escudo | +40 (teto 100) / teto 40 | `hp+50` / `shield 50` (cheio demais p/ TTK 5 s) |
| Survival | gap **5 s**, máx. **6** bots vivos, bot HP 40+5/onda, erro 0,06 rad, alcance 80 | 3+N bots, hp 50 fixo |
| Respawn / proteção / reconnect | 3 s / 2 s (atirar encerra) / 30 s | respawn 3 s (igual) |
| Sala / partida | máx. 12 humanos; PvP 5 min server-side | — |

## Justificativas das mudanças principais

- **Laser 12→10 + cadência 0,5 s:** sem cadência, segurar o click = DPS infinito e TTK
  ditado só pela mira. 20 DPS base dá ~5 s de fogo certeiro p/ derrubar 100 HP —
  tempo suficiente p/ reagir, fugir ou buscar reparo.
- **Míssil 35 (vs 30 cogitado):** 30 deixava o míssil como "chip damage" irrelevante
  perto do laser buffado (~42 DPS combinados); 35 = pouco mais de 1/3 do HP, exige
  acompanhamento de laser p/ finalizar, sem one-shot. A recarga longa (9 s, por nave,
  preservada ao trocar de arma) e o lock exigente (mira + 140 m + LOS, sem aliado)
  são o verdadeiro custo — não o dano.
- **Buffs somando ~2,1x em vez de 10x:** o `rapid 0,1s` antigo multiplicava o DPS por 10
  sozinho e decidia a partida num pickup. Os três buffs atuais são comparáveis entre si
  (×1,2–1,4) e só combinados chegam a ~2x — forte, mas contestável, e com duração curta (15 s).
- **Boost dreno > regen:** 28/s vs 10/s garante que boost é rajada tática (~3,5 s cheio),
  não modo de voo permanente; Propulsão (×1,9 regen) dobra o uptime sem quebrar a regra.
- **Impacto 2–5 com cooldown:** punir "dirigir distraído" sem decidir lutas; o cooldown de
  1 s por nave evita morte por fricção em raspadas longas (o tunneling do laser na fase 1
  ensinou: dano por quadro é armadilha).
- **Power-ups 20 s / 15 s:** uptime máximo de 75% por ponto força rotação no mapa em vez de
  camping; efeito renovável (não acumulável) evita snowball de quem coleta 2× seguidas.
- **Waves gap 5 s / 6 bots:** respira entre ondas sem esfriar; 6 vivos é o teto que a arena
  e o snapshot 10 Hz sustentam sem virar bullet-hell ilegível.
