# Asfalto Vivo — Especificação do produto (entrega)

> Este é o documento de requisito original da entrega. Todo trabalho deve satisfazê-lo.
> Nome do jogo: **Asfalto Vivo** (identidade visual definida pela UI).

## 1. Visão e escopo do jogo

O jogo é uma corrida arcade competitiva em circuitos fechados, com câmera em terceira pessoa atrás do carro.

Características centrais:

- Visual 3D estilizado em estilo low poly, com identidade visual coerente.
- Duas pistas completas e diferentes entre si.
- Até seis jogadores humanos por sala.
- Nenhum bot, adversário automatizado ou piloto controlado pelo computador.
- Um modelo de carro, com desempenho idêntico para todos e cores personalizáveis.
- Aceleração, frenagem, direção, derrapagem, nitro e colisões.
- Corridas de três voltas por padrão, com configuração de uma a cinco voltas no lobby.
- Modo multiplayer e modo individual contra o relógio.
- Checkpoints, classificação ao vivo, cronometragem e resultados.
- Menus, configurações, ajuda de controles e recordes locais.
- Experiência voltada a computadores com teclado.

A prioridade é qualidade da corrida e conclusão do escopo. Todo elemento apresentado como funcional deve funcionar durante uma partida real.

## 2. Experiência de entrada e navegação

Ao abrir o jogo, quero encontrar uma tela inicial com identidade própria e opções claras:

- Criar sala.
- Entrar em sala.
- Contra o relógio.
- Configurações.
- Como jogar.

O jogador escolhe um apelido e uma cor. Essa escolha deve ser simples e não exigir cadastro, e-mail, login externo ou conta em outra plataforma.

A aplicação deve indicar carregamento, conexão em andamento, sucesso e falhas com mensagens compreensíveis. Entrar numa sala inexistente, cheia ou indisponível precisa produzir uma resposta clara e permitir tentar novamente.

Apelidos longos não podem quebrar a interface. Os participantes devem ser distinguíveis pelo nome e pela cor. Se houver apelidos iguais, a interface deve diferenciá-los de forma clara.

Voltar de uma tela, sair de uma sala ou trocar de modo não pode deixar controles, sons ou sessões anteriores funcionando indevidamente.

## 3. Salas multiplayer e lobby

Uma pessoa cria a sala e se torna sua organizadora. A sala recebe um código e um link de convite que possam ser copiados.

Outras pessoas podem entrar pelo código ou link, sem procedimentos complicados.

O lobby deve mostrar:

- Código da sala e opção de copiar o convite.
- Lista dos participantes e suas cores.
- Quem é o organizador.
- Estado de prontidão de cada participante.
- Pista escolhida.
- Número de voltas.
- Número de vagas ocupadas e disponíveis.
- Situação da sala: aguardando jogadores, preparando largada ou corrida em andamento.

Cada participante pode escolher uma cor disponível. Mudanças de cor e prontidão devem aparecer para os demais.

O organizador escolhe a pista e a quantidade de voltas. Uma mudança nessas configurações precisa ser visível para todos e exigir nova confirmação de prontidão dos participantes.

Para iniciar uma corrida multiplayer, devem existir pelo menos dois jogadores conectados e todos os participantes da largada devem estar prontos.

O organizador aciona o início da corrida. A transição do lobby para o grid deve ocorrer de forma coordenada.

A lista de pilotos da corrida fica definida no início da preparação da largada. Quem entrar depois aguarda a próxima partida, sem surgir no meio da pista.

A sala comporta até seis participantes. A ocupação de vagas deve continuar correta durante entradas simultâneas, saídas e reconexões.

## 4. Independência entre abas e continuidade da sala

Abrir o jogo em várias abas no mesmo navegador deve permitir vários pilotos distintos na mesma sala.

- Uma aba não pode assumir a identidade de outra.
- Entrar numa nova aba não pode expulsar o piloto de uma aba já aberta.
- Sair de uma sala numa aba não deve desconectar as demais.
- Recarregar uma aba deve tentar recuperar aquele participante durante o período de reconexão, sem duplicar seu carro.
- Uma nova aba deve poder escolher outro apelido e outra cor.

Quando o organizador sair, outro participante conectado deve assumir a organização. Isso não pode reiniciar ou interromper uma corrida em andamento.

Se a sala ficar vazia, ela deve ser encerrada sem prejudicar outras salas.

Salas diferentes precisam ser independent: escolhas, jogadores, largadas, carros e resultados de uma sala não podem aparecer em outra.

O código compartilhado deve identificar a mesma sala para todos que estiverem acessando a mesma instância do jogo. Salas não podem ser apenas uma simulação visual restrita a cada navegador.

## 5. Condução e controles

A direção deve ser arcade, responsiva e suficientemente consistente para que o jogador aprenda a dirigir melhor.

Controles padrão:

- W ou seta para cima: acelerar.
- S ou seta para baixo: frear; em velocidade muito baixa, permitir marcha à ré.
- A/D ou setas esquerda/direita: esterçar.
- Espaço: freio de mão.
- Shift: nitro.
- R: recuperar o carro para um ponto seguro da pista.
- Esc: abrir ou fechar o menu durante a partida.

O jogo deve explicar esses comandos antes da primeira corrida e permitir consultá-los depois.

Comportamentos esperados:

- A velocidade aumenta e diminui gradualmente.
- Soltar o acelerador produz desaceleração coerente.
- Frenagem, marcha à ré e retomada para frente não podem causar mudanças instantâneas absurdas de velocidade.
- A capacidade de fazer curvas deve variar de maneira compreensível com a velocidade.
- O freio de mão permite iniciar uma derrapagem que possa ser controlada e encerrada.
- O carro deve recuperar aderência de maneira previsível.
- Sair do asfalto para grama, areia ou acostamento deve tornar o veículo mais lento.
- O carro precisa poder sair de uma situação comum de encalhe por direção ou marcha à ré.
- O movimento deve permanecer consistente em diferentes taxas de quadros.
- Entrar numa curva muito rápido deve ser diferente de frear e escolher uma trajetória melhor. Ainda assim, o jogo deve ser acessível, sem exigir conhecimentos de simulação automobilística.
- Os controles da direção não devem capturar teclas enquanto o jogador estiver escrevendo seu apelido ou usando campos de texto.

## 6. Nitro

O nitro é um recurso limitado de aceleração temporária.

- Deve existir um indicador claro de carga.
- Usá-lo consome carga.
- A carga se recupera gradualmente enquanto não estiver sendo usada, em ritmo inferior ao consumo.
- Sem carga, o efeito deve parar.
- O uso deve produzir diferença perceptível de desempenho, som e apresentação visual.
- Deve existir um limite coerente para a velocidade alcançada.
- Todos os jogadores obedecem às mesmas regras.
- A carga não pode ser recuperada indevidamente ao abrir menus, trocar de aba, reconectar ou recuperar o carro.

Não é necessário adicionar itens de pista ou outros poderes.

## 7. Colisões, recuperação e integridade do movimento

O carro deve interagir com barreiras, limites relevantes da pista e outros carros.

As colisões devem afetar o movimento de maneira compreensível. Contatos comuns não podem lançar os carros para fora do cenário, fazê-los atravessar barreiras, prender dois veículos permanentemente ou produzir velocidades absurdas.

Os participantes devem observar consequências compatíveis para o mesmo contato. Diferenças de visualização não podem resultar em classificações ou progressos contraditórios.

Objetos decorativos que pareçam barreiras importantes precisam ter comportamento coerente. Elementos próximos à pista devem permitir entender visualmente por onde é possível dirigir.

A recuperação pelo botão R deve:

- Recolocar o veículo num ponto seguro já alcançado e validado.
- Apontá-lo na direção correta.
- Impedir ganho gratuito de progresso, voltas ou tempo.
- Evitar que o carro reapareça em situação inevitável de colisão.
- Ter proteção contra acionamento repetido abusivo.
- Ser contabilizada de forma consistente na corrida.

Se o jogador sair completamente do espaço jogável ou cair do cenário, deve existir recuperação compreensível. A partida não pode ficar permanentemente perdida por causa disso.

## 8. As duas pistas

Dois circuitos completos, com geometria, decoção e condução distintas.

### Circuito costeiro

Pista diurna, próxima ao mar, aberta e luminosa. Trechos largos, curvas abertas rápidas, pelo menos uma curva fechada que exija frenagem, uma reta útil para nitro e ultrapassagens, áreas de escape/acostamento reconhecíveis, decoração costeira coerente.

### Distrito industrial

Ambientada numa região industrial, condução mais técnica: curvas mais fechadas, chicanes, trechos mais estreitos, retas mais curtas, referências visuais claras para antecipar curvas, decoração industrial coerente.

As pistas devem ser circuitos fechados reais, não a mesma pista com outra cor.

Em ambas: trajeto legível, sentido perceptível, linha de chegada e grid identificados, sinalização em curvas importantes, largura suficiente para disputar, decoração que não esconda obstáculos ou saídas de curva, acabamento no percurso inteiro, sem áreas inacessíveis, buracos ou limites invisíveis incompreensíveis.

Não é obrigatório adicionar rampas, saltos ou terrenos complexos.

## 9. Carro, câmera e apresentação visual

Todos usam o mesmo modelo de carro e as mesmas características de desempenho. A personalização é visual, por cor.

Rodas acompanhando visualmente o deslocamento, esterçando quando pertinente. Cores reconhecíveis. Apelidos identificáveis sobre os carros adversários, sem excesso de poluição. Marcas de derrapagem e partículas discretas de fumaça/poeira. Efeito visual de nitro. Feedback perceptível para colisões. Iluminação, sombras e paleta coerentes.

A câmera fica atrás do carro, com acompanhamento suave e boa visibilidade da pista à frente. Deve lidar bem com curvas, marcha à ré, recuperação e colisões. Não pode atravessar o chão, esconder o veículo ou oscilar a ponto de atrapalhar. Efeitos de velocidade e pequenas reações de câmera são bem-vindos; efeitos intensos podem ser reduzidos.

A interface e o cenário devem formar um jogo com identidade visual própria.

## 10. Largada e andamento da corrida

Grid com posições distintas, sem sobreposição. Durante a preparação: todos veem a pista correta e os mesmos participantes; indicação de carregamento/prontidão quando necessária; contagem regressiva compartilhada; nenhum progresso antes da largada; liberação dos controles corresponde ao mesmo início para todos.

Se participantes caírem abaixo de dois antes da largada, preparação cancelada e volta ao lobby com explicação.

Sensação contínua de movimento; carros remotos suavemente interpolados; próprio carro responsivo; participantes concordam sobre pista, voltas, progresso válido, tempos e resultado mesmo com taxas de quadros diferentes.

## 11. Checkpoints, voltas, posição e cronometragem

Progresso exige percorrer o circuito no sentido e sequência corretos:

- Volta só conclui depois dos checkpoints necessários e passagem válida pela chegada.
- Cruzar a chegada repetidamente, dar marcha à ré ou circular sobre a linha não gera voltas extras.
- Cortar grandes partes do circuito não conclui a volta.
- Recuperar o carro não pula checkpoints nem avança progresso.
- Contramão produz aviso claro.
- Marcha atrás não cria progresso fictício.

Posição representa avanço válido (voltas + etapas + avanço na etapa atual). Cronometragem: começa na largada; tempo total, volta atual, voltas concluídas; melhor volta; precisão apropriada; mesmos resultados oficiais para todos; não depende de relógio local ou velocidade de renderização.

## 12. Conclusão, classificação e revanche

Ao completar o número de voltas, termina uma única vez e recebe colocação e tempo. Quem terminou vê o resultado e continua acompanhando a classificação sem interferir.

Após o primeiro jogador concluir, prazo compartilhado de 45 segundos para os demais; a corrida encerra antes se todos concluírem/abandonarem.

Ao encerrar: colocação, apelido e cor, tempo total dos que concluíram, melhor volta disponível, indicação clara de quem não concluiu ou abandonou. Concluíram antes dos não concluídos; entre não concluídos, progresso válido define ordem; empates com tratamento consistente.

Tela de resultados oferece retorno ao lobby e saída da sala. Ao voltar ao lobby: prontidão reiniciada, próxima corrida com estados limpos (voltas, tempos, posições, nitro e conclusão não vazam).

## 13. Conexão, reconexão, menus e troca de foco

A partida continua com perda de foco, menu, troca de aba ou desconexão:

- Perder foco libera comandos pressionados; carro não acelera indefinidamente.
- Ausência de comandos → desaceleração coerente (sem virar bot).
- Menu no multiplayer não pausa os outros.
- Voltar à aba mostra estado atual, sem acelerar a corrida para compensar tempo perdido.
- Participante percebe quando está desconectado/tentando reconectar.
- Conexão definitivamente perdida oferece saída ou nova tentativa compreensível.
- Desconexão temporária reserva o retorno do mesmo piloto por até 30 segundos, com identidade e progresso atuais, sem duplicar carro, reiniciar contagem ou dar vantagem.
- Após o prazo: marcado como abandono, deixa de bloquear a conclusão.
- No lobby, estado de ausentes claro. Durante corrida, saída do organizador não encerra a partida.
- Sem mensagens falsas de sucesso de reconexão.

## 14. Modo individual contra o relógio e recordes

Funciona sem outras pessoas, sem bots, sem criar sala. Escolhe uma das duas pistas, mesma condução do multiplayer. Começar tentativa; ver tempo da volta atual; ver tempos das voltas concluídas; consultar melhor volta válida naquela pista; reiniciar a tentativa; trocar de pista ou voltar ao menu.

Volta com recuperação ou percurso inválido não estabelece recorde; interface indica a invalidação. Recordes separados por pista, persistem entre sessões no mesmo navegador. Identidade de cada aba no multiplayer independente, ainda que preferências/recordes sejam compartilhados entre abas. Sem ranking global, contas, replays ou fantasma.

## 15. Interface durante a corrida

Durante a partida, mostrar: velocidade; posição atual e total; volta atual e total; tempo da corrida; tempo da volta atual; melhor volta; carga de nitro; minimapa com percurso e posições; avisos (contramão, desconexão, volta inválida, contagem para o encerramento).

Carro do jogador fácil de reconhecer no minimapa; adversários com identificação consistente com suas cores. Classificação ao vivo sem ocupar a maior parte da tela. HUD legível em resoluções comuns de desktop e após redimensionar; não cobrir a região principal da pista.

## 16. Áudio, configurações e acessibilidade básica

Áudio: motor variando com o movimento; nitro; derrapagem e colisões; contagem regressiva e largada; conclusão de volta e fim de corrida; interações importantes dos menus. Sons não podem continuar duplicados ou presos após sair/reiniciar/trocar de tela.

Controle de volume e silenciar. Aba em segundo plano: tratamento adequado para evitar corridas sobrepostas.

Configurações: volume; qualidade visual (opções simples); intensidade de efeitos/tremor de câmera; sensibilidade de direção ou equivalente. Preferências persistem entre sessões.

Telas com contraste, textos legíveis e botões identificáveis. Cor não é a única forma de identificar prontidão, conexão ou posição. Idioma principal: português do Brasil.

## 17. Desempenho, estabilidade e integridade

Jogo utilizável com seis jogadores na mesma sala. Direção consistente com variação de taxa de quadros; sem travamentos progressivos após várias corridas; sem carros duplicados após reconectar/voltar ao lobby; sem sons/contagens/entradas de teclado duplicados; recursos carregando corretamente; redimensionamento sem quebrar; repetição de partidas nas duas pistas sem reiniciar o projeto; duas salas simultâneas sem mistura.

Falhas de conexão/carregamento informadas com recuperação quando viável; tela nunca fica parada sem explicação.

Navegadores atuais de desktop. Informar navegadores efetivamente verificados e limitações. Não apresentar desempenho/compatibilidade como comprovados sem verificar.

## 18. Execução e acesso por amigos

Preparar e iniciar a partir de cópia limpa com instruções claras. Múltiplas abas no mesmo computador na mesma sala. Outros computadores na mesma rede local podem acessar (quando o ambiente permitir). Links de convite correspondem a endereço utilizável pelo destinatário. Endereços locais não apresentados como acessíveis automaticamente pela internet. Instruções para disponibilizar a mesma instância a fora da rede local, com condições claras; sem contratar serviço externo.

Sem cadastro/pagamento por jogador; execução local sem serviço comercial obrigatório, assinatura ou chave paga. Todos os recursos necessários vêm com o projeto ou com preparação documentada; nada de dependências temporárias de imagens/áudios que desapareçam.

## 19. Entregáveis

- O jogo com os dois circuitos e os dois modos.
- Multiplayer real para até seis jogadores humanos.
- Menus, lobby, corrida, resultados e revanche.
- Recursos visuais e sonoros utilizados.
- Instruções exatas de preparação e execução.
- Explicação de como testar com várias abas e computadores diferentes.
- Instruções de acesso por rede local e de disponibilização pela internet.
- Lista de controles.
- Orientação para preferências e recordes locais.
- Créditos e licenças dos recursos utilizados.
- Relação honesta de limitações existentes e comportamentos efetivamente verificados.

Não é necessário produzir pitch, slides, PDF ou material comercial. O entregável central é o jogo.

## 20. Cenários de aceitação

1. Abro o jogo, escolho apelido e cor e crio uma sala.
2. Abro uma segunda aba, entro com outro piloto e vejo os dois no mesmo lobby, sem substituição de identidade.
3. As mudanças de pista, voltas, prontidão e participantes aparecem de forma consistente para todos.
4. Com os pilotos prontos, a mesma corrida começa para todos, com grid e contagem regressiva corretos.
5. Os jogadores dirigem, usam nitro, derrapam, colidem e observam o movimento uns dos outros.
6. A classificação e a contagem de voltas refletem o progresso válido.
7. Tentar cortar o circuito, cruzar a chegada de ré ou usar recuperação não concede vantagem indevida.
8. Alterno entre abas e a corrida continua; nenhum acelerador fica preso e a aba retomada mostra o estado atual.
9. Uma desconexão breve permite retomar o mesmo piloto dentro do prazo, sem duplicação.
10. A saída do organizador não encerra a corrida dos demais.
11. Um novo participante que entra durante a corrida aguarda a próxima.
12. A corrida termina, os participantes veem resultados consistentes e podem disputar uma revanche na mesma sala.
13. A revanche e a troca de pista não herdam estados incorretos da corrida anterior.
14. Uma sala cheia ou inexistente produz mensagens apropriadas.
15. Seis participantes conseguem disputar a mesma corrida.
16. Duas salas podem funcionar ao mesmo tempo sem interferência.
17. No modo contra o relógio, consigo treinar nas duas pistas e salvar apenas recordes válidos.
18. Após fechar e abrir o jogo, minhas configurações e recordes locais continuam disponíveis.
19. Uma pessoa em outro computador consegue entrar na mesma instância e jogar, seguindo as instruções e com a conexão de rede disponível.
20. A apresentação visual, os controles e as telas de transição estão completos e coerentes.
