# Integração Game Hub — PrettierRPG (lane CATÁLOGO)

> Revisão lane CATÁLOGO em 2026-11-06 (antes: lane núcleo). Servidor é autoridade; Hub é observador/coordenador externo.
> Sem `HUB_SECRET`, o jogo funciona independente; endpoints do Hub recusam (503).
> Integração com Hub REAL não executada/verificada — abaixo é contrato + smoke local; sem afirmar Hub real.

## Modo independente × modo Hub

- **Independente (padrão):** sem `HUB_SECRET`, sem `?hub=1`. Criar/entrar por código, lobby, pronto, jogar, voltar.
  `GET /__hub/*` responde `503 {error}` sem afetar salas.
- **Hub (observador externo):** Hub guarda `room`+`htok` e pode consultar/fechar via `HUB_SECRET`.
  Cliente abre com `?hub=1&room=COD&name=APELIDO&create=1|0&hubUrl=...&htok=...` — cria/entra
  automaticamente na sala indicada (sem gerar outro código em silêncio), com validação, e
  mostra botão de voltar ao Hub. Colisão real (mesmo código + `htok` divergente) responde
  `CODE_TAKEN` e o cliente mostra erro honesto, sem join cego.
  (Pendente Thomas: onde o modo é decidido — Hub room vs catálogo vs in-game. A URL do Hub
  não carrega modo; cliente não envia default novo e o servidor mantém o fallback
  pré-existente só p/ não quebrar criação. Testes usam fixture explícita `ffa` marcada provisória.)

## Variável / rede (HOST/PORT/health)

- `HUB_SECRET`: segredo compartilhado entre Hub e servidor (header `x-hub-secret`).
  Ausente/vazio => `GET /__hub/state` e `POST /__hub/close` respondem `503 {error}` sem afetar salas.
- `HOST` (só IP literal, ex. `0.0.0.0`/`127.0.0.1`; herança inválida cai p/ `0.0.0.0` com aviso) e `PORT` (padrão 8094).
  `start.sh` mostra endereço local + URL da rede; porta ocupada sugere outra; pidfile evita duplicata.
- Health: `GET /health` (200 `{ok:true}`) p/ sonda do Hub; `GET /` (200 HTML) e WebSocket na mesma porta.
  Sem internet após `prepare.sh` (`npm ci` online; depois offline).

## Endpoints

### GET /__hub/state?room=CODE[&htok=TOKEN]

- `404 {ok:false, error:'NOT_FOUND'}`: código livre (sem sala local).
- `200 {ok:true, room:{code, phase, players, capacity, joinable, hubOwner, mode}}`:
  - `phase`: `lobby`|`playing`|`results` (mapeia `ended`=>`results`; honesto, sem inventar).
  - `players`: ativos (`!left`); `capacity`: 12 (PvE 1; 2v2 4); `joinable`: só `lobby` com vaga.
  - `hubOwner`: `htok` guardado na criação dirigida pelo Hub; `null` em sala standalone.
- `409 {ok:false, error:'CODE_TAKEN', hubOwner}`: `htok` informado diverge do dono guardado.

### POST /__hub/close?room=CODE&htok=TOKEN

Header: `x-hub-secret: <HUB_SECRET>`.

- `503`: sem `HUB_SECRET` (recusa sem quebrar jogo).
- `403`: segredo inválido ou `htok` diverge do dono guardado.
- `200 {ok:true, closed:true|false, room}`: idempotente. Sala inexistente => `closed:false`
  sem checar dono (nada a preservar).
  - Com dono: só fecha se o `htok` conferir; divergente/ausente => `403 FORBIDDEN` e preserva.
  - Sem dono (standalone/legada): só fecha SEM `htok` (legítimo); COM `htok` => `403 FORBIDDEN`
    e preserva (close afiliado atrasado de outra partida nunca destrói sala alheia).
  - Fecha a sala local (libera código, limpa timers `pendingRemove` daquela sala),
    sem afetar outras salas; dono liberado junto (sem reserva fantasma).

## Salas / dono / encerramento

- `htok` guardado por sala (`lib/hub.js#owners`): registrado na criação dirigida pelo Hub
  (WS `join` com `room`+`htok` válidos cria/reserva aquele código; sem `htok` e sem sala =>
  erro honesto, sem gerar outro código). `GET state` expõe o dono; divergência => `409`/`CODE_TAKEN`.
- Criação standalone (sem `room` ou código vazio) gera código aleatório como antes e nasce
  sem dono; Hub nunca fecha sala standalone com `htok` (403 preserva).
- Encerramento: sala vazia (todos saíram / timeout reconexão) libera código e dono
  (`removeIfEmpty` + `forget`); `POST close` idempotente (sala livre => `closed:false`);
  fim de partida (`ended` 30s auto-retorno) volta ao lobby sem pronto, sem fechar sala.

## Min–max jogadores / entrada mid-match

- FFA: 2–12 prontos iniciam; 2v2: exatamente 2 prontos por equipe; PvE: 1 por sala (`capacity` no `stateOf`).
- **Sem entrada mid-match:** `joinable` só em `lobby`; nick novo em jogo barrado; reconexão usa mesmo nick+segredo
  em até 30s (vaga reservada); saída voluntária remove na hora e libera nick na partida.
- Trocar build/equipe limpa pronto; trocar modo limpa todos; criador pode mudar modo só se lotação permitir.

## Fim / retorno

- Resultado permanece até cada um escolher voltar; servidor auto-retorna ao lobby após 30s sem escolha.
- Desconectados voltam só por código+vaga no lobby (§11). `room.returned`/`activeDone` ignoram `left`.
- Hub pode fechar sala via `POST close`; cliente Hub tem botão voltar (`hubUrl` validada http(s)).

## Registro futuro (não implementado)

- Sem registro automático de servidor no Hub (sem heartbeat/cadastro); Hub consulta por `room`.
  Futura `POST /__hub/register` precisaria de `HUB_SECRET` + lista salas, sem quebrar modo independente.
  Não implementar sem decisão explícita (fora do escopo v1; PRODUTO §1 sem Hub funcional).

## Exemplos

```bash
HUB_SECRET=s3cr3t node server.js &
curl 'http://localhost:8094/__hub/state?room=ABCD'
# 404 livre
curl -X POST 'http://localhost:8094/__hub/close?room=ABCD&htok=hub1' -H 'x-hub-secret: s3cr3t'
# {ok:true, closed:false} (idempotente, nada a fechar)
```

## Testes / limitações (honesto)

- Unit: `tests/server-rooms.test.js` (salas/hub state/close/idempotência/joinable) + E2E S1-S5 (salas isoladas,
  12 WS, 2 salas simultâneas). `npm test` FULL deve passar sem Hub real (503 sem quebrar).
- **Não executado:** Hub real de Thomas/amigos; `htok` real fim-a-fim; latência rede real.
  Smoke local (curl 503/404/close idempotente) não prova integração real — pendente validação humana.
- PRODUTO §1: sem integração funcional com Game Hub no escopo v1; arquitetura permite futura sem exigir Hub.
  Contradição real futura → registrar decisão aqui, sem rebaixar requisito do produto.
