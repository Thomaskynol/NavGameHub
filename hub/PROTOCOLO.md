# Contrato do Hub e integração dos jogos

Este arquivo é a fonte de verdade compartilhada entre o servidor do Hub, a interface do Hub e as integrações dos jogos. Qualquer divergência deve ser corrigida contra este contrato, não contra a implementação.

## Portas e endereços

| Serviço | Porta | Health |
|---|---|---|
| Hub | 8090 | `GET /health` |
| Asfalto Vivo (Arcade) | 8091 | `GET /api/info` |
| VAVA2D | 8092 | `GET /health` |
| Catan Deluxe | 8093 | `GET /health` |

Todos escutam em `0.0.0.0`. O Hub monta a URL pública dos jogos a partir do host usado pelo navegador para abrir o Hub (cabeçalho `Host` do WebSocket, sem a porta) e da porta do manifesto. Nada de `localhost` fixo no cliente.

Portas do ambiente (R7) prevalecem sobre o manifesto: `HUB_PORT` para o próprio Hub e `<ID-MAIUSCULO>_PORT` para cada jogo (`ARCADE_PORT`, `VAVA_PORT`, `CATAN_PORT`). Vale para URLs enviadas ao navegador, sondas de saúde e catálogo. Ausente/inválida → usa o manifesto.

## Identidade

- Apelido: NFKC, `trim`, espaços internos colapsados, 2–16 caracteres. Permitidos letras Unicode, dígitos, espaço, `_` e `-`. Chave de unicidade: NFKC + minúsculas.
- Único no Hub inteiro, inclusive entre salas. Outra conexão não pode usar a mesma chave.
- Token de reconexão aleatório (32 bytes hex) guardado em `localStorage` (`gamehub:token`). O servidor associa o token à identidade e à sala.
- Queda de conexão: tolerância de 20 s. A conexão mais recente vence. Depois do prazo, a identidade e a vaga na sala são liberadas (a partida do jogo, se houver, segue sem o Hub).
- Identidade não é recriada ao entrar/sair do jogo: o Hub mantém a conexão WS durante toda a partida.

## Protocolo WebSocket do Hub (`/ws`)

Mensagens JSON. Cliente → Hub:

```js
{ t: 'hello', token?: string, nick?: string }
{ t: 'create_room', gameId: string, capacity?: number }
{ t: 'join_room', code: string }
{ t: 'leave_room' }
{ t: 'set_ready', ready: boolean }
{ t: 'set_game', gameId: string }
{ t: 'set_capacity', capacity: number }
{ t: 'leave_match' }
{ t: 'ping', ts: number }
```

Hub → cliente:

```js
{ t: 'hello_ok', token, you: { id, nick }, room?: RoomView }
{ t: 'need_nick' }
{ t: 'error', code, message }
{ t: 'catalog', games: GameInfo[], rooms: RoomSummary[] }
{ t: 'room', room: RoomView }
{ t: 'left' }
{ t: 'play', gameId, url }
{ t: 'notice', message }
{ t: 'pong', ts }
```

### GameInfo

```js
{
  id, name, tagline, description,
  minPlayers, maxPlayers, midMatchJoin,
  accent, tags,
  status: 'online' | 'offline'
}
```

### RoomSummary (lista)

```js
{ code, gameId, gameName, capacity, occupancy, phase, hostNick }
```

`occupancy` conta todos os membros, inclusive quem aguarda. A lista é atualizada por broadcast a cada mudança de sala ou de saúde dos jogos.

### RoomView

```js
{
  code, phase: 'lobby'|'launching'|'playing'|'finished',
  gameId, gameName, capacity,
  minPlayers, maxPlayers, midMatchJoin,
  hostId,
  you: { id, nick, ready, role: 'player'|'waiting', connected },
  members: [{ id, nick, ready, role, connected, isHost }],
  match: { gameCode, startedAt, joinable } | null,
  canStart: boolean,
  startHint: string
}
```

`role: 'waiting'` indica quem entrou com a partida em andamento num jogo sem suporte a entrada no meio. Quem aguarda ocupa vaga e volta à sala no fim.

### Regras de sala

- Fases: `lobby → launching → playing → finished → lobby`.
- Configuração (jogo/capacidade) só pode mudar em `lobby` e sempre reseta a prontidão.
- Capacidade configurada: `1 ≤ capacity ≤ game.maxPlayers`; não pode ser menor que a ocupação atual; nunca expulsa ninguém.
- Troca de jogo: só se `game.maxPlayers >= capacity`; a capacidade configurada não é reduzida automaticamente.
- Início: anfitrião ou automático quando todos os membros jogadores conectados estão prontos, há pelo menos `minPlayers` conectados, a capacidade comporta — e **nenhum jogador ocupa vaga desconectado** (queda temporária segura o início durante a graça; reavalia na saída/expiração, R6). Quem está desconectado não bloqueia por estar ausente: bloqueia por ainda deter vaga.
- Anfitrião: o membro restante mais antigo (`joinedAt`). Sala vazia é removida.
- Entrada: por código ou pela lista. `occupancy < capacity` é validado no servidor de forma síncrona. Em `lobby`, entra como `player`; em `playing`, entra como `player` se `midMatchJoin`, senão como `waiting` **provisório** — o Hub consulta o estado efetivo do jogo e promove a `player` com `play` (join) quando a partida ainda está no pregame (`phase === 'lobby'` + `joinable === true` + vaga no jogo e no Hub, R5); `waiting` só quando a partida começou ou lotou. Em `launching`, rejeitada; em `finished`, entra como `waiting` até o retorno ao lobby.
- `leave_match`: o membro em partida passa a `waiting` e a interface remove o iframe; ele continua na sala e ocupa vaga.
- Fim: o Hub detecta o estado do jogo, mantém o iframe para os resultados por um tempo de graça (VAVA 6 s; Arcade e Catan 15 s), depois volta todos para `lobby`, desmarca prontidão, transforma `waiting` em `player` e limpa a partida.

### Início e retorno

1. Todos prontos → `launching`. O Hub gera um `htok` (token opaco, 16 bytes hex, único por sala+launch) e **reserva sincronamente** um código de sala do jogo (alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, tamanho do jogo), marcando `room.match` **antes** de qualquer I/O — dois lançamentos simultâneos nunca recebem o mesmo código. Lançamentos do mesmo jogo são ainda serializados por um mutex por `gameId` (R2).
2. O criador (anfitrião conectado ou membro conectado mais antigo) recebe `play` com `create=1`.
3. O Hub consulta o estado do jogo a cada 300 ms por até 12 s. Quando a sala existe **e o dono confere (`hubOwner === htok` do launch)**, envia `play` com `create=0` aos demais membros conectados e passa a `playing`. Sala existente com outro dono (ou sem dono) é **CONFLITO**: o Hub nunca envia `play` para lá nem a considera `playing` válida — reserva um novo código, reemite `play create=1` ao criador e tenta de novo (até ~3 novos códigos). Esgotado o limite, a sala volta ao `lobby` com `LAUNCH_CONFLICT` (mensagem clara), sem prender o grupo. Erro transitório de rede durante o lançamento não falha na hora: tenta até o prazo (R8).
4. A interface do Hub abre o jogo em iframe e mantém uma barra com código, nome do jogo e “Voltar à sala”.
5. O Hub consulta `GET /__hub/state` a cada 1,5 s. `results`/`ended` → `finished`; 404 por três consultas seguidas também encerra. Em todo poll o Hub confere o dono: sala existente com `hubOwner` divergente conta como ausência (nunca adota a sala alheia) até encerrar pelo fluxo normal. Erro persistente (`state.kind === 'error'` em N consultas seguidas ou por mais de um tempo limite, configurável) → **FALHA**: a sala recebe `GAME_FAILED` (mensagem clara, nunca como fim normal) e volta a `lobby` utilizável; um erro isolado nunca encerra nada (R8).
6. Depois da graça, o Hub remove o iframe, volta ao lobby e chama `POST /__hub/close` após 5 s — com o `htok` do launch (R3).

Parâmetros passados ao jogo (todos URL-encoded):

```
?hub=1&room=<código>&name=<apelido>&create=1|0&expect=<n>&slot=<i>&hubUrl=<url da sala>&htok=<token do launch>
```

`htok` é o dono da partida: o jogo o guarda na criação e o confere no fechamento (abaixo). **Retentativa legítima do mesmo launch** (mesmo código + mesmo `htok`, ex. reload do iframe) entra/resume **sem** erro `CODE_TAKEN`. **Colisão real** (mesmo código + `htok` diferente/ausente) responde `CODE_TAKEN`, e o cliente do Hub **não faz join cego**: mostra erro honesto, sem misturar grupos (R2).

No modo Hub o jogo não mostra a tela inicial: cria ou entra automaticamente na sala indicada. A preparação específica (pista, voltas, cores, segundo pronto, tabuleiro) continua na interface do jogo.

## Endpoints dos jogos (chamados pelo Hub)

Cabeçalho obrigatório: `x-hub-secret: <HUB_SECRET>`. Sem segredo correto → `403 { ok:false, error:'FORBIDDEN' }`.

### `GET /__hub/state?room=CODE`

```js
{ ok: true, room: {
  code, phase: 'lobby'|'playing'|'results',
  players, capacity, joinable, startedAt?,
  hubOwner: string | null
} }
```

Sala inexistente → `404 { ok:false, error:'NOT_FOUND' }`.

`hubOwner` é o dono da partida (o `htok` do launch que criou a sala; `null` quando a sala não tem dono — manual/legada). O Hub confere `hubOwner === htok` esperado após o create e em todo poll: divergência (outro dono ou `null`) = CONFLITO (nunca envia `play` para lá, nunca considera `playing` válido, nunca fecha a sala alheia; tenta novo código até o limite, depois `LAUNCH_CONFLICT`). Campo ausente ou não-string = resposta incompatível: o Hub trata como sala alheia (CONFLITO/ausência), nunca envia `play` para lá.

Mapeamento:
- Arcade: `lobby → lobby`, `countdown|race → playing`, `results → results`; `joinable = status === 'lobby'`; `players = room.players.length`.
- Catan: `phase === 'lobby' && state === null → lobby`, `game_over → results`, demais → `playing`; `joinable = state === null && phase === 'lobby'`.
- VAVA: `waiting → lobby`, `playing|cardSelection → playing`, `ended → results`; `joinable = !isFull`.

### `POST /__hub/close?room=CODE&htok=TOKEN`

Remove a sala do jogo e libera recursos. Idempotente. Responde `{ ok:true }`.

Com dono (`htok` guardado na criação): só fecha se o `htok` conferir; divergente/ausente → `403 { ok:false, error:'FORBIDDEN' }` e a sala segue intacta — protege reutilização do código por outra partida (R2). Sala sem dono (manual/legada): só fecha sem `htok` (legítimo); COM `htok` → `403 FORBIDDEN` e preserva (close afiliado atrasado de outra partida). Sala inexistente → `200` idempotente.

Do lado do Hub: `403`/`409` no close significam "não é minha" — o Hub registra o resultado (últimos fechamentos expostos no diagnóstico interno), **não insiste** (sem retry destrutivo) e nunca trata como fechado. Só conta como fechado `200 { closed:true }`.

O fechamento pendente sobrevive à destruição da sala do Hub: fica numa fila fora da sala (identidade `gameId`+`gameCode`+`htok`) e é executado imediatamente se a sala for destruída antes do prazo; partidas sucessivas fecham cada uma com seu `htok` (R3). Falha de rede no close não derruba a limpeza (uma nova tentativa; depois best-effort).

### Códigos de sala solicitados e dono da partida (R2)

- Arcade: `create` aceita `room` opcional (6 caracteres do alfabeto) e `htok` opcional. Código ocupado + mesmo `htok` → entra/resume (retentativa legítima); ocupado + `htok` diferente/ausente → `CODE_TAKEN`.
- Catan: `create_room` aceita `roomCode` opcional (6 caracteres) e `htok` opcional. Ocupado → `CODE_TAKEN`, salvo retentativa legítima do mesmo dono.
- VAVA: `create` aceita `code` opcional (4 caracteres) e `htok` opcional. Mesma regra: mesmo dono entra/resume; outro dono → `CODE_TAKEN`.

Em todos: o jogo guarda o `htok` como dono opaco (só compara por igualdade; formato `1..64` chars `[A-Za-z0-9_-]`, senão sem dono), retorna o dono em `hubOwner` no state, nunca gera outro código em silêncio, e o cliente do Hub nunca faz join cego após `CODE_TAKEN` de outra partida.

### Hooks de teste (somente com `HUB_TEST_HOOKS=1`)

- `POST /__hub/test/finish?room=CODE` (Arcade): encerra a corrida com resultados.
- `POST /__hub/test/win?room=CODE` (Catan): declara vitória e vai para `game_over`.
- `POST /__hub/test/end?room=CODE` (VAVA): força o fim da partida.

Sem a variável, os hooks respondem 404. Eles existem apenas para testes automatizados e não aparecem na interface.

## Erros do Hub

`BAD_NICK`, `NICK_TAKEN`, `BAD_GAME`, `GAME_OFFLINE`, `BAD_CAPACITY`, `CAPACITY_GT_MAX`, `CAPACITY_LT_OCCUPANCY`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `ALREADY_IN_MATCH`, `NOT_HOST`, `NOT_IN_ROOM`, `NOT_READY`, `LAUNCHING`, `BAD_PHASE`, `LAUNCH_FAILED`, `LAUNCH_CONFLICT`, `GAME_FAILED`, `RATE`, `INVALID`.

Mensagens em português, claras e específicas. A interface mostra o motivo e não altera o estado local de forma otimista quando o servidor rejeitar.
