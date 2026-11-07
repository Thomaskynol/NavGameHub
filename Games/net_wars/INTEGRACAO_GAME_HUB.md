# Integração Game Hub — suporte do lado do jogo

> **Hub real indisponível neste ambiente.** O contrato foi implementado a partir da
> referência `integrar_game_hub.txt` (§§ 1–10). Nada do Hub foi alterado; o registro no
> catálogo será feito posteriormente, fora deste projeto.

## 1. Modo independente (padrão)

Uma pessoa inicia o servidor e os jogadores entram pelo navegador:

```bash
npm install
node server/main.js        # http://<ip>:8080
```

Criar sala (código de 5 letras) ou entrar por código, lobby com prontidão/equipes,
`VOAR!`, resultados + revanche. Funciona sem nenhuma variável Hub e sem internet
depois de preparado (Three.js vendorizado, áudio sintetizado, zero CDN).

## 2. Modo Hub — ativação `?hub=1`

O jogo é aberto (normalmente num iframe) com:

```
?hub=1&room=<código>&name=<apelido>&create=1|0
  &expect=<n>&slot=<slot>&hubUrl=<url>&htok=<token>
  [&mode=ffa|teams|survival] [&color=#rrggbb]
```

| Parâmetro | Tratamento (validado) |
|-----------|----------------------|
| `hub=1` | ativa overlay (`client/hub.js`, polling `/__hub/state` a cada 2 s) + nota "vindo do Game Hub" |
| `room` | código da partida; normalizado p/ minúsculas; `sessionStorage` por aba |
| `name` | apelido (1–20 chars, validado também no servidor via `validHello`); **não pedido de novo** |
| `color` | só aceito se `#[0-9a-fA-F]{6}`, senão ignorado |
| `create` | `1` (criador) fica no lobby e inicia quando a turma chega; `0` (convidado) entra direto na partida (`shouldAutoEnter` em `client/hub.js`); ausente (link direto) entra direto só se `expect<=1` |
| `expect` | número; exibido como "aguardando ~N jogadores (hub)"; `0`/ausente = sem expectativa |
| `slot` | `red`/`blue` pré-seleciona a equipe (só vale no modo teams e com lobby vazio); outro valor = auto |
| `hubUrl` | botão `← voltar ao hub` **só aparece se for `http:`/`https:` válido**; resto é ignorado (anti open-redirect) |
| `htok` | token opaco da instância (≤64 chars); enviado no `hello` e guardado como dono da sala |
| `mode` | `ffa`/`teams`/`survival`; inválido = mantém seleção do menu |

Valores ausentes/inválidos nunca quebram o fluxo: caem para o comportamento independente
(menu/lobby normal). Campos novos do protocolo são sempre opcionais; o cliente ignora
mensagens `t` desconhecidas. URLs, assets e WS usam caminho relativo/`location.host` —
funcionam por IP da LAN, sem `localhost` obrigatório. Nada bloqueia uso em iframe
(sem `X-Frame-Options`, sem CSP restritiva).

## 3. Salas, códigos, htok e colisões

- Uma sala = código (`room`, 1–32 chars). Várias salas simultâneas, isoladas
  (participantes, estado, eventos, placar — ws-check prova 2 salas sem vazar ships).
- Sem limite global de salas; sala vazia (0 ships) é removida no purge.
- `htok` = identidade da **instância** do Hub (não é autenticação de usuário).
  A primeira conexão que cria a sala com `htok` vira dona; quem chegar depois com
  `htok` **divergente** recebe `denied CODE_TAKEN` + close 1013 — nunca entra na sala alheia.
- Retentativa legítima (mesmo `htok`, mesma instância): entra normalmente.
  Reconexão em 30 s via `resume: <id anterior>` retoma fantasma sem duplicar
  (kills/placar preservados); fantasma expira após 30 s (`RECONNECT_S`).
  `resume` sem token imprevisível (`resumeToken` do `welcome`) ou com token
  errado → `denied DUP` + close 1013 (id sequencial sozinho não autoriza).
- Capacidade: **12 humanos/sala** enforced no servidor; a 13ª recebe `denied full` + close 1013.
- **Nomes duplicados são permitidos**: apelido (`name`) não é identidade — dois
  jogadores podem usar o mesmo nome; identidade é o id da conexão (`pN`).
  Placar/desempate usam o id; o Hub não deve assumir unicidade de nome.

## 4. Mínimo / máximo real de jogadores

| Modo | Mínimo p/ jogar | Máximo |
|------|----------------|--------|
| FFA | 1 (abre), 2 p/ fazer sentido | 12 |
| Teams | 2 (1v1; abaixo disso vira espera) | 12 (6v6) |
| Survival | 1 (solo vs bots funciona) | 12 humanos (+ até 6 bots vivos) |

O servidor não impõe mínimo (1 jogador sozinho abre partida); o mínimo acima é o
**significativo para gameplay**. Máximo de 12 é rígido (`FULL`).

## 5. Late-join (entrar com partida em curso)

- A sala nasce em `lobby` (simulação pausada) e só vai a `playing` quando o **host**
  envia `{t:'start'}`; prontidão é `{t:'ready', v:0|1}` (visível p/ todos no snapshot
  via `ship.ready`); `{t:'shuffle'}` redistribui equipes (só host, lobby, teams).
  O cliente reage a `snapshot.state` (`lobby|playing|over`) — o Hub identifica o fim
  via polling de `/__hub/state` (sala some / `state:"over"`).
- **FFA:** entra direto, spawna na hora (desvio consciente: preserva o loop clássico FFA).
- **Teams / Survival:** com partida em curso e ≥ 2 humanos ativos, recebe
  `welcome.waitNext` e assiste como `waitNext` — entra na **próxima partida** (teams)
  ou **próxima wave** (survival; quem morre no survival também volta na próxima wave).
- Pré-partida (< 2 ativos) ou partida já encerrada (`over`): spawna direto em qualquer modo.
- Essa regra permite ao Hub decidir entre admitir ou segurar o jogador na sala do Hub.
- **Mínimos para iniciar** (`start` só faz sentido com): FFA ≥ 1 humano, teams ≥ 2
  (1v1; abaixo disso vira espera), survival ≥ 1. O servidor não barra `start`
  abaixo disso — o mínimo acima é significativo para gameplay, não enforced.
- **Início simultâneo**: `start` do host gera `event lobby` + `snapshot(state:"playing")`
  para todos; não há largada escalonada.
- **Host ausente**: host = menor `joinSeq` entre conectados (migra sozinho quando o
  host sai/cai; `hubOwner` acompanha). Sem host conectado, `start`/`shuffle`/`rematch`
  de não-host são ignorados (rematch pré-`over` só pelo host).

## 6. Ambiente, porta e saúde

| Item | Valor |
|------|-------|
| `HOST` / `PORT` | `0.0.0.0` / `8080` (só lidos em `server/main.js`) |
| `MATCH_LEN_S` | duração PvP (default 300); `?len=` também aceito por partida |
| `HUB_SECRET` | segredo compartilhado do close; vazio = close sempre 403, jogo segue normal |
| Saúde | `GET /health` → 200 `{ok:true,…}` (sonda do Hub) e `GET /__hub/state` → 200 (além do estado) |
| Input obsoleto | `INPUT_STALE_MS` = 1500 ms sem input novo → neutralizado (sem empuxo/tiro, a nave deriva); `disconnect`/`leave` descartam o input na hora |
| TLS | o servidor fala **HTTP/WS puro (sem TLS nativo)** — `https:`/`wss:` terminam no proxy/reverso à frente; o cliente WS sobe p/ `wss:` sozinho quando a página é `https:` |

## 7. Endpoints implementados (contrato `hub/PROTOCOLO.md`)

`GET /health` → 200 `{ok:true, game:"net-wars", uptimeS}` (sonda do Hub; sem auth).

### `GET /__hub/state?room=CODIGO` → 200 (leitura, sem auth)

```json
{ "ok": true, "room": {
  "code": "abc123", "phase": "lobby|playing|results",
  "players": 3, "capacity": 12, "joinable": true,
  "startedAt": 1730000000000, "hubOwner": "HTOK-DO-LAUNCH"
} }
```

- Sala inexistente → `404 {ok:false, error:"NOT_FOUND"}` (livre).
- Códigos são case-insensitive (o Hub passa MAIÚSCULA, o cliente cria minúscula).
- Sem histórico persistente neste jogo: nenhum código é bloqueado (sem 409;
  sala fechada volta a 404 = livre).
- `phase`: `lobby|playing → iguais`, `over → results`. `players` = **humanos**
  (conectados + fantasmas que seguram vaga); **bots de survival NÃO contam**.
  `joinable` = vaga (`< 12`) e (`lobby`, ou `playing` em FFA — teams/survival
  com partida em curso recebem `waitNext`). `hubOwner` = htok opaco do launch
  que criou a sala (`string`), `null` = sem dono (sala manual/standalone —
  o Hub trata como alheia e nunca a adota). `startedAt` só quando há timer.
- Sem `?room=` (ou vazio) mantém o formato lista legado (overlay `?hub=1` + ferramentas):

```json
{
  "rooms": [
    { "room": "abc12", "mode": "ffa", "state": "playing",
      "players": 3, "host": "p1", "wave": 2, "endsInS": 241 }
  ],
  "uptimeS": 87
}
```

- `host` = menor `joinSeq` (migra sozinho); `wave` só em survival; `endsInS` = 0
  em survival (sem timer).
- Leitura aberta (sem `x-hub-secret`): o Hub envia o segredo, o navegador não tem.

### `POST /__hub/close?room=CODIGO&htok=TOKEN` com `x-hub-secret: <HUB_SECRET>`

```json
{
  "rooms": [
    { "room": "abc12", "mode": "ffa", "state": "playing",
      "players": 3, "host": "p1", "wave": 2, "endsInS": 241 }
  ],
  "uptimeS": 87
}
```

- `players` = **humanos** (conectados + fantasmas que seguram vaga); **bots de
  survival NÃO contam** (não ocupam vaga das 12). `host` = menor `joinSeq` (migra sozinho);
  `wave` só aparece em survival; `endsInS` = 0 em survival (sem timer) / survival usa `null` interno.
- Close idempotente sem memória: sala inexistente → `200 {ok:true, closed:false}`
  (sem `everExisted`/teto — removido; nenhuma evicção quebra a idempotência).
- Teto de corpo (`MAX_HTTP_BODY` = 8192) conta **bytes**, não chars (multibyte não
  dribla o 413).

### `POST /__hub/close` com `x-hub-secret: <HUB_SECRET>` → JSON

Corpo: query `?room=<código>&htok=<token>` (legado: corpo JSON `{ "room": "…" }`
ainda aceito quando a query não traz `room`; `htok` só via query).
Resposta: `{ "ok": true, "closed": true|false }`.

- Sem `HUB_SECRET` configurado **ou** header divergente → `403 {ok:false, error:"FORBIDDEN"}`.
- Sala inexistente → `200 {ok:true, closed:false}` (**idempotente**, não 404).
- Repetir o pedido → `200 {ok:true, closed:false}`.
- Sucesso → `200 {ok:true, closed:true}` (único caso que o Hub conta como fechado).
- Com dono (`htok` guardado na criação): só fecha se o `htok` conferir;
  divergente/ausente → `403 {ok:false, error:"FORBIDDEN"}` e a sala segue intacta —
  nunca fecha a sala de outro launch.
- Sem dono (manual/standalone): só fecha SEM `htok` (legítimo); COM `htok` →
  `403` e preserva (close afiliado atrasado de outra partida).
- `"*"` sem `htok` fecha tudo (limpeza manual); com `htok` → `403`.
- Fecha com broadcast `event over` para os jogadores da sala; outras salas intactas;
  sala vazia some no purge seguinte. O segredo nunca vai ao
  navegador/código-fonte versionado/logs.
- Teto de corpo (`MAX_HTTP_BODY` = 8192) conta **bytes**, não chars (multibyte não
  dribla o 413).

## 8. Fim da partida e retorno ao Hub

- Fim real = broadcast `event {kind:"over", scores, winner, draw}` (PvP, empate explícito)
  ou `{kind:"over", defeat:true, wave}` (survival); `snapshot.over` congela o estado.
- Nunca forjado: sem timer expirado / sem wipe real, não há `over`.
- **Idempotente**: exatamente um `over` por partida (`overSent`); ticks tardios,
  `purge` e `reconnect` pós-`over` não reemitem. `snapshot.result` = `{winner, draw}`
  (PvP) ou `{defeat, wave}` (survival) — chaves estáveis.
- **Placar de fantasma vale**: desconectar/sair não apaga kills (vão ao `scores`
  e a `leftScores` no purge); revanche (`rematch`/`reset`) zera tudo, inclusive
  fantasmas — quem reconectar depois da revanche volta zerado.
- Tela de resultados preservada no cliente + **revanche** (independente) e botão
  `← voltar ao hub` (modo Hub, `hubUrl` validada).
- O Hub identifica o fim via polling de `/__hub/state?room=` (`phase:"results"`);
  não há callback ativo do jogo para o Hub.

## 9. Registro futuro no Hub (fora deste projeto — não alterar agora)

Quando o jogo for adicionado ao Game Hub, revisar **no projeto do Hub**:

1. `Docs/INTEGRACAO_JOGOS.md` — contrato vigente (pode ter mudado desde esta referência).
2. `hub/PROTOCOLO.md` — lado do jogo implementado (§7 acima); conferir versão do Hub.
3. `hub/games.json` — registrar o jogo (id, nome, URL/min-max, `healthPath: "/health"`,
   midMatchJoin por modo, `hubUrl` de retorno, capability `htok`).
4. Implementação e testes do Hub que consomem `/__hub/state` e `/__hub/close`.

Pendente de validação na integração: teste fim-a-fim com o Hub real (abrir via iframe com
os 8 parâmetros, criar/entrar automático, lotação, `CODE_TAKEN`, close do Hub, voltar via
`hubUrl` — o fluxo create=1/0 do cliente ainda não foi exercido em navegador).

## 10. Testes executados e limitações

Executado do lado do jogo (evidências em `docs/VALIDACAO.md`):

- `npm test` 192/192 (inclui `tests/hub-contract.test.js` com 13 casos do contrato:
  envelope por sala, 404 livre, 403 dono, idempotência, create=1/0, standalone intacto).
- `node tests/ws-check.mjs` OK: 2 salas isoladas, 12 + 13ª rejeitada (`denied full`/1013),
  close 403 sem segredo, close 200 idempotente (`{ok:true,closed:false}` p/ inexistente),
  allowlist estática, rematch com auth, LEAVE imediato, MATCH_LEN_S inválido,
  **start/ready com auth (P1-10)**, **hub players exclui bots + corpo multibyte → 413 (P1-14)**.
- Porta do teste live de `fire-channel.test.js` movida de 18111 → 18114 (colidia com
  `integration-extras.test.js`, que usa 18111–18113 — ver §10 limitações).
- Navegador headless (CDP) 26/26: `?hub=1&room&name&expect=3` entra no lobby sem redigitar;
  hub-box lista salas; voltar validado.
- Offline: `grep` estático limpo (nenhum `http(s)` externo em runtime).

Limitações conhecidas:

- **Hub real não disponível** — nada foi testado contra o Hub de verdade; o fluxo
  `create=1` (criador no lobby) / `create=0` (convidado entra direto) foi validado
  em lógica pura + servidor real, mas não em navegador com o Hub.
- Colisão de portas entre arquivos de teste (paralelos no `node --test`) derruba o
  servidor do vizinho de forma confusa (`ready()` enxerga o servidor errado):
  cada arquivo live usa porta própria; ao adicionar teste live, usar porta nova.
- `slot` além de `red`/`blue` é ignorado (sem numeração de cadeiras); `expect` é informativo.
- Reconexão exige mesmo servidor/processo (fantasma em memória; sem persistência).
