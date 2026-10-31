# Game Hub — Modelagem do produto

**Status:** primeira versão da modelagem, baseada nas decisões do proprietário. Os jogos ainda precisam ser inspecionados; seus detalhes técnicos e limites reais não devem ser presumidos.

## 1. Visão do produto

O Game Hub reúne jogos de navegador em uma única plataforma para que grupos de amigos possam encontrá-los e jogá-los pela rede local. Uma pessoa inicia o servidor em um computador Linux; ela e os demais jogadores acessam o Hub pelo navegador em seus computadores.

O Hub oferece um catálogo de jogos e salas compartilhadas. Cada sala reúne um grupo, tem um código e um jogo selecionado. Após uma partida, o grupo retorna à mesma sala do Hub e pode continuar jogando ou escolher outro jogo.

O produto deve preservar os jogos existentes e facilitar a inclusão de novos jogos no futuro. O projeto inteiro ficará em um pendrive NTFS e será desenvolvido com o auxílio do OpenCode.

## 2. Escopo inicial

### 2.1 Jogos

A primeira versão deve integrar os três jogos já prontos disponibilizados pelo proprietário:

1. Um jogo de tiro multiplayer.
2. Um jogo de corrida multiplayer.
3. Um jogo de tabuleiro multiplayer.

Os nomes exatos, limites de jogadores, modos, telas, dependências e funcionamento de cada jogo devem ser conferidos no código e nas instruções existentes. Valores mencionados durante a conversa, como tiro para até 8 jogadores, tabuleiro para até 4 e corrida possivelmente para até 6, são **referências provisórias**, não fatos verificados.

Há outros jogos em avaliação ou em desenvolvimento. Eles não precisam ser integrados nesta primeira entrega, mas a estrutura do Hub deve permitir adicioná-los depois. Jogos futuros podem ser multiplayer ou single-player. Um jogo single-player pode ter sala com capacidade para uma pessoa; não deve ser transformado em multiplayer apenas para ser incluído no Hub.

### 2.2 Fora do escopo exigido agora

Não são exigidos cadastro de conta, senha de usuário, perfis persistentes, histórico de partidas, ranking global, hospedagem em nuvem, publicação na internet, suporte a controles por toque ou uma interface para fazer upload e instalar jogos pelo navegador. Não acrescentar esses recursos como condição para entregar o Hub.

O proprietário pretende adicionar jogos colocando seus códigos no projeto e, quando necessário, pedindo ao OpenCode para integrá-los.

## 3. Plataformas e ambiente

### 3.1 Servidor

- O servidor deve funcionar em Linux. Os ambientes de interesse são **openSUSE Tumbleweed, Debian e Linux Mint**.
- O projeto ficará em um **pendrive formatado em NTFS** e será usado em mais de um computador Linux.
- A execução deve usar os programas e runtimes disponíveis na máquina anfitriã, como Node.js e Python quando necessários, sem exigir que o projeto traga cópias próprias dessas linguagens.
- A presença de Node.js, Python ou outras ferramentas nos computadores previstos é uma expectativa do proprietário, não uma garantia universal de todas as instalações Linux. As versões, os gerenciadores de pacotes e as bibliotecas efetivamente necessários dependem do Hub e dos jogos.
- O processo de preparação e inicialização deve informar quais dependências e versões são necessárias e apresentar erros claros caso algo esteja ausente ou seja incompatível. Não presumir que ter uma linguagem instalada significa ter todas as bibliotecas dos jogos.
- Não depender de caminhos absolutos de um usuário ou de uma máquina específica. O projeto deve continuar utilizável ao mover o pendrive e montá-lo em outro caminho.
- O uso de NTFS precisa ser considerado na implementação e na validação: permissões de execução, links simbólicos, opções de montagem e dependências nativas podem variar. Não depender silenciosamente de `chmod` ou de um comportamento de filesystem que não tenha sido verificado.
- Documentar como preparar, iniciar e encerrar o Hub e seus serviços. A pessoa que hospeda não deve ter que iniciar e configurar manualmente uma sala ou servidor de cada jogo para cada grupo.

Um procedimento simples e documentado, preferencialmente com um único comando para iniciar os serviços necessários, é uma **proposta operacional**; o formato exato de inicialização não foi especificado pelo proprietário.

### 3.2 Clientes

- Jogadores acessam pelo navegador em **computadores**, inclusive no próprio computador que hospeda o servidor.
- O Hub e os jogos integrados devem funcionar em navegadores modernos de desktop. Firefox e navegadores baseados em Chromium são referências relevantes para verificação.
- Compatibilidade com celular, tablet e controles por toque não é exigida nesta versão.
- Todos começam pelo endereço do Game Hub. O uso normal não deve exigir que cada pessoa descubra manualmente a porta ou o endereço de cada jogo.

### 3.3 Rede local e uso sem internet

- O cenário principal é jogar com pessoas capazes de alcançar o computador anfitrião pela rede local.
- Depois de preparado o projeto e suas dependências, o Hub e os jogos integrados devem funcionar **sem acesso à internet**, mantendo a comunicação necessária pela rede local.
- Isso inclui interface do Hub, bibliotecas do navegador, imagens, fontes, scripts e serviços necessários aos jogos. Não depender de CDN, autenticação ou API externa durante a jogatina.
- O Hub não deve depender de hospedagem pública e não deve abrir portas no roteador automaticamente.
- VPNs e redes virtuais, como Hamachi ou Radmin, não precisam de integração específica. O acesso dependerá de existir conectividade até o servidor; a capacidade de acessar um IP por si só não prova que o cliente esteja fisicamente na mesma rede local.

## 4. Catálogo de jogos

- Mostrar os jogos integrados e disponíveis no Hub, com identificação clara para que o usuário escolha o que quer jogar.
- Exibir informações reais e úteis de cada jogo, incluindo sua quantidade suportada de jogadores quando verificada. Se um jogo estiver indisponível por erro ou por não ter sido integrado, não apresentá-lo como funcional.
- A apresentação deve combinar com a identidade visual do Hub e distinguir os jogos de forma clara.
- Não inventar modos, regras, limites ou funcionalidades dos jogos. Os dados e a experiência de cada um devem ser obtidos pela inspeção do projeto e verificados na integração.

## 5. Identificação dos jogadores

- Cada pessoa informa um **apelido simples**, sem criar conta nem senha.
- O apelido deve ser **único em todo o Hub**, inclusive entre pessoas em salas diferentes. Uma tentativa de usar um nome já ocupado deve ser recusada com uma explicação clara e permitir escolher outro.
- A identificação de cada jogador deve ser mantida ao passar do Hub para o jogo e ao retornar à sala, sem que ele precise informar outro apelido ou código de sala no fluxo normal.
- O comportamento preciso para letras maiúsculas, espaços, tamanho do nome e reserva após uma desconexão ainda não foi definido. A implementação deve escolher e documentar regras coerentes sem permitir duas pessoas simultâneas com o mesmo apelido.

## 6. Salas do Hub

### 6.1 Criação e descoberta

- Qualquer jogador pode criar uma sala.
- A sala possui um **código**, uma lista de jogadores, um anfitrião, um jogo selecionado e uma capacidade configurada.
- Os jogadores podem entrar informando o código **ou** escolhendo a sala na lista de salas disponíveis.
- A lista deve mostrar informações suficientes para identificar a sala, o jogo, a ocupação e se a sala está aguardando ou com partida em andamento. A interface deve refletir as alterações relevantes sem depender de atualização manual contínua da página.
- Salas são visíveis às pessoas que acessam o Hub; salas privadas ou protegidas por senha não foram solicitadas.
- Uma sala não pode aceitar mais pessoas do que sua capacidade configurada. Isso inclui quem está jogando e quem entrou na sala para esperar a próxima partida.

### 6.2 Anfitrião

- A pessoa que cria a sala é seu anfitrião inicial.
- O anfitrião controla a escolha do jogo e a capacidade da sala.
- Se o anfitrião sair e houver outros jogadores, outro jogador assume automaticamente. O critério para escolher o sucessor não foi definido e deve ser consistente e documentado.
- Se não restar ninguém, não deve permanecer uma sala vazia e inutilizável na lista.

### 6.3 Capacidade da sala e limite do jogo

**Regra confirmada:** a capacidade configurada da sala não pode ser maior que o máximo de jogadores suportado pelo jogo selecionado. A comparação é com a **capacidade da sala**, não apenas com a quantidade de pessoas presentes naquele momento.

- O anfitrião pode alterar a capacidade, desde que a nova capacidade não seja menor que o número atual de pessoas na sala e não ultrapasse o máximo do jogo selecionado.
- O anfitrião pode trocar de jogo se o novo jogo suportar, no mínimo, a capacidade atualmente configurada para a sala.
- Quando uma mudança violar uma dessas regras, ela deve ser bloqueada e a interface deve informar o motivo e o limite aplicável. Não expulsar jogadores nem mudar a capacidade silenciosamente para concluir a operação.
- Para escolher um jogo com limite menor, o anfitrião pode primeiro reduzir a capacidade da sala, desde que isso respeite as pessoas já presentes.
- Se um jogo tiver um número mínimo obrigatório de participantes, a partida só pode começar ao atingir esse mínimo. Esse mínimo também deve ser comunicado de forma clara.

Exemplos:

| Situação | Resultado esperado |
| --- | --- |
| Sala configurada para 8, com 4 pessoas; anfitrião tenta selecionar jogo para até 4. | Bloquear: a capacidade configurada, 8, excede o máximo do jogo, 4. |
| Sala com 4 pessoas; anfitrião reduz sua capacidade de 8 para 4 e escolhe jogo para até 4. | Permitir as duas operações. |
| Sala com 5 pessoas; anfitrião tenta reduzir a capacidade para 4. | Bloquear: há 5 pessoas na sala. |
| Sala configurada para 4; anfitrião escolhe jogo para até 8. | Permitir, respeitando eventual mínimo de jogadores do jogo para iniciar. A sala continua com capacidade 4. |

As verificações de capacidade devem ser garantidas pelo servidor, inclusive quando várias pessoas tentarem entrar ao mesmo tempo. Não basta desabilitar um botão no navegador.

### 6.4 Preparação e início

- A sala mostra quem são os participantes e quem está pronto.
- Os participantes sinalizam que estão prontos no Hub. Quando todos estiverem prontos e o jogo tiver a quantidade de jogadores necessária, o grupo é conduzido ao jogo selecionado.
- Os jogadores devem ser encaminhados para a **mesma partida correspondente à sala**, sem precisar procurar outra sala ou digitar novamente um código no fluxo normal.
- Se o jogo tiver sua própria tela de preparação, opções de mapa, modo, equipes ou outras configurações, elas permanecem na **interface do próprio jogo**, depois que o grupo entra nele.
- Um jogo pode pedir que os jogadores confirmem **pronto novamente** na interface dele. Portanto, ficar pronto no Hub pode iniciar a transição para a preparação do jogo; não significa necessariamente que a jogabilidade já começou naquele instante.
- Preservar as opções reais e os modos já existentes. Não é necessário criar novos modos apenas porque outro jogo os possui.

### 6.5 Entrada durante uma partida

- Uma pessoa pode entrar em uma sala em andamento se ainda houver vaga na capacidade da sala.
- Se o jogo permitir entrada na partida em andamento, a pessoa pode ingressar na partida, respeitando as regras e limites reais do jogo.
- Se o jogo não permitir essa entrada, a pessoa permanece na sala do Hub e **espera a próxima partida**.
- Quem espera conta para a capacidade da sala. Por exemplo, se a sala tem capacidade 4 e quatro pessoas já estão nela, uma quinta pessoa não pode entrar nem para esperar.
- A interface deve deixar claro se a pessoa está jogando ou aguardando. Não fingir que uma entrada em andamento foi aceita quando o jogo não a suporta.

### 6.6 Fim da partida e continuidade

- Quando a partida terminar, os jogadores voltam **juntos para a mesma sala do Hub**, onde também estão os participantes que aguardavam.
- Preservar eventuais telas de resultado e opções relevantes que façam parte da experiência de cada jogo; a integração deve fornecer um caminho claro de retorno à sala.
- O anfitrião pode então manter o jogo ou escolher outro jogo compatível com a capacidade configurada. O grupo não precisa recriar a sala nem compartilhar um novo código para continuar.
- Sair de uma partida não deve exigir encerrar o Hub. A situação dos demais jogadores durante a saída deve respeitar as regras reais do jogo e ser informada de forma clara.

## 7. Várias salas e partidas simultâneas

- O Hub deve permitir várias salas e partidas ao mesmo tempo, inclusive salas diferentes usando o mesmo jogo e salas usando jogos diferentes.
- Não estabelecer um teto artificial global de salas. A quantidade prática será limitada pelos recursos do computador, sistema operacional e demais condições reais de execução.
- Partidas distintas devem ser isoladas: participantes, estado da partida, código, eventos e resultados de uma sala não podem se misturar com os de outra.
- Se um jogo atual não suportar múltiplas partidas independentes, sua integração terá de ser adaptada para cumprir esse requisito. Uma limitação que não puder ser resolvida deve ser relatada claramente, não apresentada como integração concluída.

## 8. Integração dos jogos

- Os jogos **não precisam ser reescritos na mesma linguagem ou arquitetura**. Um jogo pode usar TypeScript, outro JavaScript e outro uma tecnologia diferente compatível com o objetivo do produto.
- Pode ser necessário modificar cada jogo ou criar uma camada de integração para conectar a sala do Hub à partida correspondente. A escolha técnica deve ser feita após examinar os projetos.
- A integração deve preservar a jogabilidade, os recursos, os modos, os controles, os recursos visuais próprios e as configurações dos jogos, salvo alterações necessárias e justificadas para que funcionem no Hub.
- O Hub precisa saber o suficiente para criar ou associar a partida correta, encaminhar os jogadores, identificar capacidades e condições de entrada, lidar com o encerramento e trazer o grupo de volta. Como isso será implementado não está definido.
- Um clique que apenas abre a página original do jogo, mantendo o grupo obrigado a criar outra sala manualmente, **não atende ao fluxo principal**.
- A estrutura deve facilitar o registro e a integração de jogos futuros, com informações claras sobre o que precisa ser configurado ou adaptado em cada um. Não é obrigatório que qualquer jogo desconhecido funcione apenas por ser copiado para uma pasta.
- A execução offline, as rotas acessíveis aos navegadores, conexões em tempo real e arquivos necessários devem ser verificados para cada jogo, inclusive quando ele usa servidor próprio.

## 9. Aparência e experiência

O Hub deve ter uma identidade visual **arcade, colorida, neon e extremamente cyberpunk**, com acabamento visual caprichado. Ele deve parecer uma plataforma de jogos, não apenas uma lista crua de links.

- Usar uma direção visual coesa entre catálogo, lista de salas e tela de sala.
- Cores neon, contrastes, formas, tipografia e elementos gráficos devem reforçar o tema sem prejudicar a leitura ou a identificação dos controles.
- Botões, campos, estados de pronto, disponibilidade, mensagens de erro e informações de capacidade devem ser fáceis de entender.
- A interface deve funcionar bem em tamanhos usuais de janela de computador e permitir jogar sem exigir celular ou tela sensível ao toque.
- A identidade visual do Hub não exige redesenhar os jogos integrados; cada jogo pode manter seu próprio visual.
- Recursos necessários para renderizar a interface devem estar disponíveis offline após a preparação do projeto.

## 10. Organização do projeto e Git

- O Game Hub e os códigos dos jogos integrados devem ficar organizados dentro de um projeto geral que possa ser aberto pelo OpenCode como um todo.
- Deve haver um **repositório Git geral** para as alterações futuras do Hub e dos jogos.
- Não é necessário importar ou manter, dentro do novo repositório, o histórico Git antigo dos jogos.
- Se existirem repositórios Git aninhados, a integração deve evitar que os jogos sejam registrados acidentalmente como repositórios incorporados ou submódulos quando a intenção é versionar seus arquivos no repositório geral.
- Preservar os arquivos e o funcionamento dos jogos. Não apagar nem sobrescrever os projetos originais do proprietário sem necessidade ou autorização; cópias destinadas à integração podem ser preparadas para o repositório geral.
- Ignorar arquivos temporários e artefatos que não devam ser versionados, sem excluir códigos ou recursos necessários para reconstruir e executar o projeto.

## 11. Decisões operacionais propostas

As regras abaixo fecham lacunas de comportamento de forma conservadora, mas **não foram confirmadas expressamente** pelo proprietário e podem ser revistas:

1. Ao voltar de uma partida, todos retornam como **não prontos**, inclusive quem estava esperando, para evitar que a próxima partida comece imediatamente sem uma nova decisão do grupo.
2. Alterar o jogo ou a capacidade enquanto a sala aguarda uma partida redefine a prontidão dos participantes, para que todos confirmem a nova configuração.
3. Alterações de jogo e capacidade são feitas enquanto a sala está aguardando, sem interromper uma partida em andamento.
4. Se um jogo exigir mais participantes do que a capacidade configurada, a sala pode existir, mas o Hub informa que a partida não poderá começar até a configuração permitir atingir o mínimo.
5. A sala e a sessão são temporárias; não há requisito de restaurar salas ou partidas após a reinicialização do servidor.

O comportamento de reconexão após perda de rede, a forma exata de escolher o novo anfitrião e os detalhes de validação dos apelidos continuam em aberto. Não afirmar que reconexão preserva uma partida caso isso não tenha sido implementado e validado no jogo correspondente.

## 12. Critérios de aceite e evidências

A implementação só deve ser considerada concluída para um jogo quando os comportamentos relevantes tiverem sido verificados com o jogo real. É necessário distinguir teste executado de comportamento apenas esperado ou limitado pelo ambiente.

1. **Preparação e execução:** iniciar o Hub conforme as instruções, acessar o endereço de outro navegador e informar claramente dependências ausentes ou incompatíveis.
2. **Identificação:** rejeitar o mesmo apelido em sessões diferentes, inclusive quando tentam acessar salas distintas.
3. **Fluxo principal:** criar sala, localizá-la na lista, entrar pelo código e pela lista, ficar pronto, entrar em uma mesma partida real, concluir o jogo e voltar à mesma sala.
4. **Regras de capacidade:** verificar os quatro exemplos da seção 6.3 e tentativas simultâneas de entrar na última vaga.
5. **Jogo em andamento:** testar entrada real quando o jogo a suporta; quando não suporta, verificar a espera na sala e o respeito à capacidade total.
6. **Anfitrião:** verificar transferência automática após sua saída e remoção de sala quando não houver ninguém.
7. **Configurações reais:** verificar que modos, equipes e demais opções existentes continuam acessíveis na interface do jogo e que o eventual segundo pronto funciona.
8. **Isolamento:** executar partidas simultâneas em salas diferentes, incluindo o mesmo jogo em mais de uma sala e jogos distintos, sem mistura de participantes ou estado.
9. **Offline:** após a preparação, verificar o fluxo completo com a rede local disponível e sem acesso à internet. Conferir que o Hub e os jogos não dependem de recursos externos nesse momento.
10. **Linux e NTFS:** testar o projeto em um pendrive ou volume NTFS realmente montado em Linux e verificar, quando os ambientes estiverem disponíveis, openSUSE, Debian e Linux Mint. Registrar exatamente quais combinações foram testadas e suas limitações.
11. **Navegador:** validar a experiência com múltiplos clientes reais de navegador; usar automação quando apropriado, mas não substituir a partida por uma tela ou resposta simulada. Registrar o que foi efetivamente testado em Firefox e/ou Chromium.

Sempre que um ambiente, jogo ou cenário real não estiver disponível, registrar isso como **pendente de validação**, com a razão e o que ainda precisa ser verificado. Não apresentar teste simulado, página carregada ou código compilado como prova de uma partida multiplayer completa.
