# 01 — Arquitetura

## Decisões principais

| Área | Decisão | Motivo |
|---|---|---|
| Rede | Servidor autoritativo + WebSocket (`ws`) | Anti-cheat básico, estado consistente e simples de hospedar |
| Render | Canvas 2D puro | Zero engine, controle total, visual vetorial leve |
| Build | Vite (cliente) + `tsx` (servidor) | Dev rápido e pouca configuração |
| Linguagem | TypeScript estrito em todo o projeto | Contratos de rede seguros e física compartilhada |
| Monorepo | npm workspaces | Código compartilhado sem publicação de pacote |
| Estado | Em memória, por sala | MVP sem banco; reiniciar o servidor limpa as salas |
| Transporte | JSON | Simples de depurar; banda suficiente para 8 amigos |
| Tick | 60 Hz de simulação, 20 Hz de snapshot | Movimento preciso e tráfego moderado |
| Predição | Movimento local predito + reconciliação por sequência | Movimentação fluida mesmo com latência |
| Interpolação | 100 ms de atraso de renderização | Inimigos e balas suaves apesar dos snapshots |
| Deploy | Um processo Node serve cliente buildado + WebSocket | Um comando para jogar com amigos |

## Componentes

```
┌──────────────────────────────┐
│ @vava/shared                 │
│ constantes · tipos · mapa    │
│ física do jogador · colisão  │
└──────────────┬───────────────┘
               │ importado por ambos
      ┌────────┴────────┐
      ▼                 ▼
┌─────────────┐   ┌──────────────────────────┐
│ @vava/client│   │ @vava/server             │
│ Canvas 2D   │   │ HTTP estático + WebSocket│
│ input       │   │ salas · tick 60 Hz       │
│ predição    │◄──┤ snapshots 20 Hz          │
│ interpolação│   │ autoridade de dano/mapa  │
└─────────────┘   └──────────────────────────┘
```

O pacote `shared` é a **fonte única da verdade** para números de balanceamento, formato do
mapa, formato das mensagens e a função de movimento do jogador. Cliente e servidor executam
exatamente a mesma função `stepPlayerPhysics`, o que torna a predição previsível.

## Modelo de rede

### Servidor

- Loop fixo de **60 ticks/s**. Cada tick avança física, armas, balas, respawns e timers.
- A cada 3 ticks (20 Hz) envia um **snapshot** completo da sala para cada jogador.
- O cliente envia **uma intenção de input por tick local** (até 60/s) com número de sequência.
- O servidor mantém uma fila curta de inputs por jogador e processa **um por tick**.
- Cada input processado atualiza `ack`, o último `seq` aplicado. O snapshot devolve esse `ack`.
- O servidor ignora posições enviadas pelo cliente: só aceita teclas, ângulo de mira e ações.

### Cliente

1. Coleta teclado/mouse e monta um `PlayerInput` a cada passo fixo de 1/60 s.
2. Aplica o mesmo `stepPlayerPhysics` no jogador local (predição imediata).
3. Guarda o input no histórico até o servidor confirmar via `ack`.
4. Ao receber snapshot:
   - reposiciona o jogador local no estado autoritativo;
   - descarta inputs já confirmados;
   - reaplica os inputs ainda pendentes;
   - suaviza visualmente a diferença com um offset que decai.
5. Inimigos e balas são interpolados entre os dois snapshots que cercam
   `agora - 100 ms`. O jogador local nunca é interpolado.
6. Eventos (tiro, acerto, morte, entrada/saída) chegam na hora e alimentam efeitos e killfeed.

### Por que não enviar posição do cliente?

Qualquer cliente poderia teleportar ou atravessar paredes. A autoridade fica no servidor; a
predição existe apenas para esconder a latência do próprio jogador.

## Fluxo de uma sala

1. O jogador abre o site, digita o nome e clica em **Criar sala**.
2. O servidor gera um código de 4 letras e responde `joined`.
3. O cliente atualiza a URL para `?sala=ABCD` para facilitar o compartilhamento.
4. Os amigos abrem o link, digitam o nome e entram com o código.
5. Com 2+ jogadores, a partida começa; o timer de 5 minutos corre.
6. Ao fim, há 8 s de placar final e uma nova partida começa automaticamente.
7. Para sair, clique em `Sair` ou pressione `Esc`: a conexão fecha e você volta ao menu
   sem recarregar a página.
8. Sala vazia é removida após 60 s. Sem reconexão no MVP.

## Estrutura de pastas

```
packages/shared/src/
  constants.ts    # tick, mundo, jogador, pistola, partida
  types.ts        # estados e mensagens
  map.ts          # obstáculos e spawns
  simulation.ts   # física do jogador, colisão segmento-círculo
  math.ts         # utilidades
  index.ts

packages/server/src/
  index.ts        # HTTP + WebSocket + loop global
  session.ts      # conexão, validação e roteamento de mensagens
  room.ts         # sala, partida, jogadores, balas, snapshots
  rooms.ts        # criação/busca/limpeza de salas
  static.ts       # arquivos do cliente em produção

packages/client/src/
  main.ts         # bootstrap e fluxo de menu
  game.ts         # orquestra snapshot, predição, update e render
  net.ts          # conexão WebSocket
  input.ts        # teclado, mouse e edges
  predictor.ts    # predição/reconciliação local
  interpolation.ts# buffer de snapshots
  camera.ts       # câmera com look-ahead
  renderer.ts     # desenho do mapa, personagens, balas e crosshair
  effects.ts      # partículas, tracers, flashes e screen shake
  hud.ts          # DOM do HUD, overlays e killfeed
  style.css
  index.html
```

## Limites e ameaças consideradas

- Nome limitado a 16 caracteres, código a 4 letras e payload WebSocket a 16 KB.
- Inputs validados (números finitos, `seq` crescente, flags booleanas, mira normalizada).
- Inputs em excesso são descartados; fila limitada a 8 comandos.
- Servidor limita jogadores por sala (8) e remove salas vazias.
- Colisão de bala é **varrida** (segmento), não apenas ponto, para não atravessar jogadores.
- Não há anti-cheat avançado (aimbot, wallhack) — fora do escopo de um jogo entre amigos.

## Evolução prevista

- Protocolo binário (ArrayBuffer) se a banda apertar.
- Reconexão com token de sessão.
- Times, mais armas, pickups e mapa maior.
- Servidor dedicado com Docker e HTTPS/WSS.
- Espectador e replays a partir dos snapshots.
