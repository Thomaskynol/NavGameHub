# Suíte E2E do Game Hub

`npm run e2e` (na raiz) sobe Hub + 3 jogos efêmeros e roda os 10 fluxos.
Nada aqui toca em `hub/server.js`, jogos ou `start.sh`/`stop.sh`.

## Como rodar

```bash
npm run e2e                        # suíte completa (Hub + 3 jogos efêmeros)
node hub/test/e2e/run-all.mjs flow6-catan.mjs   # um fluxo só (sobe o stack mesmo assim)
E2E_KEEP_TMP=1 npm run e2e          # preserva tmp (logs, shots, manifest) p/ debug
```

Rodar um fluxo avulso contra uma instância já no ar (ex.: `start.sh`):

```bash
E2E_HUB_PORT=8090 E2E_ARCADE_PORT=8091 E2E_VAVA_PORT=8092 E2E_CATAN_PORT=8093 \
  node hub/test/e2e/flow2-capacity.mjs
```

Sem env, os fluxos caem nos padrões 8090..8093 e leem o segredo de
`.run/hub_secret`. Com o orquestrador, portas e `E2E_HUB_SECRET` vêm do
ambiente (efêmeros, sem colidir com a sua instância).

## Rótulos de prova

Cada fluxo imprime `proof=<tipo>` no início e o `run-all` repete o rótulo
no relatório. Não apresente `hooks` como partida completa:

| prova | significado |
|---|---|
| `hooks` | final forçado por hook de teste (`/__hub/test/...`). Cobre transições Hub↔jogo, não jogabilidade. |
| `regras` | efeito/término pelas regras normais do servidor, sem jogar tudo (ex.: capacidade, nick, host-transfer). |
| `play-real` | ações reais de jogo (inputs + progresso pela simulação normal), sem hook — mas sem fim natural: uma corrida inteira, uma arena de 5 min ou um Catan completo são longos demais p/ a suíte. |

## Falhas estritas de navegador

Os scripts com navegador (`ui-smoke`, `verify-*`) reprovam em `pageerror` e
em falhas de recursos **necessários** (scripts do Hub/jogos, handshakes WS,
HTTP do Hub/jogos com status de erro). Allowlist justificada (benigna, não
mascara defeito real — ver `strictCollector` em `e2e-helpers.mjs`):

- `/favicon.ico` → navegador pede sozinho; 404 não afeta o jogo.
- `*.map` → source map ausente em build de produção não quebra nada.
- URLs `data:`/`blob:` e de outros hosts → fora do escopo do Hub.

Limite conhecido: desconexões WS no nível da aplicação (ex.: timeout de
jogo) não são detectáveis por esse monitor — os fluxos de protocolo as
cobrem com timeouts explícitos.

## Orquestração

- Portas livres por execução (4x `bind(0)`), manifesto efêmero via
  `HUB_GAMES_FILE`, `DB_PATH` do Catan num sqlite temporário (não suja o
  banco real), `HUB_SECRET` aleatório por run.
- Teardown mata o **grupo** de processos (cobre o wrapper `npm` do VAVA).
  Falha ou `E2E_KEEP_TMP=1` preserva o tmp com `logs/services.log` e shots.
- Navegadores: Chromium headless isolado (`CHROMIUM_PATH` ou autodetecta
  `/usr/bin/chromium*` e o cache `~/.cache/ms-playwright`); cada script usa
  seus próprios contextos — perfil pessoal nunca é tocado, sem rede alterada.
