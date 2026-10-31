# Persistência

Banco: SQLite via `node:sqlite` (módulo nativo do Node ≥ 22.13), caminho em `DB_PATH` (default `db/catan.db`). Nenhuma dependência nativa externa.

## Formato (migração v2)

`PRAGMA user_version = 2` (`meta.format = "2").

| Tabela | Conteúdo |
|---|---|
| `rooms` | código (PK), nome, anfitrião, `state_json` (snapshot completo do `GameState`), fase, `version`, seed do tabuleiro, timestamps, `closed`, `hub_token` (dono da instância, v2) |
| `members` | sala+jogador (PK), apelido, cor, `recovery_hash` (SHA-256 hex, único), `ready`, `joined_at` |
| `processed_commands` | `request_id`+`player_id` (PK), hash do payload, resposta JSON armazenada (idempotência) |
| `chat` | últimas ~200 mensagens por sala |
| `meta` | chave/valor (versão de formato) |

## Atomicidade

- Toda transição de jogo aceita = **uma transação**: novo snapshot em `rooms.state_json` + `version` + linha em `processed_commands`.
- O ack `{ok:true}` e o broadcast só acontecem **depois do commit**. Falha na gravação → `{ok:false, INTERNAL}`, estado em memória segue o snapshot anterior (sem efeito parcial).
- Presença (conectado/desconectado) é transitória e não é persistida como verdade: após reinício, todos começam desconectados.

## Recuperação

- Boot carrega todas as salas com `closed = 0` (inclui partidas em fases pendentes — descartes, ladrão, resoluções de dev card — pois o snapshot guarda `pending`, `returnPhase`, ofertas, histórico, `devDeck`, bancos e peças).
- Salas são recuperáveis pelos mesmos códigos após reiniciar o servidor; o cliente retoma com `bind_session resume`/`claim`.
- `processed_commands` sobrevive ao reinício: reenvio de um comando já confirmado devolve a mesma confirmação, sem repetir efeito.

## Backup / restauração

- Backup: parar ou copiar quente o arquivo `DB_PATH` (`sqlite3 .backup` ou cópia do arquivo com o servidor parado).
- Restaurar: substituir o arquivo e reiniciar (`npm start`).
- Leitura de arquivo com versão desconhecida (`user_version` maior que o código) → o servidor **não apaga** nada: aborta com mensagem clara no log. Arquivo corrompido → aborta com instrução de restaurar backup (nunca recria silenciosamente).

## Limpeza

- Sala encerrada (`POST /__hub/close` autorizado ou último `leave_room`) é
  **removida por completo** (sala + membros + chat + `processed_commands`) e o
  código fica livre para reutilização segura (com identidade `hub_token`).
- Migração v1 → v2: adiciona `rooms.hub_token` e apaga salas com `closed = 1`
  (códigos históricos que bloqueavam reutilização para sempre) com seus dados.
- Sala fechada nunca bloqueia código novo: `roomCodeExists` considera só
  `closed = 0`, e `insertRoom` descarta resíduo `closed = 1` na mesma transação.
- Nunca apagar sala por erro de leitura.
