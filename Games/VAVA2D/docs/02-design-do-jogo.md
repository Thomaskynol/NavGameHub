# 02 — Game Design do MVP

## Pitch

> Um gramado aberto, pedras e árvores como cobertura, e uma pistola na mão.
> Todos contra todos. As balas são visíveis e lentas o suficiente para um bom jogador
> desviar com um dash no momento certo.

Partida rápida de navegador, sem download e sem cadastro. O objetivo é acertar amigos e
terminar com mais abates em 5 minutos.

## Pilares

1. **Legibilidade** — tudo visto de cima, silhuetas claras, bala amarela brilhante.
2. **Movimento gostoso** — aceleração rápida, dash curto e resposta imediata.
3. **Tiro desviável** — projéteis a 720 px/s, visíveis por ~2 s de tela.
4. **Entrar e jogar** — criar sala, mandar link, começar em segundos.

## Controles

| Ação | Tecla |
|---|---|
| Mover | `WASD` ou setas |
| Mirar | mouse |
| Atirar | botão esquerdo (segurar mantém o fogo no ritmo da pistola) |
| Recarregar | `R` |
| Dash | `Shift` ou `Espaço` |
| Sair da sala | `Esc` ou botão `Sair` (volta ao menu sem recarregar a página) |
| Tela cheia | `F11` (do navegador) |

O navegador bloqueia scroll com `Espaço` durante a partida. O cursor nativo é escondido
e substituído por uma mira desenhada no canvas.

## Loop de partida

1. FFA (todos contra todos), até 8 jogadores por sala.
2. Partida de **5 minutos**; começa quando há 2 jogadores.
3. Se a sala ficar com 1 jogador, o timer pausa em `waiting` e retoma quando alguém entrar.
4. Ao zerar: 8 segundos de placar final, depois todos voltam com placar zerado.
5. Jogadores podem entrar no meio da partida.
6. Vence quem tiver mais abates (`kills`). Empate é exibido como empate.

## Vida, morte e respawn

- Vida máxima: **100**.
- Pistola causa **25** por acerto: 4 tiros para matar.
- Sem regeneração de vida e sem pickups no MVP.
- Ao morrer: 3 segundos de espera, câmera parada no local, overlay com contador.
- O respawn escolhe o spawn mais distante dos inimigos vivos.
- Proteção de spawn de **1,5 s**: anel ciano, imune a dano, balas atravessam.
- Não há colisão entre jogadores; eles se atravessam para manter o movimento fluido.

## Movimento

| Parâmetro | Valor |
|---|---|
| Velocidade máxima | 225 px/s |
| Aceleração | 2800 px/s² |
| Desaceleração | 3200 px/s² |
| Raio do jogador | 15 px |
| Dash — velocidade | 900 px/s |
| Dash — duração | 0,14 s (~126 px) |
| Dash — recarga | 1,6 s |
| Direção do dash | direção do movimento; se parado, direção da mira |

O movimento usa aceleração/desaceleração (não velocidade instantânea) para dar peso.
Colisões com pedras/árvores deslizam pela superfície; a velocidade na direção da parede
é removida. O dash não dá invulnerabilidade — é posicionamento, não defesa garantida.

## Combate

| Parâmetro | Valor |
|---|---|
| Dano | 25 |
| Cadência | 1 tiro a cada 0,28 s |
| Velocidade da bala | 720 px/s |
| Alcance | 1500 px (~2,08 s de vida) |
| Raio da bala | 3,5 px |
| Pente | 10 balas |
| Recarga | 1,35 s |
| Espalhamento | 0 (precisão exata no MVP) |
| Balas simultâneas | sem limite além das naturais da cadência |

- Recarga é automática ao esvaziar o pente e manual com `R`.
- Recarregar não impede andar ou dar dash.
- O tiro nasce no cano (28 px à frente do centro) e não acerta o próprio atirador.
- A colisão é feita por **segmento percorrido no tick**, evitando balas que atravessam alvos.
- Balas são bloqueadas por pedras, árvores e pela borda do mapa.
- Um acerto gera hitmarker, número de dano flutuante e faísca. Uma morte gera killfeed,
  partículas e um pequeno screen shake.

### Tempo de reação e desvio

A 720 px/s, uma bala cruza a tela de 1280 px em ~1,8 s. Um jogador a 225 px/s anda ~400 px
nesse tempo. O dash cobre 126 px em 0,14 s. Isso permite desviar de tiros à distância,
mas quase não permite reagir a tiros disparados a Queima-Roupa — exatamente a tensão
desejada.

## Mapa — “Campo Aberto”

- Arena de **2400 × 1600 px**, delimitada por cerca e faixa de terra.
- Gramado com textura procedural, flores e manchas claras/escuras.
- **Cobertura**: 12 obstáculos circulares entre pedras e árvores, com sombra.
- Área jogável: 48 px de margem em cada lado.
- **10 pontos de spawn** distribuídos pelas bordas e pelo meio; o servidor escolhe o mais
  seguro no momento do respawn.
- Sem elementos destrutíveis, sem plataformas, sem água.

Obstáculos (posição e raio de colisão):

| Tipo | X | Y | Raio |
|---|---:|---:|---:|
| Pedra | 620 | 360 | 54 |
| Árvore | 980 | 520 | 38 |
| Pedra | 1500 | 300 | 46 |
| Árvore | 1900 | 460 | 40 |
| Pedra | 2050 | 900 | 56 |
| Árvore | 1750 | 1080 | 38 |
| Pedra | 1400 | 760 | 64 |
| Árvore | 760 | 950 | 36 |
| Pedra | 500 | 1250 | 48 |
| Árvore | 1050 | 1280 | 40 |
| Pedra | 2250 | 1300 | 40 |
| Árvore | 300 | 620 | 34 |

Spawns: `(150,150)`, `(2250,150)`, `(150,1450)`, `(2250,1450)`, `(1200,170)`,
`(1200,1430)`, `(150,800)`, `(2250,800)`, `(700,800)`, `(1700,800)`.

## Personagem

Visto de cima, desenhado em código:

- sombra elipse;
- pernas animadas conforme a distância andada;
- torso circular na cor do jogador;
- cabeça com pele e cabelo na direção oposta à mira;
- dois braços segurando uma pistola escura à frente;
- nome e barra de vida para os outros jogadores;
- anel de proteção de spawn;
- rastro sutil durante o dash;
- flash no cano ao atirar.

Cores fixas por jogador (até 8): laranja, azul, verde, rosa, amarelo, roxo, vermelho e ciano.
A cor é escolhida pela primeira vaga livre na sala.

## HUD e telas

### Menu

- Nome (salvo em `localStorage`).
- **Criar sala**.
- Código de 4 letras + **Entrar**.
- Link com `?sala=ABCD` preenche o código automaticamente.
- Controles e mensagens de erro.

### Em jogo

- Canto superior esquerdo: código da sala, botão `Sair` e killfeed.
- Centro superior: timer.
- Canto superior direito: ping e placar compacto (abates).
- Inferior esquerdo: vida, barra de dash e nome.
- Inferior direito: pente em pips, contador e barra de recarga.
- Centro: mira; hitmarker ao acertar.
- Banner de sala aguardando jogadores com botão **copiar link**.
- Overlay de morte com contador e autor do abate.
- Overlay de fim de partida com vencedor e placar.

### Feedback

- Flash de dano vermelho nas bordas quando o jogador leva tiro.
- Números de dano apenas para quem atirou.
- Partículas de grama/poeira em acertos e mortes.
- Screen shake leve em tiros e mortes próximas.
- Sem áudio no MVP (previsto para a próxima fase).

## Fora do escopo do MVP

- Times, modo captura de bandeira ou battle royale.
- Outras armas, granadas, itens e vida extra.
- Chat de texto/voz.
- Mobile/touch.
- Contas, ranking persistente e matchmaking.
- Reconexão após queda.
- Mapas múltiplos e editor.
- Servidor com múltiplas instâncias/regiões.
