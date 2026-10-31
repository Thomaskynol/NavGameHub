# 03 — Protocolo e Rede

## Constantes

| Constante | Valor |
|---|---|
| Tick do servidor | 60 Hz (`1/60 s`) |
| Snapshot | 20 Hz (a cada 3 ticks) |
| Input do cliente | 1 por passo fixo (até 60 Hz) |
| Atraso de interpolação | 100 ms |
| Payload máximo WebSocket | 16 KB |
| Fila de inputs por jogador | 8 |
| Ping do cliente | a cada 2 s |
| Jogadores por sala | 8 |

Protocolo **JSON sobre WebSocket** no caminho `/ws`. Em desenvolvimento, o Vite faz proxy
de `/ws` para o servidor Node na porta 3000; em produção, o próprio Node serve o build.

## Cliente → Servidor

### Criar sala

```json
{ "t": "create", "name": "Ana" }
```

### Entrar em uma sala

```json
{ "t": "join", "code": "ABCD", "name": "Ana" }
```

### Input

```json
{
  "t": "input",
  "input": {
    "seq": 1234,
    "move": 9,
    "aim": 0.785398,
    "shoot": false,
    "reload": false,
    "dash": false
  }
}
```

- `seq`: inteiro crescente, um por passo fixo. É a chave da reconciliação.
- `move`: bitmask — `1` cima, `2` baixo, `4` esquerda, `8` direita. Diagonais normalizam.
- `aim`: radianos, `atan2(dy, dx)` da mira em relação ao centro do jogador.
- `shoot`: atira enquanto verdadeiro (a cadência é do servidor).
- `reload`: edge, verdadeiro apenas no frame do `R`.
- `dash`: edge, verdadeiro apenas no frame do `Shift`/`Espaço`.

### Ping

```json
{ "t": "ping", "id": 1729512345678 }
```

## Servidor → Cliente

### Entrada confirmada

```json
{
  "t": "joined",
  "playerId": "p_a1b2c3",
  "roomCode": "ABCD",
  "phase": "playing"
}
```

Em caso de erro (sala cheia, código inválido), o servidor envia
`{ "t": "error", "message": "..." }` e fecha a conexão.

### Snapshot

Enviado a 20 Hz. Contém o estado inteiro necessário para desenhar a sala.

```json
{
  "t": "snapshot",
  "snap": {
    "tick": 320,
    "serverTime": 1729512345678,
    "phase": "playing",
    "timeLeft": 287.4,
    "winnerId": null,
    "players": [
      {
        "id": "p_a1b2c3",
        "name": "Ana",
        "color": "#f4a259",
        "x": 1204.5,
        "y": 812.2,
        "aim": 0.78,
        "health": 100,
        "alive": true,
        "protected": false,
        "kills": 2,
        "deaths": 1,
        "score": 2
      }
    ],
    "bullets": [
      { "id": 12, "owner": "p_a1b2c3", "x": 1230.1, "y": 830.4, "angle": 0.78 }
    ],
    "you": {
      "id": "p_a1b2c3",
      "ack": 1232,
      "x": 1204.5,
      "y": 812.2,
      "vx": 225,
      "vy": 0,
      "aim": 0.78,
      "dashTime": 0,
      "dashCooldown": 0.4,
      "health": 100,
      "alive": true,
      "ammo": 7,
      "reloading": 0,
      "respawnIn": 0,
      "protected": false,
      "kills": 2,
      "deaths": 1,
      "score": 2
    }
  }
}
```

- `timeLeft`: segundos restantes da fase atual (`playing` ou `ended`).
- `ack`: último `seq` de input processado (ou descartado por limite).
- `reloading`: segundos restantes; `0` se não estiver recarregando.
- `respawnIn`: segundos até renascer; `0` se vivo.
- Jogadores mortos continuam na lista (`alive: false`) para o placar.
- O cliente ignora balas com `owner === playerId` e desenha um tracer cosmético local
  disparado pelo evento `shot`, evitando atraso visual de 100 ms no próprio tiro.

### Eventos

```json
{ "t": "event", "e": { "type": "shot", "playerId": "p_x", "x": 1200, "y": 800, "aim": 1.2 } }
```

| Evento | Campos | Uso no cliente |
|---|---|---|
| `shot` | `playerId, x, y, aim` | Flash no cano; tracer local se for o próprio jogador |
| `hit` | `by, targetId, damage, x, y` | Hitmarker, número de dano e partículas |
| `kill` | `killerId, victimId, killerName, victimName, x, y` | Killfeed, partículas e overlay de morte |
| `join` | `name` | Killfeed “entrou na sala” |
| `leave` | `name` | Killfeed “saiu da sala” |
| `matchStart` | — | Limpa overlays e killfeed |
| `matchEnd` | `winnerName` | Overlay de fim (o snapshot também traz `winnerId/phases`) |

### Pong

```json
{ "t": "pong", "id": 1729512345678 }
```

Eco do `id`; o cliente calcula `agora - id` para obter o RTT.

## Reconciliação passo a passo

Cliente, a cada passo fixo:

```text
input.seq = ++seq
stepPlayerPhysics(estadoLocal, input)
histórico.push(input)
envia input
```

Ao receber snapshot:

```text
histórico = histórico.filter(i => i.seq > snap.you.ack)
oldRender = estadoLocal.posição
estadoLocal = estadoAutoritativo(snap.you)
para cada input pendente:
    stepPlayerPhysics(estadoLocal, input)
offsetVisual += oldRender - estadoLocal.posição
```

Todo frame, `offsetVisual *= exp(-12 * dt)`; a posição desenhada é
`estadoLocal.posição + offsetVisual`. Isso corrige erros de latência sem “teleportes”.

O servidor processa um input por tick. Se a fila passar de 8, descarta os mais antigos,
avança o `ack` e deixa a reconciliação corrigir a posição local. Inputs parados (aba oculta)
não continuam movendo ninguém: sem input na fila, o servidor usa movimento zero e mantém
apenas a última mira.

## Interpolação

O cliente guarda os snapshots com o instante local de recebimento. Um relógio de renderização
persegue suavemente `últimoRecebido - 100 ms` e desenha entre os dois snapshots que envolvem
esse instante. Posições e ângulos são interpolados; vida, placar e fase usam o snapshot mais
recente. Jogador local vem da predição, nunca da interpolação.

## Latência esperada

| Cenário | RTT | Sensação |
|---|---|---|
| Mesma máquina | ~1 ms | Imediata |
| LAN / Wi-Fi bom | 2–15 ms | Imediata |
| Mesma cidade | 20–50 ms | Fluida, tiros levemente atrasados |
| Longa distância | 100–200 ms | Jogável; dash e tiros de perto ficam difíceis |

O servidor roda a 60 Hz para que a bala não “pule” alvos pequenos. A colisão usa o segmento
inteiro percorrido no tick, então mesmo 12 px por tick são cobertos.

## Validação e limites

- `name`: trim, 1–16 caracteres visíveis; fallback `Jogador`.
- `code`: 4 caracteres do alfabeto sem ambíguos (`A-Z` sem `I/O`, `2-9` sem `0/1`).
- `input`: números finitos; `seq` inteiro maior que o último recebido; flags booleanas.
- `aim` normalizado para `[-π, π]`.
- Rate limit: até 240 mensagens/s por conexão; excedeu, conexão fecha.
- Payload > 16 KB fecha a conexão.
- Sala cheia (>8) ou inexistente retorna erro.
- Nenhuma posição, vida ou dano enviado pelo cliente é aceito.

## Formato futuro

Para reduzir banda, a evolução natural é um protocolo binário com `DataView`/structs,
quantização de posição (uint16) e ângulo (uint16), além de snapshots delta. O formato atual
é intencionalmente legível para facilitar o debug do MVP.
