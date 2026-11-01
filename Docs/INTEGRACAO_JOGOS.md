# Integrando um jogo ao Game Hub

Guia para colocar um jogo novo no Hub. O contrato normativo está em `hub/PROTOCOLO.md`; aqui vai o resumo operacional: o que o jogo precisa expor e como o Hub o usa.

## Como o Hub enxerga o jogo

Cada jogo é um servidor HTTP próprio, numa porta fixa registrada em `hub/games.json`:

```json
{
  "id": "meujogo",
  "name": "Meu Jogo",
  "minPlayers": 2,
  "maxPlayers": 4,
  "midMatchJoin": false,
  "codeLength": 6,
  "port": 8094,
  "healthPath": "/health"
}
```

- `minPlayers`/`maxPlayers`: limites reais do jogo, verificados no código. O Hub recusa capacidade acima de `maxPlayers` e só inicia com pelo menos `minPlayers` conectados.
- `midMatchJoin`: `true` se quem entrar com a partida em andamento joga de verdade; `false` se vira espera (`role: 'waiting'`, ocupa vaga e volta à sala no fim).
- `codeLength`: tamanho do código de sala que o Hub gera para esse jogo (alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
- `healthPath`: endpoint que responde 2xx com o jogo no ar. O Hub consulta periodicamente e marca `online`/`offline` no catálogo.

## Execução

- O jogo escuta em `0.0.0.0` na porta do manifesto. Porta, host e segredo chegam por ambiente: `PORT`, `HOST`, `HUB_SECRET`.
- O jogo serve seu próprio cliente (estático embutido no build). Nada de CDN ou API externa em tempo de jogo: depois de preparado, tudo funciona offline na rede local.
- O Hub monta a URL pública do jogo a partir do host que o navegador usou para abrir o Hub. O jogo nunca precisa saber seu próprio endereço externo.

## Entrada na partida (lado do jogo)

O Hub abre o jogo num iframe com parâmetros (todos URL-encoded):

```
?hub=1&room=<código>&name=<apelido>&create=1|0&expect=<n>&slot=<i>&hubUrl=<url da sala>&htok=<dono>
```

- `create=1`: o primeiro jogador cria a sala `room` no jogo (o código vem do Hub, no tamanho de `codeLength`; se ocupado, o jogo responde `CODE_TAKEN`). `create=0`: os demais entram na sala existente.
- `expect`: quantos jogadores vão entrar; `slot`: índice do jogador (0-based, ordem de entrada na sala do Hub).
- `htok`: token opaco do launch (dono da partida, `1..64` chars `[A-Za-z0-9_-]`). O jogo o guarda na criação e o devolve em `hubOwner` no state; só compara por igualdade exata, nunca interpreta. **Retentativa legítima do mesmo launch** (mesmo código + mesmo `htok`, ex. reload do iframe) entra/resume **sem** `CODE_TAKEN`. **Colisão real** (mesmo código + `htok` diferente/ausente) responde `CODE_TAKEN`, e o cliente do Hub **não faz join cego**: mostra erro honesto, sem misturar grupos.
- Com `hub=1`, o jogo pula a tela inicial e cria/entra na sala direto. A preparação própria do jogo (pista, cores, segundo pronto, tabuleiro) continua na interface do jogo.
- A identidade do jogador (`name`) vem do Hub; o jogo não pede apelido de novo.
- Modo independente preservado: sem `htok` (fora do Hub), valem as regras legadas do jogo — inclusive entrar em sala com dono. Só join/com htok apresentado é afiliado ao Hub (dono divergente ou sala sem dono → `CODE_TAKEN`, sem entrada).

## Endpoints `__hub` (chamados pelo Hub)

Cabeçalho obrigatório: `x-hub-secret: <HUB_SECRET>`. Segredo errado → `403 { ok:false, error:'FORBIDDEN' }`.

### `GET /__hub/state?room=CODE`

```js
{ ok: true, room: {
  code, phase: 'lobby'|'playing'|'results', players, capacity, joinable, startedAt?,
  hubOwner: string | null, // OBRIGATÓRIO: htok do launch que criou a sala; null = sala sem dono
} }
```

Sala inexistente → `404 { ok:false, error:'NOT_FOUND' }`. O Hub usa assim:

- após `create=1`, consulta a cada 300 ms por até 12 s: quando a sala existe **e o dono confere (`hubOwner === htok` do launch)**, manda os demais jogadores (`create=0`) e a fase do Hub vira `playing`. Sala existente com outro dono, `null` **ou campo ausente** é **CONFLITO**: o Hub nunca envia `play` para lá nem a considera `playing` válida — reserva um novo código e tenta de novo (até o limite; esgotado, a sala volta ao `lobby` com `LAUNCH_CONFLICT`, sem prender o grupo);
- durante a partida, consulta a cada 1,5 s: `results`/`ended` encerra; 3 respostas 404 seguidas também encerram; sala existente com `hubOwner` divergente/ausente conta como ausência (nunca adota a sala alheia). Erro persistente de rede → **FALHA** (`GAME_FAILED`, nunca como fim normal) e volta a `lobby` utilizável; erro isolado nunca encerra nada.

Mapeie as fases internas do jogo para as três do contrato e defina `joinable` com honestidade (ex.: sala ainda aceitando gente → `true`; partida fechada → `false`). `hubOwner` inválido (fora do formato `1..64` chars `[A-Za-z0-9_-]`) equivale a sem dono (`null`). **Resposta sem o campo é incompatível**: o Hub não a aceita silenciosamente — trata como sala alheia (conflito/ausência) e a sala do Hub permanece recuperável. O jogo nunca gera outro código em silêncio.

### `POST /__hub/close?room=CODE&htok=TOKEN`

Remove a sala e libera recursos. Idempotente; responde `{ ok:true }` (e, se souber se removeu, `closed: true|false` — o Hub só registra "fechado" com `200 { closed:true }`). O Hub chama ~5 s depois de devolver a turma ao lobby, com o `htok` do launch. Regras:

- com dono (`htok` guardado na criação): só fecha se o `htok` conferir; divergente/ausente → `403 { ok:false, error:'FORBIDDEN' }` e a sala segue intacta (protege reutilização do código por outra partida);
- sem dono (manual/legada): só fecha sem `htok` (legítimo); COM `htok` → `403 FORBIDDEN` e preserva (não misturar close afiliado com sala independente);
- sala inexistente → `200` idempotente (nada a fazer).

Do lado do Hub: `403`/`409` significam "não é minha" — o Hub registra, **não insiste** (sem retry destrutivo) e nunca trata como fechado. Falha de rede: uma nova tentativa; depois best-effort.

### Códigos de sala

O `create` do jogo aceita o código pedido pelo Hub (`room`/`roomCode`/`code`, no tamanho de `codeLength`) e o `htok` opcional. Código ocupado + mesmo `htok` → entra/resume (retentativa legítima); ocupado + `htok` diferente/ausente → erro `CODE_TAKEN` para o Hub gerar outro.

### Hooks de teste (só com `HUB_TEST_HOOKS=1`)

- `POST /__hub/test/...`: atalhos para forçar o fim da partida nos testes automatizados (nomes por jogo, ex. `finish`, `win`, `end`).
- Sem a variável, respondem 404. Nunca aparecem na interface.

## Ciclo de vida da sala (lado do Hub, para referência)

`lobby → launching → playing → finished → lobby`. No fim da partida o Hub mantém o iframe aberto para os resultados (alguns segundos), depois volta todos para a mesma sala, limpa a prontidão, converte espera em jogador e fecha a sala no jogo. Capacidade nunca cai abaixo da ocupação; anfitrião que sai passa o posto ao membro mais antigo; sala vazia é removida.

## Checklist de um jogo novo

1. Servidor próprio em `0.0.0.0`, porta livre, lendo `PORT`/`HOST`/`HUB_SECRET`.
2. Health check 2xx no `healthPath`.
3. Modo `?hub=1`: cria/entra direto via `room`+`create`+`htok`, sem tela inicial, sem pedir nome; `CODE_TAKEN` honesto em colisão, resume em retentativa legítima; sem `htok`, modo independente inalterado.
4. `GET /__hub/state` com `hubOwner` obrigatório (`string` do dono ou `null`) e `POST /__hub/close` com conferência de `htok` (`403` em divergência, idempotente em inexistente), com o segredo e os formatos acima.
5. Cliente servido pelo próprio jogo, sem dependência de internet em tempo de uso.
6. Entrada `hub/games.json` + comandos de `prepare.sh`/`start.sh` na raiz.
