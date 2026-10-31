# VAVA2D

Arena de tiro 2D top-down multiplayer para jogar no navegador com amigos.

- Canvas 2D puro, arte vetorial desenhada em código
- Servidor autoritativo Node.js + WebSocket
- Predição local, reconciliação e interpolação
- Salas por link, FFA, dash, obstáculos e HUD completo

## Rodar

```bash
npm install
npm run dev
```

Ou use o script, que instala o que falta, sobe tudo e **encerra o servidor no
Ctrl+C** (sem sobrar processo nem porta presa):

```bash
./start.sh          # cliente + servidor (dev, hot reload)
./start.sh lan      # build + servidor de produção na porta 3000
./start.sh stop     # libera as portas 3000/5173 se algo sobrar
./start.sh help     # todos os modos
```

Abra <http://localhost:5173> e crie uma sala.

Para jogar na rede local:

```bash
npm run build
npm start
```

A documentação completa está em [`docs/`](./docs/README.md), incluindo arquitetura,
game design, protocolo de rede e plano de implementação.
