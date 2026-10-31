# Protocolo — cliente ↔ servidor

Transporte: Socket.IO sobre HTTP (mesma origem; em dev o proxy do Vite encaminha `/socket.io`).

## Canais

| Evento | Direção | Uso |
|---|---|---|
| `lobby` (ack) | C→S | criar/entrar/sessão/lobby/chat (comandos de `LobbyCommand`) |
| `cmd` (ack) | C→S | comandos de jogo (`GameCommand`) |
| `state` | S→C | projeção personalizada (`GameView`) — push após mutações aceitas, bind e reconexão |
| `chat` | S→C | mensagem nova da sala (também contida na `GameView` p/ reconexão) |
| `bind_conflict` | S→C | sessão ativa em outra conexão (bind `resume`/`claim` recusado) |
| `session_replaced` | S→C | este socket perdeu o controle (takeover explícito do outro lado) |
| `presence` | S→C | jogador conectou/desconectou |

## Envelope

```ts
{ requestId: string; baseVersion?: number; payload: LobbyCommand | GameCommand }
```

- `requestId` (uuid por ação do usuário): idempotência. Reenvio com mesmo payload → mesma resposta de confirmação, **sem novo efeito**. Mesmo `requestId` com payload diferente → `REQUEST_CONFLICT`.
- `baseVersion`: versão do estado que o cliente possui (somente comandos de jogo). Divergência → `STALE_VERSION` + visão atual no `version` da resposta → cliente ressincroniza e revalida a intenção. Chat/lobby não alteram a versão.
- Sucesso (`{ok:true}`) só após persistência concluída (transação SQLite).
- Falha: `{ok:false, error:{code,message}}` com códigos estáveis de `src/shared/protocol.ts` e mensagem pt-BR; nunca stack trace/token.

## Ordem e concorrência

- Mutações por sala são serializadas (fila de promessas por sala no servidor): nenhuma intercalação.
- Duas aceitações da mesma oferta, duplo clique de rolar/pagar/construir → 1 efeito (fila + idempotência + revalidação no instante da confirmação).
- Reconexão entrega projeção atual; comandos já confirmados não se repetem.
- Ofertas não reservam recursos: tudo é revalidado no aceite (recursos, fase, ator).

## Autenticação

- Bind por `bind_session { code, recoveryCode, mode }` — socket fica vinculado a (sala, jogador). Sem vínculo → `AUTH_REQUIRED`.
- `recoveryCode`: 32 bytes aleatórios (base64url), retornado só ao dono; servidor guarda SHA-256. Nunca em URL/log/mensagem a outros clientes.
- Modos: `resume` (retomar sem conflito), `takeover` (assumir explicitamente; anterior recebe `session_replaced`), `claim` (recuperação por código em navegador novo). Conflito com conexão ativa → `bind_conflict` + `SESSION_CONFLICT`.
- Um socket = um jogador; comandos validados contra o vínculo; sala diferente → `NOT_IN_ROOM`.

## Integração com o Hub (`/__hub/*`, htok)

Contrato com a frente do Hub (launch passa `&htok=<token>` na URL):

- `create_room` aceita `roomCode` (código pedido pelo Hub) + `hubToken` opcional
  (dono da instância, vindo de `htok`):
  - código livre → cria guardando o dono (`hubToken`, `''` = legado);
  - código ocupado + mesmo `hubToken` (não vazio, igual ao da sala) → retentativa
    legítima: entra na sala existente como nova vaga (lobby, com vaga e cor livre),
    sem `CODE_TAKEN`; sala cheia/iniciada retorna `ROOM_FULL`/`ALREADY_STARTED`;
  - código ocupado + `hubToken` diferente/ausente → `CODE_TAKEN` honesto.
- O cliente do Hub (`App.tsx`, modo `?hub=1`) envia `hubToken` no `create` e
  **nunca faz join cego** após `CODE_TAKEN`: qualquer falha no `create` vira tela
  de erro honesta ("código em uso"). Retentativa legítima já retorna `ok` no
  servidor, então `CODE_TAKEN` sempre indica colisão com outra partida.
- `POST /__hub/close?room=CODE&htok=TOKEN` (com `x-hub-secret`): idempotente,
  responde sempre `{ ok:true }`. Com dono (`hubToken` não vazio), só fecha se o
  `htok` conferir; fechamento tardio de partida antiga nunca atinge a partida
  nova que reutilizou o código. Sem dono (legado), fecha como antes.
  Sala inexistente → `{ ok:true }` (nada a fazer).
- `GET /__hub/state?room=CODE`: sala aberta → `200` com fase/jogadores;
  sala fechada/removida → `404 NOT_FOUND`. Como sala fechada é **removida**
  (código liberado), não há janela `404 → CODE_TAKEN` para o solicitante
  legítimo além do transitório de propagação (o `close` é síncrono: memória +
  SQLite na mesma chamada).

## Projeções

- `GameView`: público + `you` privado (mão, tipos das dev cards, pontuação real, taxa de banco, portos).
- NUNCA sai do servidor: ordem do baralho, RNG, hashes de recuperação, mãos alheias, tipo de carta comprada, tipo de carta roubada (evento privado para envolvidos), pontuação ocult dos outros.
- Histórico: eventos privados filtrados por audiência; renderização pt-BR no servidor (`renderHistoryEvent`).
