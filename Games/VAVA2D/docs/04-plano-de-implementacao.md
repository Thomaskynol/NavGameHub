# 04 — Plano de Implementação

Checklist vivo do MVP. Cada fase termina com um critério de aceite verificável.

## Fase 1 — Fundação

- [x] Monorepo npm workspaces (`shared`, `server`, `client`)
- [x] TypeScript estrito + scripts de dev/build/start/typecheck/test
- [x] `docs/` com visão, arquitetura, design, protocolo e execução
- [x] `.gitignore` e README raiz

**Aceite:** `npm install` conclui e `npm run typecheck` executa sem erros nos três pacotes.

## Fase 2 — Núcleo compartilhado

- [x] Constantes de balanceamento (tick, jogador, pistola, partida)
- [x] Tipos de estado e mensagens
- [x] Mapa com 12 obstáculos e 10 spawns
- [x] `stepPlayerPhysics` determinístico (aceleração, colisão, dash, bordas)
- [x] Colisão segmento-círculo para balas
- [x] Testes unitários de movimento, dash e colisão

**Aceite:** testes passam reproduzindo movimento e bloqueio por obstáculo/borda.

## Fase 3 — Servidor autoritativo

- [x] Servidor HTTP + WebSocket em `/ws`
- [x] Salas com código, limite de 8, entrada/saída e limpeza
- [x] Loop fixo 60 Hz + snapshots 20 Hz
- [x] Fila de inputs com `seq`, `ack` e limite
- [x] Pistola, recarga, balas varridas, dano, morte e respawn seguro
- [x] Partida de 5 min, intervalo de 8 s, placar e vencedor
- [x] Validação de mensagens/rate limit
- [x] Servir build do cliente em produção + log de IP da LAN

**Aceite:** duas conexões WebSocket conseguem criar/entrar na mesma sala, mover, atirar e
receber snapshots coerentes; matar e renascer atualiza o placar.

## Fase 4 — Cliente: menu e rede

- [x] Vite + Canvas fullscreen responsivo
- [x] Menu com nome, criar sala, código e link `?sala=`
- [x] Conexão WebSocket, erros, ping e estado de “conectando”
- [x] Entrada/saída da partida sem recarregar a página
- [x] Overlay de conexão perdida

**Aceite:** criar sala em uma aba e entrar em outra; link preenche o código; erros aparecem.

## Fase 5 — Movimento e mundo

- [x] Input WASD/setas + mira pelo mouse
- [x] Passo fixo de 60 Hz e envio de input
- [x] Predição + reconciliação + suavização de correção
- [x] Interpolação de jogadores a 100 ms
- [x] Câmera suave com look-ahead e limites do mapa
- [x] Mapa vetorial: grama procedural, cercas, pedras, árvores e flores
- [x] Bonequinho top-down com pernas animadas, braços e pistola
- [x] Tracers, flashes e partículas

**Aceite:** andar é fluido mesmo com lag artificial; o boneco aponta a pistola para o mouse,
atravessa a grama e desliza nas pedras sem travar.

## Fase 6 — Combate e HUD

- [x] Tiro com clique, cadência, pente e recarga (`R`)
- [x] Dash com `Shift`/`Espaço` e cooldown
- [x] Balas visíveis e desviáveis, com colisão autoritativa
- [x] Hitmarker, dano flutuante e screen shake
- [x] HUD: vida, dash, munição, recarga, timer, sala, ping, placar e killfeed
- [x] Anel de proteção de spawn
- [x] Overlays de morte e de fim de partida
- [x] Banner de espera com copiar link

**Aceite:** quatro tiros matam; a bala leva tempo visível para cruzar a arena; dash esquiva;
HUD reflete o servidor e o placar ordena por abates.

## Fase 7 — Polimento e validação

- [x] Menu e HUD responsivos (notebook e desktop)
- [x] Higiene visual: cursor, foco, blur da janela e prevenção de scroll
- [x] Estado de espera, empate e partida reiniciando
- [x] Teste manual com 2 abas e 2 jogadores
- [x] Revisão de constantes/documentos vs. código
- [x] Build de produção + teste via `npm start`

**Aceite:** rodar `npm run build && npm start`, abrir em duas máquinas da mesma rede e jogar
uma partida completa sem erros no console.

## Backlog pós-MVP

- Áudio sintetizado (tiro, acerto, recarga, morte).
- Chat rápido e emotes.
- Times 2v2/4v4 e spawns por time.
- Mais armas e pickups.
- Reconexão e token de sessão.
- Protocolo binário e snapshots delta.
- Mapas adicionais e obstáculos retangulares.
- Mobile com controles virtuais.
- Deploy público com HTTPS/WSS e Docker.

## Registro de decisões

| Data | Decisão |
|---|---|
| 2026-10-22 | Canvas 2D puro, sem engine |
| 2026-10-22 | Servidor autoritativo Node + `ws`, JSON |
| 2026-10-22 | FFA, salas por código/link, obstáculos, dash, HUD completo |
| 2026-10-22 | Sem áudio no MVP |
| 2026-10-22 | Tick 60 Hz, snapshot 20 Hz, interpolação 100 ms |

## Status

MVP validado localmente e em produção. Build de produção e servidor `npm start` testados;
física compartilhada com 6 testes passando; rede/combat manual e automatizado validado com duas
abas; HUD, overlays, respawn, placar, fim de partida e saída sem recarregar a página testados.

### Validação final

- `npm run typecheck`: sem erros nos três pacotes.
- `npm test`: 6/6 testes da física compartilhada passando.
- `npm run build && npm start`: servidor servindo `packages/client/dist` + WebSocket em `/ws`.
- Teste Playwright de duas abas: menu, jogo, HUD, tiro, recarga, dash, saída e retorno sem reload.
- Teste WebSocket direto: criação/entrada, movimento, ack, tiro, dash, recarga, ping, pausa.
- Teste de sala/combate: 4 tiros matam, killfeed, respawn cheio, fim de partida, vencedor e reset de placar.
