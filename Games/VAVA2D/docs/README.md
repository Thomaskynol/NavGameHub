# VAVA2D — Documentação do MVP

Arena de tiro **2D top-down**, multiplayer no navegador, feita para jogar com amigos.
O jogador controla um bonequinho armado com pistola, anda com WASD, mira com o mouse
e desvia de balas visíveis.

## Visão do MVP

- Servidor **autoritativo** em Node.js + WebSocket; o navegador apenas envia intenções.
- Cliente com **Canvas 2D puro**, sem engine, com arte vetorial desenhada em código.
- **Predição local** do movimento + reconciliação com o servidor.
- Inimigos e balas **interpolados** a partir de snapshots de 20 Hz.
- Salas por código/link (até 8 jogadores), FFA com respawn e partidas de 5 minutos.
- Mapa de gramado com pedras e árvores que bloqueiam movimento e tiros.
- HUD completo: vida, munição, recarga, dash, placar, killfeed, ping e timer.
- Sem banco de dados, sem cadastro, sem áudio no MVP.

## Documentos

| Documento | Conteúdo |
|---|---|
| [01-arquitetura.md](./01-arquitetura.md) | Stack, monorepo, fluxo de rede e decisões técnicas |
| [02-design-do-jogo.md](./02-design-do-jogo.md) | Game design, controles, mapa e balanceamento |
| [03-protocolo-e-rede.md](./03-protocolo-e-rede.md) | Mensagens, tick, predição, interpolação e validação |
| [04-plano-de-implementacao.md](./04-plano-de-implementacao.md) | Fases, critérios de aceite e status do build |
| [05-como-jogar.md](./05-como-jogar.md) | Rodar localmente, LAN, produção e solução de problemas |

## Como rodar (resumo)

```bash
npm install
npm run dev
# cliente: http://localhost:5173
# servidor: http://localhost:3000
```

Para jogar com amigos na mesma rede:

```bash
npm run build
npm start
# abra http://IP-DA-MAQUINA:3000
```

Detalhes em [05-como-jogar.md](./05-como-jogar.md).

## Estrutura do repositório

```
VAVA2D/
├── docs/
├── packages/
│   ├── shared/   # tipos, constantes, mapa e física compartilhada
│   ├── server/   # salas, simulação autoritativa e WebSocket
│   └── client/   # Vite, Canvas 2D, input, predição, HUD
├── package.json
└── tsconfig.base.json
```
