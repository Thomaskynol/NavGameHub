# Persistência

Banco: SQLite via `node:sqlite` (módulo nativo do Node ≥ 22.13), caminho em `DB_PATH` (default `db/catan.db`). Nenhuma dependência nativa externa.

## Formato (migração inicial)

`PRAGMA user_version = 1`.

| Tabela | Conteúdo |
|---|---|
| `rooms` | código (PK), nome, anfitrião, `state_json` (snapshot completo do `GameState`), fase, `version`, seed do tabuleiro, timestamps, `closed` |
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

- Salas encerradas (vitória + saída de todos) marcadas `closed = 1` (ou removidas com o chat junto) — nunca automaticamente por erro de leitura.
