# Regras do CATAN Base (Edição 2020, 3–4 Jogadores)

Documento de referência para a implementação digital deste projeto.

## 1. Edição adotada e referências

- **Edição**: CATAN – Game Rules & Almanac (3–4 jogadores), 5ª edição em inglês, copyright 2020 Catan GmbH / Catan Studio. Regras desta versão têm precedimento sobre versões anteriores (declaração do próprio manual, regras vigentes desde 2015-01-01).
- **Escopo**: base game, 3–4 jogadores. Expansões (Seafarers, Cities & Knights etc.) fora do escopo.
- **Adaptação do projeto (2 jogadores)**: o projeto permite partidas com **2 jogadores** (mudança de regra autorizada): snake `[p0,p1,p1,p0]`, demais regras inalteradas. O manual oficial cobre 3–4; em conflito, vale o manual para 3–4 e esta adaptação para 2.

Fontes consultadas (data de acesso: 14/10/2026):

| Fonte | URL |
|---|---|
| Manual/Almanaque oficial (PDF) | https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf |
| FAQ oficial do base game | https://www.catan.com/faq/basegame |
| Índice de regras oficiais | https://www.catan.com/understand-catan/game-rules |

Observação: o índice de regras oficiais confirma o PDF acima como o manual arquivado do base 3–4 jogadores ("CATAN – Game Rules & Almanac (3-4 Players)"). O índice também aponta um rulebook mais novo (2025); este projeto adota explicitamente a edição 2020 especificada no requisito.

## 2. Resumo das regras implementadas por seção

### 2.1 Tabuleiro

- 19 hexes de terreno: 4 pastagens (lã), 4 florestas (madeira), 3 montanhas (minério), 4 campos (grão), 3 colinas (tijolo), 1 deserto (não produz).
- 18 fichas de número (2–12, sem 7; cada número aparece duas vezes exceto 2 e 12). Números vermelhos 6 e 8 são os mais frequentes.
- Setup variável: hexes embaralhados; em modo totalmente aleatório, fichas vermelhas 6/8 não podem ficar adjacentes entre si (decisão deste projeto: modo totalmente aleatório com essa restrição). Deserto não recebe ficha de número.
- O ladrão inicia o jogo no deserto.
- Portos: 4 portos genéricos 3:1 + 5 portos especiais 2:1 (um por tipo de recurso). Controla-se um porto com assentamento/cidade em uma das duas interseções costeiras do porto; peças adversárias no hex do porto não bloqueiam o porto (FAQ).

### 2.2 Preparação (setup ida-e-volta)

- Ordem "snake draft" em 2 rodadas; cada rodada: 1 assentamento + 1 estrada adjacente. Fila: `[p0,p1,p2,p3,p3,p2,p1,p0]` (4), `[p0,p1,p2,p2,p1,p0]` (3), `[p0,p1,p1,p0]` (2, adaptação do projeto).
- **Rodada 1**: jogador inicial escolhe assentamento em interseção livre + estrada adjacente; demais seguem em sentido **horário**.
- **Rodada 2**: quem foi último na rodada 1 começa; demais em sentido **anti-horário** (o jogador inicial da rodada 1 fecha a rodada 2).
- **Recursos do 2º assentamento**: imediatamente após posicionar o 2º assentamento, o jogador recebe 1 carta de cada hex adjacente (deserto não produz). Nenhum recurso do 1º assentamento.
- A 2ª estrada deve estar ligada ao 2º assentamento (qualuma das 3 direções). O 2º assentamento **não** precisa estar conectado ao 1º.
- Regra de distância vale desde a 1ª colocação.

### 2.3 Economia (banco e escassez)

- **Banco de recursos**: **19 cartas por tipo** (tijolo, madeira, minério, grão, lã).
- **Produção**: rolar 2d6 no início do turno; hex com a ficha do resultado produz para assentamentos (1) e cidades (2) adjacentes.
- **Escassez (regra do banco)**:
  1. Antes de distribuir, determinar a produção total de cada tipo.
  2. Se o banco **não** alcança todos os que têm direito àquele tipo: **ninguém** recebe aquele tipo nesta rodada (demais tipos não são afetados).
  3. **Exceção do único beneficiário**: se só **um** jogador tem direito àquele tipo, ele recebe o que restar no banco; o excedente que teria direito é perdido.
- Jogador não pode recusar produção.
- Contagem do banco durante o jogo: permitida logo após o roll, antes da distribuição, e somente quando não há certeza de cartas suficientes (FAQ).
- Cartas de desenvolvimento **nunca** voltam ao banco; não se compra desenvolvimento com o monte vazio.

### 2.4 Turno, o 7 e o ladrão

**Sequência oficial do turno**:
1. **Produção (obrigatória)**: rolar os dados.
2. **Troca** (opcional): doméstica e/ou marítima.
3. **Construção** (opcional): estradas, assentamentos, cidades e/ou compra de desenvolvimento.
- **Carta de ação** (cavaleiro/progresso): a qualquer momento do seu turno, **inclusive antes de rolar** (FAQ + almanaque). Limite de 1 carta de ação por turno; **não** pode jogar carta comprada no mesmo turno (exceto revelação de VP, abaixo).
- Fase combinada de troca/construção adotada como padrão digital (recomendação do almanaque); permite usar porto no mesmo turno em que se construiu o assentamento nele.

**Resolução do 7 — ordem exata**:
1. Ninguém produz.
2. **Descarte obrigatório antes de qualquer ação**: todo jogador com mais de 7 cartas descarta metade arredondada para baixo (8→4, 9→4, 10→5, 11→5); escolha do próprio jogador; volta ao banco; uma única vez por 7.
3. **Mover o ladrão (obrigatório)**: jogador do 7 deve movê-lo para **outro** hex terrestre (não pode deixar no mesmo).
4. **Roubo**: vítima entre jogadores com assentamento/cidade no hex alvo (escolha do atacante se ≥ 2); 1 carta aleatória da mão da vítima; vítima sem cartas → sem roubo; roubo no deserto é válido (vítimas adjacentes); hex com ladrão fica bloqueado para produção.
5. **Só então** a fase de troca/construção do turno. Não se troca antes de resolver o 7 (FAQ).
- Cavaleiro + 7 no mesmo turno: dois movimentos de ladrão. Cavaleiro não força descarte dos demais.

### 2.5 Trocas

- **Doméstica**: sempre envolve o jogador da vez; demais não trocam entre si; sem doações; sem crédito; proibido mesmo recurso nos dois lados.
- **Marítima**: 4:1 sempre; 3:1 com porto genérico; 2:1 com porto especial **apenas** para o recurso indicado.
- Cartas de desenvolvimento **não** são negociáveis.

### 2.6 Cartas de desenvolvimento

- 25 cartas: 14 Cavaleiros, 2 Monopólio, 2 Fartura, 2 Construção de Estradas, 5 Ponto de Vitória.
- Compra: 1 grão + 1 lã + 1 minério; topo do monte; oculto; várias por turno permitidas; todas "compradas neste turno" (não jogáveis neste turno).
- 1 carta de ação por turno (cavaleiro ou progresso), a qualquer momento, exceto carta comprada no mesmo turno.
- **VP**: reveladas a qualquer momento do próprio turno em que se tem certeza de 10+; todas de uma vez; inclui compradas no mesmo turno (comprar a VP final vence na hora); revelação de VP **não** consome a carta de ação do turno.
- Progresso é removida do jogo; cavaleiro fica à frente e conta para Maior Exército.
- **Cavaleiro**: mover ladrão + roubo (mesmo fluxo do 7, sem descarte alheio).
- **Construção de Estradas**: 2 estradas gratuitas imediatas com regras normais; com < 2 locais válidos, coloca o que for possível (resto perdido — decisão §4).
- **Monopólio**: anunciar 1 tipo; todos os demais entregam todas as cartas daquele tipo.
- **Fartura**: tomar 2 cartas do banco (mesmo ou dois tipos); com banco esgotado, tomar o que houver (decisão §4).

### 2.7 Pontuação e vitória

- **10 pontos no próprio turno** encerra o jogo imediatamente; vitória só no próprio turno.
- Assentamento 1, cidade 2, Maior Estrada 2, Maior Exército 2, VP 1. Todos começam com 2 pontos.
- No início do próprio turno com 10+ pontos: **não é obrigatório** rolar (FAQ).
- Cartas de VP contam imediatamente na compra para vitória.
- Sem fase de construção extra ao fim (variante fora do escopo).

**Maior Estrada**: ≥ 5 segmentos; conta o ramo mais longo (bifurcações não somam); ciclos contam como caminho contínuo; assentamentos/cidades **adversários** interrompem (próprios não); titular só perde para estrada **estritamente maior**; empate com titular ⇒ titular mantém; se o titular perde e ≥ 2 empatam (ou ninguém ≥ 5): cartão **sem dono** até líder único.

**Maior Exército**: ≥ 3 cavaleiros jogados; transferência apenas com **mais** cavaleiros que o titular; empate não verificado na fonte — adaptação: mesmo critério do Maior Estrada (§4).

### 2.8 Construção (regras de peças)

| Peça | Condições |
|---|---|
| Estrada | 1 tijolo + 1 madeira; encostar em peça própria; 1 por aresta; não atravessa assentamento/cidade adversária; **o ladrão não bloqueia** construção; limite 15 |
| Assentamento | 1+1+1+1; regra de distância (3 vértices adjacentes livres); encostar em estrada própria (após setup); limite 5 em campo |
| Cidade | 3 minério + 2 grão; upgrade de assentamento próprio; casa volta ao suprimento; limite 4 |
| Desenvolvimento | 1 minério + 1 lã + 1 grão; monte vazio proíbe; nunca volta ao banco |

## 3. Tabela de custos

| Ação | Custo | Limite |
|---|---|---|
| Estrada | 1 tijolo + 1 madeira | 15 |
| Assentamento | 1 tijolo + 1 madeira + 1 lã + 1 grão | 5 em campo |
| Cidade | 3 minério + 2 grão | 4 |
| Desenvolvimento | 1 minério + 1 lã + 1 grão | monte de 25 |
| Porto genérico 3:1 | assentamento/cidade na interseção do porto | — |
| Porto especial 2:1 | idem; vale só para o tipo indicado | 1 por tipo |

## 4. Decisões de adaptação digital

1. **Fase combinada de troca/construção** como padrão (recomendação do almanaque).
2. **Descartes do 7 como pendência global**: nada avança até todos os descartes + movimento/roubo do ladrão.
3. **Idempotência de rede**: comandos com requestId; dados/baralho/roubo sorteados no servidor com RNG criptográfica.
4. **Sem tempo de turno** (regra oficial não tem relógio).
5. **Escassez do banco**: regra completa; banco virtual fixo em 19/tipo (sem suplemento da FAQ).
6. **Maior Exército em empate**: adaptação igual Maior Estrada (não verificado na fonte).
7. **Construção de Estradas com < 2 locais válidos**: coloca o que for possível; resto perdido (não verificado na fonte).
8. **Fartura com banco esgotado**: toma o que houver (0–2 cartas) e conclui (não verificado na fonte).
9. **Compra de desenvolvimento antes do roll**: não permitida (só o jogo de carta de ação antes do roll).
10. **Vitória por VP**: servidor valida os pontos no ato da compra/revelação; manter ocultos apenas pontos de VP não revelados.
11. **`boughtThisTurn` por carta; `playedActionCardThisTurn` por turno**; jogar carta comprada neste turno bloqueado; VP é exceção de vitória imediata.
12. **Variantes fora de escopo**: mapa do iniciante, anti-aleatório letra-alfa, fase final de construção, expansões.
13. **Taxa marítima multi-recurso**: em troca com o banco pedindo mais de um tipo, a taxa é a **soma por recurso** — `taxa = Σ_k want[k] × melhorTaxa(recurso recebido k)` e exige-se `sum(give) === taxa` (ex.: receber 1 grão com porto 2:1 + 1 lã sem porto = 2 + 4 = 6 cartas dadas).
14. **Partidas com 2 jogadores**: fila snake `[p0,p1,p1,p0]`; mínimo de jogadores 2 (servidor impõe `NEED_PLAYERS` abaixo disso); máximo 4 inalterado.

## 5. Aviso

Projeto independente, sem vínculo com Catan GmbH, Catan Studio ou Klaus Teuber. CATAN e marcas relacionadas são propriedade de seus titulares. Este documento é uma parafrase de regras oficiais para fins de implementação software; em conflito, vale o manual oficial da edição adotada.
