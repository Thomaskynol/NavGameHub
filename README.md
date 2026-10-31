# Game Hub

Hub local para jogar jogos de navegador em grupo pela rede local. Uma pessoa hospeda o servidor no Linux; todos jogam pelo navegador, sem instalar nada nos clientes.

Identidade visual do Hub: arcade, colorida, neon, fortemente cyberpunk. Os jogos mantêm seus próprios visuais.

## Como usar

```bash
bash prepare.sh   # uma vez (precisa de internet): instala deps e gera builds
bash start.sh     # sobe o Hub + os 3 jogos, com health checks
bash stop.sh      # encerra tudo sem deixar órfãos
```

Depois de `start.sh`, abra o Hub no navegador:

- neste computador: `http://localhost:8090`
- em outros computadores da rede: `http://<IP-do-anfitrião>:8090` (o script mostra o IP)

Todo o resto (entrar nos jogos, salas, prontidão) acontece dentro do Hub. Ninguém precisa decorar porta de jogo: o Hub monta os endereços dos jogos a partir do endereço usado para abrir o Hub.

## Serviços e portas

| Serviço       | Porta | Health          | Comando de produção              |
|---------------|-------|-----------------|----------------------------------|
| Hub           | 8090  | `GET /health`   | `node hub/server.js`             |
| Asfalto Vivo  | 8091  | `GET /api/info` | `npm start` em `Games/ArcadeAI_race_game` |
| VAVA2D        | 8092  | `GET /health`   | `npm start --workspace @vava/server` em `Games/VAVA2D` |
| Catan Deluxe  | 8093  | `GET /health`   | `npm start` em `Games/Catan` (requer `npm run build`) |

Todos escutam em `0.0.0.0`. As portas podem ser sobrescritas com `HUB_PORT`, `ARCADE_PORT`, `VAVA_PORT`, `CATAN_PORT` (padrões 8090, 8091, 8092, 8093). `start.sh` valida (inteiro 1–65535), reclama antes de subir se a porta já está ocupada e exporta as quatro variáveis: o Hub lê as portas do ambiente com fallback para `hub/games.json`, cada jogo recebe a sua via `PORT` e os health checks usam as mesmas portas. Exemplo: `ARCADE_PORT=8191 bash start.sh`. Detalhes do contrato entre Hub e jogos: `hub/PROTOCOLO.md`; guia para integrar um jogo novo: `Docs/INTEGRACAO_JOGOS.md`.

## Detalhes operacionais

- Logs: `.run/logs/<serviço>.log`. PIDs: `.run/pids/<serviço>.pid` + `.run/pids/<serviço>.meta` (ID da instância em `.run/instance_id`, starttime de `/proc`, boot id e cmdline do processo).
- `HUB_SECRET`: segredo compartilhado entre Hub e jogos. Usa o env se definido; senão, `start.sh` gera um aleatório, guarda em `.run/hub_secret` (reutilizado nas próximas subidas) e exporta para todos os serviços. Não commite esse arquivo.
- `start.sh` reclama e sai sem duplicar nada se um serviço já estiver no ar ou a porta estiver ocupada; `stop.sh` só sinaliza o PID depois de confirmar que ele pertence à instância (mesmo starttime+cmdline); se os metadados estiverem obsoletos, ausentes ou forem de outro boot, ele NÃO sinaliza — só limpa e reporta. O encerramento mata o grupo de processos inteiro (inclusive wrappers `npm`), sem órfãos.
- `START_TIMEOUT` (padrão 60s) limita a espera por cada health check.

## Offline depois de preparado

`prepare.sh` precisa de internet uma vez (npm + builds). Depois disso, Hub e jogos funcionam na rede local sem internet: nenhuma dependência de CDN, fonte remota, autenticação externa ou API pública durante o uso.

## Pendrive NTFS

- O projeto roda de qualquer caminho de montagem: os scripts resolvem o próprio diretório, sem caminhos absolutos. Chame sempre como `bash start.sh` (não dependa de bit executável).
- Evite symlinks e case-only renames dentro do projeto; o NTFS lida mal com ambos.
- `node_modules` usa symlinks internos do npm (ex.: `.bin/`, workspaces). Se algo falhar só no pendrive com erro estranho de módulo, apague `node_modules` e rode `bash prepare.sh` com o pendrive montado com `exec`.

## Distros

Testado em Linux com Node.js >= 22.13.0. Se faltar algo, `prepare.sh` diz o que e sai:

- openSUSE Tumbleweed: `sudo zypper install nodejs npm`
- Debian / Linux Mint: `sudo apt install nodejs npm` (ou NodeSource para versão recente)

## Testes

```bash
npm run test:hub     # 13 testes do servidor do Hub
npm run test:scripts  # regressão dos scripts start/stop/prepare (R1/R7/R10)
npm run test:games    # suítes de cada jogo
npm test              # tudo
npm run e2e           # ponta a ponta (Hub + 3 jogos efêmeros)
```

E2E: `hub/test/e2e/` (ver `hub/test/e2e/README.md`). Cada fluxo imprime
`proof=hooks|regras|play-real` — `hooks` é final forçado por fixture, não
partida completa.
