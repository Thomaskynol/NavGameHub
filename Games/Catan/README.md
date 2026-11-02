# Catan Deluxe Multiplayer

Catan clássico multijogador no navegador (2–4 jogadores), salas privadas por código, UI deluxe em português do Brasil, servidor autoritativo em Node + Socket.IO e persistência em SQLite.

Projeto independente, sem vínculo com a marca Catan®/Kosmos.

## Requisitos

- Node.js ≥ 22.13 (usa o módito nativo `node:sqlite`; testado no Node 24)
- npm ≥ 10

## Instalação e execução

```bash
npm install

# desenvolvimento (servidor :3001 + cliente :5173 com proxy)
npm run dev

# produção
npm run build          # typecheck + cliente (Vite) + servidor (esbuild → dist/server.mjs)
npm start              # servidor único entrega API + cliente em PORT (default 3001)
```

Abra `http://localhost:5173` (dev) ou `http://localhost:3001` (`PORT`, default **3001**) em produção.

### Variáveis de ambiente (`.env.example`)

| Variável | Default | Descrição |
|---|---|---|
| `PORT` | `3001` | porta HTTP do servidor |
| `HOST` | `0.0.0.0` | bind do servidor |
| `DB_PATH` | `db/catan.db` | arquivo SQLite |
| `ALLOWED_ORIGIN` | vazio (mesma origem) | origem CORS extra, se houver |
| `CATAN_TEST_HOOKS` | desligado | **somente testes**: habilita `force_next_dice`, `seed_rng`, `load_near_win_fixture` |

## Como jogar

1. **Criar sala** (ou entrar com código de 5 letras) e escolher apelido.
2. Compartilhe o código da sala. Cada jogador entra no mesmo navegador (abas) ou em outro dispositivo.
3. No lobby: escolher cor, marcar **Pronto**; o anfitrião inicia com 2–4 jogadores.
4. Partida: colocar 2 assentamentos + 2 estradas em ordem de cobrinha, depois rolar dados, construir, trocar e chegar a **10 pontos de vitória**.

- **Recuperação de sessão:** cada jogador recebe um *código de recuperação* (guarde-o). Em outro navegador/aba use "Recuperar sessão" com o código da sala + código de recuperação. Se a sessão já estiver ativa em outra aba, o jogo oferece **Recuperar controle** (assume) ou **Entrar como novo jogador**.
- Tutorial guiado na primeira partida; botão de regras e custos no jogo.

## Testes

```bash
npm test           # vitest: motor + servidor (integração, idempotência, persistência, partidas completas)
npm run test:e2e   # Playwright: 3 abas no mesmo navegador, fluxo completo até a vitória
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

Os testes de navegador usam `npm run build` + `scripts/e2e-server.mjs` (servidor de produção em porta efêmera, banco temporário, hooks de teste habilitados).

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`docs/rules.md`](docs/rules.md) | Regras do Catan clássico (edição 2020) interpretadas para o jogo + decisões de adaptação |
| [`docs/architecture.md`](docs/architecture.md) | Layout, contrato do motor, invariantes, concorrência, identidade, projeções |
| [`docs/protocol.md`](docs/protocol.md) | Mensagens cliente↔servidor, envelope idempotente, sessões |
| [`docs/persistence.md`](docs/persistence.md) | Schema SQLite, atomicidade, backup/restauração |
| [`docs/relatorio.md`](docs/relatorio.md) | Relatório de validação (o que foi testado e como) |

## Limitações conhecidas

- Servidor único em memória + SQLite local (sem cluster/HA).
- Sem tempo por turno; sem variantes (cartas de desenvolvimento especiais, 5–6 jogadores, expansões).
- Chat é texto simples com limitação de frequência; sem moderação automática além do rate limit.
