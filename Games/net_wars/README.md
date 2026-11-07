# NET WARS — combate espacial arcade multiplayer

3D space combat no navegador: até **12 pilotos por sala**, modos **FFA / teams / survival-vs-bots**,
2 armas (laser + míssil teleguiado), boost, 6 power-ups, timer PvP de 5 min.
Servidor autoritativo em Node 20+ com 1 dependência (`ws`). Sem build, sem CDN, 100% offline depois de preparado.

## Preparação

Requisito: **Node 20+** (testado também em v24).

```bash
node --version   # precisa ser >= 20
npm install      # única dependência de runtime: ws
```

## Execução

```bash
node server/main.js
# net-wars on http://0.0.0.0:8080 (MATCH_LEN_S=300)
```

Variáveis de ambiente (único ponto de `process.env` é `server/main.js`):

| Var | Default | Efeito |
|-----|---------|--------|
| `HOST` | `0.0.0.0` | endereço de escuta |
| `PORT` | `8080` | porta HTTP + WebSocket |
| `MATCH_LEN_S` | `300` | duração da partida PvP (segundos) |
| `HUB_SECRET` | `""` (vazio) | segredo do endpoint `POST /__hub/close`; vazio = close recusado com 403, jogo independente funciona normal |

Exemplos:

```bash
MATCH_LEN_S=30 node server/main.js          # partida curta (teste)
HOST=127.0.0.1 PORT=9001 node server/main.js
HUB_SECRET=s3cr3t node server/main.js       # libera o close autenticado do Hub
```

Atalho de teste: `?len=30` na URL da partida também encurta o timer
(ex.: `http://localhost:8080/?len=30`).

## Teste em 2 abas (mesma máquina)

1. Abra `http://localhost:8080` em **2 abas**.
2. Na aba 1 clique **+ criar sala** (gera código de 5 letras); na aba 2 digite o mesmo código e clique **➤ entrar**. Use apelido e cor diferentes.
3. No hangar (lobby) clique **🚀 VOAR!** nas duas abas.
4. **Clique na arena** para travar a mira (pointer lock) e ligar o som. Voe, atire, confira que cada aba vê a outra nave se mover e os lasers replicados. `Tab` mostra o placar.
5. Com `MATCH_LEN_S=30` (ou `?len=30`), aguarde o fim e confira a tela de resultados + botão **🔁 revanche**.

## Lobby, prontidão e início

A sala nasce em `lobby` (hangar): simulação pausada, sem timer. O cliente reage a
`sala.state` (`lobby|playing|over`) e a `ship.ready` de cada piloto no snapshot.

1. Entrar → hangar mostra pilotos, host (♛) e quem marcou `PRONTO ✓`.
2. **Estou pronto** envia `{t:'ready', v:1}` (tocar de novo cancela, `v:0`); todos veem.
3. **Host clica INICIAR PARTIDA** → `{t:'start'}` (só host, só em lobby) → sala vai a `playing`.
4. 🌀 (só host, lobby, modo teams) envia `{t:'shuffle'}` e redistribui RED/BLUE.
5. Fim (`over`) → tela de resultados; **🔁 revanche** (`{t:'rematch'}`) leva todos à nova partida.

Mensagens de protocolo (JSON via WS, validadores em `shared/protocol.js`):
`start`, `ready` (`v: 0|1`), `shuffle` — o servidor ignora `start`/`shuffle` de não-host
e fora do lobby. Reconexão: até 3 tentativas com backoff (1 s/2 s/4 s). Morte/respawn
e placar (kills **e deaths**) são autoridade do servidor via snapshot.

## Acesso em rede local (LAN)

O servidor escuta em `0.0.0.0` por padrão, então basta descobrir o IP da máquina anfitriã:

```bash
hostname -I | awk '{print $1}'   # ex.: 192.168.1.202
```

Nos outros computadores da mesma rede, abra `http://192.168.1.202:8080` (troque pelo IP real).
**Não use `localhost` nos outros computadores** — `localhost` é sempre a própria máquina.
Firewall da máquina anfitriã precisa permitir a porta (ex.: `sudo ufw allow 8080/tcp`).

Limitação honesta: testado via loopback e `127.0.0.1` (suíte automatizada); partida real com 2 máquinas físicas diferentes na LAN **não foi testada**.

## Acesso pela internet

O jogo não atravessa NAT sozinho. Condições para jogar fora da LAN:

- **Port-forwarding**: redirecionar `PORT` (TCP) no roteador para o IP local do anfitrião, ou
- **Túnel reverso**: expor a porta com ferramenta de túnel (ex.: `ssh -R 8080:localhost:8080 vps`,
  Cloudflare Tunnel, ngrok) e distribuir a URL pública.

Sem uma dessas condições, o jogo fica restrito à rede local. Internet real **não foi testada**.

## Controles (✛ nariz = ONDE ESTÁ o tiro · ○ mouse = PARA ONDE VAI, só 3ª pessoa)

Em 1ª pessoa o mouse **gira a nave direto** (por evento, sem cursor, sem atraso);
em 3ª pessoa o mouse move a mira desejada e o nariz persegue com taxa limitada.

| Tecla | FP cockpit (padrão, NetWars 1993) | TP atrás (War Thunder) |
|-------|-----------------------------------|------------------------|
| mouse | gira a nave direto (sem cursor ○) | mira desejada ○ (perseguição 1.8 rad/s + bank automático) |
| `W` / `S` | empuxo frente / ré (momentâneo) | manete (persiste; mostra % no HUD) |
| `A` / `D` | rolagem manual | bank fino + leme coordenado |
| `click` (segurar) | laser em rajada (cadência 0,5 s servidor) | igual |
| `E` ou botão direito | míssil teleguiado (lock `◉`, recarga 9 s) | igual |
| `F` | troca arma selecionada | igual |
| `Shift` + `W` / manete | boost (drena energia) | boost (com manete > 5%) |
| `Tab` / `Esc` / `M` / `H` | placar / pausa / mudo / ajuda | igual |

Câmera (menu, hangar e ⚙): **🎥 1ª pessoa cockpit** (rígida, nave oculta) ou **✈ 3ª pessoa WT** (chase suavizado atrás/acima).

## Regras curtas

- **FFA (livre para todos, 2–12):** cada um por si; maior número de abates vence. Empate fica explícito no placar.
- **Teams RED×BLUE (1v1–6v6, até 12):** soma de abates por time vence; **fogo amigo desligado** (não acerta aliado nem trava míssil em aliado). Time `auto` equilibra; `🌀 auto-distribuir` rearranja no lobby.
- **Survival coop (1–12 humanos):** ondas infinitas de bots (intervalo 5 s, máx. 6 bots vivos). Humano não fere humano. Quem cai volta na próxima onda; se todos caírem com onda ≥ 1, derrota coletiva. Sem timer (relógio mostra ∞).

Comum aos modos: respawn 3 s + proteção 2 s (atirar encerra a proteção antes); colisão com estação/asteroides causa 2–5 de dano; nave × nave só empurra, sem dano.

## Balance final

Tabela completa com justificativas em [`docs/VALOR_BALANCE.md`](docs/VALOR_BALANCE.md). Resumo:

| Sistema | Valor final |
|---------|-------------|
| Laser | dano **10**, cadência **0,5 s** → 20 DPS, TTK ~5 s numa nave de 100 HP |
| Buffs (15 s, sem acúmulo) | Cadência cd×0,8 · Sobrecarga dano×1,2 · Triplo laterais a 20% (×1,4 se todos acertarem); combinados ≈ **2,1x DPS** |
| Míssil | dano **35**, recarga **9 s** por nave, vel. 55, curva 1,7 rad/s, vida 6 s, lock cone ~12° até 140 m **com linha de visada** |
| Boost | dreno **28/s**, regen **10/s** (×1,9 com Propulsão), velocidade ×1,7 |
| Colisão cenário | **2–5** por impacto (escala com velocidade), cooldown 1 s por nave |
| Power-ups | 6 tipos em pontos fixos, respawn **20 s**, efeito **15 s** renovável; Reparo +40 (teto 100), Escudo teto 40 |
| Waves survival | intervalo **5 s**, máx. **6** bots vivos, bots com HP 40+5/onda |
| Sala | máx. **12** humanos (13ª conexão recusada `full`/close 1013); reconexão **30 s** sem duplicar |

Fonte única dos valores: `shared/constants.js`.

## Game Hub

Modo independente é o padrão. Modo Hub ativa com `?hub=1` na URL (apelido, sala, time e token vindos do Hub são aproveitados sem redigitar; `create=1` fica no lobby p/ iniciar, `create=0` entra direto; botão `← voltar ao hub` usa `hubUrl` validada só `http/https`).
Close do Hub: `POST /__hub/close?room=<código>&htok=<token>` (idempotente, checa dono).
Detalhes, endpoints (`GET /health`, `GET /__hub/state`, `POST /__hub/close`) e pendências:
[`INTEGRACAO_GAME_HUB.md`](INTEGRACAO_GAME_HUB.md).

## Créditos

- **Three.js r160 (MIT)** vendorizado em `vendor/three.module.js` (1 arquivo, sem CDN, offline).
- **Áudio 100% sintetizado** via WebAudio (`client/audio.js`): motor, laser, míssil, lock, explosões, coletas, contagens — zero assets externos.
- Única dependência de runtime: [`ws`](https://github.com/websockets/ws) (WebSocket server).

## Limitações honestas (o que foi testado vs não)

Testado e verde (2026-11-02): `npm test` **18/18**, `node tests/ws-check.mjs` **14/14**
(2 salas isoladas, 12 vagas + 13ª rejeitada, hub 403/404/idempotente), e suíte visual
headless (Chromium + CDP) **26/26 com zero erros de console em 6 abas** — ver
[`docs/VALIDACAO.md`](docs/VALIDACAO.md).

Não testado / parcial:

- Áudio audível real (headless é mudo — o código sintetiza tudo, mas ninguém ouviu de verdade).
- Pointer-lock de verdade (headless negava; tratado com fallback).
- 12 pessoas reais simultâneas; perda de pacote; reconexão de 30 s em navegador real.
- Acesso LAN entre 2 máquinas físicas; acesso pela internet; offline real com rede desligada
  (offline foi provado por `grep` estático: nenhum `http(s)` externo em runtime em
  `client/`, `server/`, `index.html` — só `http://x` dummy de `new URL` e log no servidor).
- Telas < 720 px (só CSS responsivo básico).
- Hub real indisponível no ambiente — integração testada só do lado do jogo
  (detalhes em `INTEGRACAO_GAME_HUB.md`).

Arquitetura: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) · Balance: [`docs/VALOR_BALANCE.md`](docs/VALOR_BALANCE.md) · Evidências: [`docs/VALIDACAO.md`](docs/VALIDACAO.md)
