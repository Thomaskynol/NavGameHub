# Asfalto Vivo

Corrida arcade 3D no navegador, para até 6 jogadores, com duas pistas, time trial
com recordes locais e jogos em LAN. Sem instalação, sem contas, sem assets
externos — tudo é servido por este repositório (a cena 3D é gerada por código).

## Rodar

```bash
npm install   # só na primeira vez (three + ws)
npm start     # sobe em http://0.0.0.0:8080 (PORT=xxxx para outra porta)
```

Abra `http://localhost:8080` no computador de cada jogador (mesma rede para LAN;
o endereço de cada interface sai no console e em `GET /api/info`).

## Controles

| Ação | Tecla |
| --- | --- |
| Acelerar | `W` / `↑` |
| Ré / freio | `S` / `↓` |
| Direção | `A` `D` / `←` `→` |
| Nitro | `Shift` |
| Derrapagem (handbrake) | `Espaço` |
| Recuperar (saída de pista) | `R` |
| Pausa | `Esc` |

## Modos

- **Multijogador (6 máx.)**: alguém cria a sala, compartilha o código de 6
  caracteres, os outros entram. O host escolhe pista (Circuito Costeiro ou
  Distrito Industrial) e voltas (1–5) e inicia. Countdown de 3 s, cronômetro por
  volta, resultado com pódio; botão de revanche volta todo mundo ao lobby.
  Quem cair pode reconectar em até 30 s pela mesma aba (token na sessão); após a
  largada, quem entrar fica em tela de espera até a corrida terminar. O 1º colocado
  conclui e o grupo tem 45 s de prazo para cruzar a linha.
- **Time trial (1 jogador)**: volta livre contra o próprio recorde por pista.
  Voltas inválidas (uso de recuperação) não contam para o recorde.

## Como funciona (resumo técnico)

- **Servidor**: Node + `ws`, sem build. Estático de `public/`, módulos ES de
  `shared/` e Three.js de `node_modules` via `/vendor/`.
- **Autoridade**: o cliente simula o próprio carro (passo fixo 1/120 s); o
  servidor valida progresso, voltas, posições e resultados projetando a posição
  no centerline (não confia no `s` do cliente). Colisão carro-carro resolve no
  servidor.
- **Relógio**: só o servidor marca tempo (offset estimado por ping/EMA).
- **3D**: Three.js r160, cena procedural (pista, zebras, barreiras, decoração,
  partículas), sem texturas nem arquivos de mídia.
- **Estado local**: `av.settings` (config), `av.records` (recordes TT),
  `av.session` (token de reconexão por aba).

## Scripts

```bash
npm test            # testes do servidor (node:test)
npm run check:tracks  # validação dos traçados das pistas
node tools/check_trackmath.js   # validação do sampler
node tools/check_carphysics.js  # validação da física do carro
```

## Limitações conhecidas

- Corrida não retomada entre sessões: recarregar no meio zera o resultado local.
- Qualidade gráfica (sombras/pixel ratio) aplica no próximo carregamento de pista;
  volume/mudo valem na hora.
- Navegadores modernos com WebGL2 e suporte a `clip-path` (Chrome/Firefox atuais).

Feito para este exercício — ver `CREDITS.md`.
