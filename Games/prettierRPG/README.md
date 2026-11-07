# PrettierRPG — arena em rede local (FFA + 2v2 + PvE)

Jogo de combate em navegador, 2D isométrico, inspirado em Albion Online.
Servidor Node autoritativo + cliente vanilla (sem CDN, tudo local).
Números do jogo vêm de um catálogo único: `data/equipment.json`
(T8 Normal, IP1100, base 1200HP/120EN; ver `docs/CATALOGO.md`).

## Requisitos

- Linux com **Node 18+** (testado em 24) e npm.
- Firefox ou Chromium na mesma rede local.
- Internet **só** no preparo (`npm ci`). Depois roda offline.

## Preparar (uma vez, online)

```bash
bash prepare.sh
```

Roda como seu usuário (sem root). Se falhar, a mensagem diz o motivo
(node/npm ausente, `package-lock.json` ausente ou `npm ci` sem internet).

## Iniciar

```bash
bash start.sh            # porta padrão 8094, host 0.0.0.0
PORT=8095 bash start.sh  # porta alternativa
HOST=127.0.0.1 bash start.sh  # só neste PC
```

Mostra o endereço local + URL da rede. Se a porta estiver ocupada, avisa e
sugere outra. Se o servidor já estiver rodando (pidfile), avisa em vez de
abrir outro.

## Acessar (rede local)

- Neste PC: `http://localhost:8094`
- Outro PC/celular na mesma rede: `http://<IP-mostrado>:8094`
- Descobrir o IP: o `start.sh` já mostra; ou `hostname -I`.

## Parar

```bash
bash stop.sh   # mata só o processo do projeto (pidfile + checagem)
```

## Jogar

1. Escolha apelido (único por sala), crie uma sala (código gerado) ou entre com o código.
2. Monte a build no editor (5 armas, 3 offhands, 3+3+3 armaduras, 6 capas,
   Q/W/E + passivas, incl. Soldier Armor com 2 passivas). O servidor valida a
   build completa; `Courier` é inerte e segue selecionável.
3. Marque **Pronto**. FFA: 2–12 prontos, 5 min. 2v2: 2 prontos por equipe
   (troque de equipe com 🛡; trocar build/equipe limpa o pronto).
4. Clique no chão = mover; clique no inimigo = atacar; **Q/W/E** = habilidades
   (mira por tipo: inimigo/aliado/ponto/direção/self); **Esc** = soltar
   alvo/cancelar mira; roda = zoom.
5. Morte no FFA: renasce em 5 s com proteção de 3 s (quebra ao atacar). Fim:
   placar e retorno ao lobby.
6. **Treino (PvE):** o botão ⚔ tenta o treino **em rede** (monstro + boneco do
   servidor, com dano/DPS/cura). Sem servidor, cai no **treino local** com
   aviso (fallback offline).
7. Saída pede confirmação (`confirm()`) e remove na hora.

Modo Hub (observador externo): abra com
`?hub=1&room=COD&name=APELIDO&create=1&hubUrl=...&htok=...` — entra sozinho
com validação e mostra botão de voltar ao Hub. Detalhes do protocolo em
`INTEGRACAO_GAME_HUB.md`.

## Testes

```bash
npm test   # node --test tests/ (embutido, sem dependência extra)
```

- `tests/catalog.test.js`: 23 itens, 97 skills sem placeholder, 65 arma + 59 armadura + 6 capas validam+calculam;
  Bloodlust exige `dano direto`+`limite` sem `+50`; Force Field custo 0 (D.6); stats exatos (2372/316, soldier 236/193).
- `tests/integration-catalog-sim.test.js`: FULL TODAS skills custo/CD/alcance/raio = `sim.skillParams`
  (fonte única); snapshot com valores reais (maxHp/maxEn=calcStats); PvE contadores independentes
  (`dmgTotal/dmgWindow` vs `healTotal`: respawn zera dano preserva cura).
- `tests/pronto-toast.test.js`: `chestPassive2` null/ausente = não enviado (só soldier exige 2ª).
- Cobertura por habilidade em `docs/MATRIZ_COBERTURA.md`; divergências sim-vs-catálogo em
  `.planning/prettierRPG-v2/findings.md` (com path:linha, sem editar sim).
  Fidelidade com o cliente oficial NÃO comprovada; `baixa`/`media` = hipótese até teste em cliente.

## Estrutura

- `server.js` — http estático + WebSocket autoritativo + Hub.
- `lib/sim.js` — simulação (FFA/2v2/PvE, skills, snapshot); números do catálogo.
- `lib/catalog.js` / `data/equipment.json` — fonte única de itens/skills (T8 Normal, IP1100, base 1200HP/120EN).
- `lib/build.js` — validação da build completa + `calcStats`.
- `lib/hub.js` — `GET /__hub/state` + `POST /__hub/close`.
- `lib/world.js` — arena/obstáculos/spawns.
- `public/` — cliente vanilla (`index.html`, `client.js`, `style.css`).
- `docs/PRODUTO.md` — especificação (preservada; contradição real → decisão registrada, sem rebaixar requisito).
- `docs/CATALOGO.md` — catálogo + APROX (32 §3 + 6 estruturais + 8 lógica §4; Bloodlust 30%/120/600, Force Field 0).
- `docs/MATRIZ_COBERTURA.md` — matriz por habilidade (catálogo? selecionável? UI? servidor? efeito? tooltip? PvP/PvE? APROX?).
- `.planning/prettierRPG-v2/findings.md` — divergências sim/cliente-vs-catálogo com path:linha.

## Onde alterar dados do jogo

- Números de itens/skills (dano, custo, CD, alcance): `data/equipment.json`
  (via `lib/catalog.js`; o sim e o cliente consomem de lá — sem duplicar).
  Bloodlust = `effect`/`formula`/`approx` em `equipment.json:148`; Force Field custo em `:158`.
- Regras de partida (tempos, respawn, wave): constantes no topo de `lib/sim.js` (outra lane; só ler).
- PvE contadores independentes (contrato §3.4): `dmgTotal/dmgWindow` vs `healTotal` — respawn zera dano,
  manual `pveReset {heal:true/false}` zera dano sempre e cura só se pedido; ver `docs/CATALOGO.md §3.4`.
- A ferramenta fonte é o `docs/PRODUTO.md`; divergência resolve a favor do
  catálogo (derivado do 3º levantamento) e é documentada (sem rebaixar requisito do produto).

## Limitações atuais

- Geometrias de skill simplificadas (alvo+direção; sem projétil/cone exato) —
  ver `shortcut:` em `lib/sim.js` e §4 de `docs/CATALOGO.md`.
  Aproximação numérica (§3) ≠ simplificação de comportamento (§4); nenhuma afirma paridade comprovada.
- Bloodlust no catálogo agora é `cura 30% do dano direto, cap 120/acerto e 600/buff` (APROX preservando principal);
  sim (`lib/sim.js:941-943`) e tooltip (`public/client.js:133`) ainda fazem `+50/+30 por AA` — ver findings.
  Force Field custo 0 no catálogo (D.6); tooltip ainda diz 15 — ver findings.
- `W` cast 0,4 s sem interrupção; E do Machado em 2 etapas alvo-direcional.
- Sem sons além dos sintetizados; visual próprio minimalista.
- PvE em rede: 1 jogador por sala; monstro corpo-a-corpo + boneco de cura; contadores independentes
  (respawn zera dano/DPS preserva cura; manual zera dano sempre, cura só se `heal:true`).
- Capas usam últimos tooltips arquivados (75/139/182/225/15s), não cliente atual; Caerleon 60s hipótese §14.
- Hub real NÃO verificado (só smoke local); sem `HUB_SECRET` o jogo segue independente (503 sem quebrar).

## Solução de problemas

- `Porta 8094 ocupada`: `PORT=8095 bash start.sh`.
- `Servidor já em execução`: `bash stop.sh` antes (ou use a instância atual).
- `Rode primeiro: bash prepare.sh`: `node_modules` ausente.
- `Falha de conexão` no cliente: confira IP/porta e firewall da rede local;
  o treino local segue disponível como fallback.
- `Build inválida: ...`: o editor mostra o campo; Soldier Armor exige 2ª
  passiva (`spirit-crush`/`protective-instinct`); `chestPassive2` só nela.
- Sala não libera o código: todos saíram? Saída voluntária remove na hora;
  queda de conexão segura a vaga 30 s (reconecte com o mesmo apelido).
