# PrettierRPG — Produto da primeira versão

**Estado:** especificação consolidada da primeira versão. Os anexos de pesquisa incorporados são parciais; onde faltarem números, implementar aproximações documentadas e testáveis.  
**Data:** 05/11/2026.  
**Objetivo:** entregar um jogo de combate em navegador, 2D com visão isométrica, inspirado o mais fielmente possível no combate de Albion Online, jogável em rede local e sem internet após o preparo.

## 1. Escopo e princípios

A primeira versão oferece uma arena medieval de pedra, grandes possibilidades de builds, multiplayer todos contra todos, 2 contra 2 e treino individual PvE. Os jogadores entram, montam suas builds, combatem e voltam ao lobby. O jogo deve ter identidade própria e interface em português do Brasil. Personagens 2D simples devem mostrar armas e equipamentos de modo reconhecível. Efeitos de combate, leitura visual, controles e ritmo devem se aproximar de Albion, preservando as regras específicas aqui definidas.

Fora do escopo: mundo aberto, missões, coleta, progressão, experiência, desbloqueio, economia, inventário com saque, crafting, montarias, comidas, poções, contas e integração funcional com Game Hub. A arquitetura deve permitir integração futura sem exigir o Hub para funcionar. Não implementar sistemas futuros como requisito oculto.

## 2. Rede e execução

- Um computador Linux executa o servidor; demais computadores na mesma rede acessam por IP e porta no Firefox ou Chromium. O computador servidor também pode jogar.
- Após preparação, todos os arquivos necessários são servidos localmente; nenhuma fonte, biblioteca, imagem, áudio, serviço ou conexão externa é necessária para jogar.
- Scripts claros para preparar, iniciar e parar. Documentar dependências, porta configurável, endereço local, preparação online, uso offline e erros de porta ocupada. Encerrar apenas processos do próprio jogo.
- Várias salas e treinos independentes simultâneos, limitados pelos recursos da máquina, sem vazamento de estado entre sessões. O servidor autoriza e processa movimento, combate, vida, recargas, regras e placar; clientes enviam intenções.
- Meta: 60 FPS em computadores Linux modestos, inclusive durante combate com 12 jogadores. 2D em navegador não garante 60 FPS: medir em hardware real, registrar configuração, resolução, número de jogadores e resultados; não declarar essa meta cumprida sem medição.

## 3. Equipamentos e builds

Todos os equipamentos têm tier 8, qualidade Normal, sem encantamento e sem bônus de especialização ou progressão. Todas as opções de habilidades e passivas aplicáveis estão desbloqueadas. O jogador escolhe uma opção por espaço de habilidade e passiva conforme as regras reais de cada item. Não inventar espaços que o item não possua.

| Categoria | Conteúdo obrigatório |
| --- | --- |
| Armas de uma mão | Machado de Batalha (Battleaxe), Adaga (Dagger), cajado de fogo básico, cajado de gelo básico, cajado de clérigo básico |
| Mão secundária | Escudo, tomo e tocha; qualquer uma das cinco armas pode combinar com qualquer um dos três |
| Cabeça | Capuzes dos conjuntos mercenário, soldado e erudito |
| Corpo | Armaduras dos conjuntos mercenário, soldado e erudito |
| Pés | Botas dos conjuntos mercenário, soldado e erudito |
| Costas | Seis capas: Bridgewatch, Fort Sterling, Lymhurst, Martlock, Thetford e Caerleon |

Peças dos três conjuntos podem ser combinadas livremente. São obrigatórios atributos, habilidades ativas, passivas, efeitos das capas, custos, duração, recarga, alcance, fórmulas e interações dos itens selecionados. A build apresenta ícones próprios, atributos, opções, descrição, dano, cura, custo, alcance e recarga quando aplicáveis. Exibir informações completas da build dos demais no lobby. Jogadores da mesma equipe podem usar builds idênticas. Guardar a última build neste navegador, sem conta; validar e recuperar sem quebrar o jogo caso dados locais sejam inválidos.

### Referência de combate e dados

Personagem sem equipamentos: **1.200 de vida máxima e 120 de energia máxima**. Itens comuns T8.0 Normal usam IP de referência 1.100, sem especialização. As fichas de pesquisa incorporadas ao fim deste documento registram opções, atributos, efeitos, fontes e limites das evidências. Elas são referências fornecidas ao projeto, não comprovam teste no cliente oficial.

**Ordem de precedência:** (1) decisões explícitas deste produto, inclusive exceções e pressupostos a seguir; (2) correções e valores aplicáveis do terceiro levantamento; (3) segundo levantamento para campos não corrigidos; (4) captura histórica de 2025 somente como pista, nunca como dado atual automaticamente. Em caso de fontes sem comprovação ou ausência de parâmetro, definir um valor inicial coerente, implementar o comportamento completo, marcar a aproximação e a origem num catálogo e ajustar com testes. Não colocar X, NaN, placeholders ou botões sem efeito; não afirmar paridade exata comprovada.

A referência é o snapshot da pesquisa informada como Dragonfire Patch 4 em novembro de 2026, sem exigir sincronização automática com patches futuros. Reproduzir todas as opções de habilidades e passivas indicadas nas fichas integradas; usar valores de T8 Normal, não os antigos Good. A intenção é proximidade máxima nas habilidades: aproximação de campo incerto não autoriza remover efeitos conhecidos. Registrar nome, origem, unidade, versão e confiança de cada parâmetro no catálogo do projeto.

Usar sons, sprites e ícones próprios ou recursos com licença adequada; não incluir recursos visuais ou sonoros copiados do Albion. Inspiração visual e mecânica não equivale a licença para copiar ativos.

## 4. Combate e controles

- Clique no chão para movimentar, em linha reta. Ao encontrar obstáculo, parar; não calcular rota automática. Colisão com paredes e obstáculos também bloqueia ataques conforme trajetória e características específicas da habilidade.
- Ataque básico, teclas padrão dos espaços, conjuração, energia, recargas, interrupções, controles de grupo, alcance e comportamento ao selecionar um alvo fora do alcance seguem Albion, na medida em que forem verificáveis. Decisões específicas deste documento prevalecem.
- Habilidades direcionais ou de área: pressionar tecla, mostrar indicador equivalente ao do Albion e confirmar com clique. Para cada habilidade, respeitar seu tipo real de alvo: direção, área, pessoa ou si mesmo. Não executar ação inválida; informar motivo de falta de energia, recarga ou alvo inválido.
- Câmera acompanha o personagem. Zoom com roda do mouse, em limites que não prejudiquem a leitura.
- Cada jogador vê vida, energia e efeitos ativos de todos, indicadores de dano de todos, seu próprio conjunto de habilidades e respectivas recargas, placar e tempo. Cura numérica é visível à equipe de quem recebeu, não aos inimigos; no FFA apenas o próprio jogador vê sua cura. Barras e contornos distinguem aliados e inimigos.
- No 2v2, dano e efeitos negativos não atingem aliados; curas e efeitos benéficos seguem o alvo permitido. No FFA, a cura beneficia somente o próprio usuário; Holy Beam mantém restrição de não mirar em si mesmo, logo não possui alvo válido no FFA e informa isso, sem gastar energia ou recarga. Atribuir eliminações pelo último golpe de jogador, com a exceção da wave abaixo.
- Dano, cura, buffs/debuffs, resistência, controles, efeitos de área, projéteis, colisões, estados e combinações de habilidades devem funcionar entre clientes de forma consistente, com feedback claro. Sons próprios para habilidades, combate e interface; sem música obrigatória.

## 5. Arena

Uma arena grande de pedra medieval para os três modos, com espaço para perseguir e se reposicionar e obstáculos reais. Todos os pontos de aparecimento precisam ser acessíveis; obstáculos não podem prender jogadores nem impedir arbitrariamente o funcionamento das habilidades. Em FFA, escolher entre pontos de renascimento um ponto seguro, priorizando distância dos adversários; se todos estiverem ameaçados, escolher o mais seguro disponível.

## 6. Sala e lobby

Jogador escolhe apelido, sem conta. Apelidos são únicos dentro de cada sala; recusar duplicata com mensagem clara. Criar sala ou entrar via código. Não há entrada de novos jogadores durante partidas; ao terminar, podem entrar no lobby novamente. Cada lobby mostra jogadores, pronto, equipes quando houver e builds completas. Código deve ser único entre salas ativas.

O jogador marca pronto; alterar build ou equipe remove seu pronto. Alterar o modo retira o pronto de todos. O criador pode mudar modo somente se o número de presentes e as restrições do novo modo permitirem; nunca expulsar ou mover pessoas silenciosamente. Cada jogador escolhe a equipe e não pode entrar em equipe de dois jogadores já completa.

Início automático e imediato quando todos estiverem prontos e os requisitos do modo forem atendidos. Para esperar amigos no FFA, deixar pelo menos uma pessoa sem pronto até todos chegarem. FFA: 2–12 jogadores. 2v2: exatamente dois prontos em cada equipe. Depois do resultado, os presentes retornam ao mesmo lobby com builds mantidas e todos desmarcados. Sala sem jogadores é encerrada e seu código liberado. Se o criador sair, outro presente é escolhido automaticamente; se não houver ninguém, encerrar.

## 7. Todos contra todos

- Duração de 5 minutos; vence quem tiver mais eliminações no fim, com vitória compartilhada para empatados.
- Morte por jogador é imediata. Renascer após 5 segundos com vida e energia restauradas, em ponto seguro. Proteção por 3 segundos, interrompida se o protegido atacar ou usar ação ofensiva.
- Se ficar apenas um participante sem possibilidade de retorno, encerrar e aplicar o placar atual; prazo de reconexão ativo preserva a participação até expirar. Saída voluntária remove imediatamente da partida.
- Resultado apresenta vencedor(es), placar, eliminações, mortes, dano causado, dano recebido e cura realizada por jogador. Danos, curas e mortes devem ser contabilizados uma única vez.

## 8. Duas equipes de dois

Melhor de três: primeira equipe a vencer duas rodadas ganha. Uma rodada termina quando todos os membros de uma equipe forem eliminados. Sem renascimento na rodada; eliminados assistem até a próxima. Se ambos os últimos jogadores morrerem simultaneamente, rodada empatada e repetida sem ponto. Intervalo de 10 segundos; recomeçar com vida e energia completas, recargas zeradas e efeitos anteriores removidos.

Após 2 minutos de rodada a wave começa a fechar; leva mais 2 minutos até fechar por completo. Fora da área segura, dano contínuo crescente, com indicador claro. A wave mata imediatamente ao reduzir vida a zero, sem estado caído. Se um inimigo causou dano à vítima nos últimos 30 segundos, o último desses inimigos recebe a eliminação; caso contrário, ninguém recebe. A redução a zero da área e o dano precisam encerrar a rodada, sem área segura remanescente. O valor e progressão do dano devem ser ajustados em testes, de forma documentada.

Caso uma equipe fique sem jogadores conectados ou com direito a retorno, a equipe adversária vence a partida. Se um jogador não voltar dentro de 30 segundos, os colegas continuam sem ele; respeitar a condição anterior.

## 9. Treino PvE individual

Treino sem tempo limite, na mesma arena. Um monstro simples com vida e dano próximos aos de um jogador persegue e ataca o jogador de perto; não ataca o boneco. Quando derrotado, reaparece em 30 segundos. O jogador reaparece em 3 segundos ao ser derrotado, sem estado caído. Pode encerrar e voltar ao lobby quando quiser.

Um boneco aliado imóvel e que não ataca serve para testar cura e efeitos. Começa com 25% da vida; após chegar a 100%, espera 5 segundos e volta instantaneamente a 25%. Permanece disponível enquanto o monstro não reaparece.

Exibir dano total no monstro atual, DPS dos últimos 5 segundos (dano nessa janela dividido por 5), cura total e detalhes dos efeitos ativos no monstro. Dano e DPS zeram ao reaparecer o monstro; permitir zerá-los manualmente. Cura usa contador separado, zerado manualmente, e não é zerada pelo reaparecimento do monstro.

Editor de build abre a qualquer momento. O monstro interrompe o ataque e para enquanto estiver aberto, retomando quando fechar. Efeitos, recargas e temporizadores continuam. Se efeito ativo derrotar o jogador, fechar o editor e aplicar o reaparecimento de 3 segundos. Ao confirmar, aplicar build imediatamente preservando percentual atual de vida e energia e a recarga restante de cada espaço, inclusive ao trocar habilidade. Registrar a build válida como última usada.

## 10. Estado caído e finalização

Quando o golpe final for de monstro, ambiente ou autolesão, o personagem cai por 15 segundos e então leva 5 segundos para levantar, voltando vivo com 100% de vida. A wave do 2v2 é exceção: mata imediatamente. PvE de treino é outra exceção: reaparecimento direto após 3 segundos. Em outros casos de golpe final de jogador, morte imediata e crédito ao atacante.

Durante estado caído ou animação de levantar, ataques e habilidades não podem causar dano; aliados não curam nem aceleram a recuperação, exceto Reawaken. Reawaken pode atingir aliado caído e levantá-lo restaurando 30% da vida máxima; interrompe a recuperação e uma finalização em curso se concluída primeiro. Não ressuscita morto, não afeta inimigos nem a wave. Em FFA não existe aliado elegível. Em PvE o jogador reaparece em 3 s e o boneco não cai, portanto não há alvo válido. Um inimigo pode iniciar finalização durante os 15 segundos caído: canalização de 5 segundos, mata ao concluir e atribui eliminação ao finalizador. Dano recebido pelo finalizador, movimento, uso de habilidade ou ataque interrompem. Não pode iniciar durante os 5 segundos de levantar, mas uma finalização já iniciada pode prosseguir nessa fase. A vítima continua incapaz de agir até recuperar-se ou ser finalizada. Se o finalizador for eliminado ou desconectar, cancelar a finalização.

Na v1 não há monstros em PvP e a arena normal não precisa ter perigos ambientais; esta regra deve existir para comportamentos aplicáveis, exceções descritas e futura expansão, sem criar monstros extras no modo PvP.

## 11. Saída e reconexão

No lobby, desconectar remove imediatamente; voltar exige código e vaga. Durante partida, desconexão involuntária reserva identidade e vaga por até 30 segundos; personagem fica parado e vulnerável. Mesmo que morra, é possível voltar dentro do prazo seguindo as regras do modo. Recarregar ou perda momentânea da conexão devem recuperar o mesmo participante, sem aceitar que outra pessoa tome sua vaga apenas sabendo o apelido. Ao término da partida durante ausência, retornar ao lobby exige código e vaga. Saída voluntária remove imediatamente e não permite voltar àquela partida. Não admitir novos jogadores no meio do jogo.

## 12. Qualidade e critérios de aceite

- Jogos abrem offline em Firefox e Chromium Linux, com instruções reproduzíveis. Nenhum erro de execução ou recurso externo obrigatório. Medir FPS na máquina alvo.
- Todos os itens, habilidades, passivas e efeitos são implementados e comparados com o catálogo incorporado; documentar fonte, data, números, aproximações, diferenças e resultados. Nenhum placeholder, habilidade falsa ou escolha de UI sem efeito pode ser apresentado como concluído.
- Exercitar cada opção de habilidade, cada equipamento e as combinações relevantes, incluindo alvos, alcance, custos, cooldowns, dano, cura, interrupções, efeitos simultâneos, obstáculos e persistência da última build.
- Testes automatizados de regras, simulação, validação no servidor, serialização, salas isoladas, estados, estatísticas e temporizadores; testes de integração para cliente/servidor e reconexão. Verificar em condições de atraso, perda e mensagens inválidas quando possível.
- E2E real em navegadores isolados, com múltiplos clientes: criar e entrar por código; equipe e pronto; início automático; combate e efeitos observáveis em todos os clientes; morte, respawn, wave, placares, empate, resultado e retorno; treino, boneco, edição de build; saídas e reconexões; duas salas simultâneas. Testar 2v2 com quatro clientes e FFA com 12 clientes, além dos limites mínimos. Perfis isolados, sem usar ou alterar o Firefox pessoal.
- Partidas reais de ponta a ponta com evidências de interatividade, movimento, dano, cura, recarga e finalização; testes automatizados isolados não substituem essa verificação. Thomas e amigos fazem a validação humana final; não afirmar que ocorreu sem terem jogado.
- Documentar comandos, ambiente, contagem de testes, resultados, limitações, referências e diferenças; corrigir falhas e repetir testes relevantes. Testes não provam diversão ou equilíbrio por si só.

## 13. Pressupostos operacionais ajustáveis

A geometria da arena, cores, valores da wave, dimensões, distância de spawn, intervalos de rede e números do monstro são definidos durante implementação e ajustados por testes. Na ausência de fontes conclusivas, usar pressupostos documentados e consistentes para completar a implementação; não apresentar aproximações como fatos confirmados sobre Albion. Qualquer mudança que altere as regras acordadas exige registro claro.


## 14. Regras adicionais para execução sem ambiguidades

As seguintes escolhas são pressupostos de implementação, ajustáveis após partidas de teste. Elas preenchem detalhes que não foram decididos explicitamente.

- **Estado inicial:** ao iniciar partida ou rodada, vida/energia cheias, habilidades disponíveis e efeitos limpos. No FFA, cada renascimento restaura vida/energia e limpa efeitos e recargas; a proteção termina ao causar dano ou usar habilidade ofensiva, inclusive se errar. Retorno após desconexão não concede proteção extra.
- **Seleção e alvo:** ataque básico em inimigo selecionado continua enquanto houver alvo válido; fora de alcance aproxima em linha reta até alcance, parando em obstáculo. Um novo comando de movimento cancela perseguição; seleção inválida não causa movimento infinito. Sem alvo válido, habilidade não consome recursos. Habilidades direcionais/área exigem confirmação; Escape cancela mira. Permitir autoalvo quando a ficha da habilidade o admite; só aliados elegíveis recebem benefícios. Usuário no FFA é aliado de si mesmo para benefícios próprios, nunca de outro jogador.
- **Arena e wave:** arena aproximadamente 100 × 100 unidades de mundo, ajustável; círculo seguro centrado fecha linearmente de raio 50 para 0 entre 2:00 e 4:00. Fora dele, dano verdadeiro por segundo de 5% da vida máxima no primeiro segundo, aumentando 2 pontos percentuais a cada segundo consecutivo fora, sem limite; voltar à área zera o contador. O dano ignora escudos e imunidades para garantir fim. A distância é medida no mundo 2D, não na projeção de tela.
- **Equipamentos:** todos os espaços são preenchidos antes do pronto. O jogador recebe build padrão válida na primeira visita; validação do servidor rejeita combinações e slots inexistentes. O slot passivo adicional da Soldier Armor é selecionável. Courier permanece selecionável sem efeito prático nesta versão sem peso; o tooltip informa isso. Threat e efeitos específicos contra monstros funcionam no treino e não criam efeitos fictícios contra jogadores.
- **Recursos:** aproximar regeneração natural como 1% da vida máxima por segundo e 1% da energia máxima por segundo fora de combate; em combate, 0,1% da vida e 0,5% da energia por segundo antes de bônus de equipamentos. Combate dura 10 segundos após causar ou sofrer dano. Esses valores são hipóteses do projeto, não medições do Albion. Sem Healing Sickness nesta versão; registrar como divergência.
  - Remissão regen (BARRAGEM §4 prevalece sobre hipótese §14 0,1%): HP natural ZERO em combate, EN 0,5% em combate; ver CATALOGO §3-33, `lib/sim.js` tick regen e `tests/sim-regen*.test.js`. Sem reescrever §14.
- **Recargas e estados:** uma habilidade que tenha custo suficiente e alvo válido inicia recarga após lançamento aceito; canalizações interrompidas iniciam recarga, salvo exceção documentada da habilidade. Dano periódico e projéteis já criados persistem após morte de quem os criou; crédito preservado. Dano e cura acumulam apenas valores efetivos, sem excesso sobre vida máxima; dano absorvido por escudo é contabilizado separadamente e não como perda de vida. Qualquer regra por habilidade documentada tem precedência sobre este padrão.
- **Sair e fim:** o jogador pode sair voluntariamente após confirmação na interface; permanece no placar com seus números e não conta como vencedor se saiu. Se ninguém permanecer conectado nem tiver vaga reservada, encerrar a partida; se as duas equipes abandonarem simultaneamente, encerrar sem vencedor. Enquanto alguém tem direito de reconexão, não declarar derrota por ausência dessa pessoa. Eliminações simultâneas são avaliadas ao final do mesmo passo de simulação.
- **Pós-jogo:** resultado permanece até cada participante escolher voltar; durante esse período não se inicia nova partida. O servidor encaminha automaticamente ao lobby após 30 segundos se nenhuma escolha for feita; todos retornam sem pronto. Jogadores desconectados voltam somente por código e vaga no lobby, conforme seção 11.
- **PvE:** ao confirmar build no editor, tempo restante de cada espaço é mantido em segundos, sem reduzi-lo ao máximo da nova habilidade. Quando arma/capa perde efeito, remover modificadores contínuos anteriores; efeitos temporários já aplicados permanecem até terminar. O monstro para movimentação e novos ataques com editor aberto; efeitos anteriores continuam. Ao sair do editor, retoma. O boneco não recebe dano do monstro; cura total contabiliza apenas vida efetivamente restaurada.
- **Reawaken:** cura de 30% é do valor máximo do aliado após ressurgir; reativação aplica tempo de conjuração conforme ficha. Por padrão, pode atingir aliado caído na fase de 15 s e na fase de levantar; se recuperação ou finalização ocorrer primeiro, lançamento falha sem ressuscitar. Seu uso pode ser incomum nas modalidades atuais.
- **Capas:** Caerleon é obrigatória; ativa ao usar habilidade do primeiro slot e reinicia a recarga daquele slot, uma vez por ativação da capa. Se a recarga da capa estiver indisponível, não reinicia. Na falta de valor confiável, usar provisoriamente 60 s e marcar hipótese. Para as outras capas, preferir valores identificados no terceiro levantamento como históricos e não declarar que são atuais; se não forem utilizáveis, escolher recarga conservadora e registrá-la.
- **Interface:** em PT-BR, tooltip informa claramente regras e tempos do jogo implementado; rótulos sem tradução segura podem manter nome inglês de referência. Menu contém criar/entrar, código, modo treino, ajuda e configurações de áudio. Sem música. Proibir tooltip falso ou valor divergente do usado na simulação.
- **Segurança funcional:** ações, recursos e estados são validados no servidor; limitadores razoáveis para mensagens e apelidos, sem precisar de contas. Sessões usam segredo de reconexão no navegador; manter slots reservados isolados. Não usar cookies de identidade como autenticação de usuário entre aparelhos.
- **Comandos:** forneça prepare.sh, start.sh e stop.sh para Linux; após preparo, rodar offline. Porta configurável, padrão 8094, sem requerer privilégios. Não reservar porta do Game Hub. Diagnóstico mostra endereço/porta e mensagens claras. Não modificar arquivos do usuário fora do diretório do projeto sem autorização.

## 15. Catálogo integrado de equipamentos e habilidades

Os dados seguintes foram fornecidos nos levantamentos, não revalidados independentemente nesta consolidação. Eles fazem parte da entrega para que o projeto não dependa de outro arquivo. As seções de pesquisa abaixo são anexos informativos: **regras do produto e decisões confirmadas prevalecem**. O terceiro round corrige o segundo quando trata do mesmo campo; texto de “pendência” é diagnóstico da pesquisa, não ordem de bloquear ou suprimir funcionalidades. As aproximações efetivamente escolhidas durante o desenvolvimento devem ser registradas no catálogo implementado e nos relatórios de teste.

### Anexo A — catálogo completo de opções e fichas do segundo levantamento

# C. Itens e atributos — T8.0 Normal, IP 1100

“Não listado” não prova valor zero. Percentuais e valores de resistência mantêm as unidades da fonte.

## C.1. Armas de uma mão

| PT-BR de referência / nome inglês | Mãos / offhand | Stats IP1100 | Estado |
|---|---|---|---|
| Machado de Batalha do Ancião / **Elder’s Battleaxe** | Uma mão; permite Escudo, Diary/Tome ou Tocha. | AA98; velocidade1,1/s; DPS108/s; alcance3m; AP138; +95 Max HP; regen HP bonus+5%; peso25,6kg; durabilidade68.344. | Página atual. |
| Adaga do Ancião / **Elder’s Dagger** | Uma mão; permite offhand. | AA55; velocidade2/s; DPS110/s; alcance2m; AP144; peso25,6kg; durabilidade68.344. | Página atual. |
| Cajado de Fogo do Ancião / **Elder’s Fire Staff** | Uma mão; permite offhand. | AA53; velocidade1,35/s; DPS71/s; alcance9m; AP120; peso25,6kg; durabilidade68.344. | Página atual; data de última mudança do item é antiga. |
| Cajado de Gelo do Ancião / **Elder’s Frost Staff** | Uma mão; permite offhand. | AA53; velocidade1,35/s; DPS71/s; alcance9m; AP120; peso25,6kg; durabilidade68.344. | Catálogo atual; conferir página T8 diretamente no cliente antes de congelar. |
| Cajado Sagrado do Ancião / **Elder’s Holy Staff** | Uma mão; permite offhand. | AA53; velocidade1,35/s; DPS71/s; alcance9m; AP120; peso25,6kg; durabilidade68.344. | Página atual; Holy Staff básico. |

Fontes: [Battleaxe](https://allthingsalbion.com/en/items/T8_MAIN_AXE), [Dagger](https://allthingsalbion.com/en/items/T8_MAIN_DAGGER), [Fire](https://allthingsalbion.com/en/items/T8_MAIN_FIRESTAFF), [Frost](https://allthingsalbion.com/en/items/T8_MAIN_FROSTSTAFF), [Holy](https://allthingsalbion.com/en/items/T8_MAIN_HOLYSTAFF). Nomes em português são rótulos de trabalho até conferir a localização do cliente.

## C.2. Mão secundária

| Item / identidade | Stats IP1100 | Skills |
|---|---|---|
| Escudo do Ancião / **Elder’s Shield** | CCR+50 pontos; Defense vs Players+5,2%; Defense vs Mobs+5,2%; Threat Generation+20,5%; peso8,5kg; durabilidade36.450. | Sem ativa/passiva selecionável. |
| Tomo de Feitiços / **Rosalia’s Diary**, item T8 da categoria Elder’s Tome of Spells | Energia máxima+29; regen energia+0,37/s; cast time reduction+2,1%; peso8,5kg; durabilidade36.450. | Sem ativa/passiva. O nome T8 da base é Rosalia’s Diary, não um item T8 separado de Tome of Spells. |
| Tocha do Ancião / **Elder’s Torch** | Velocidade AA+12,3%; Cooldown Rate+0,6%; peso8,5kg; durabilidade36.450. | Sem ativa/passiva. |

Fontes: [Shield](https://allthingsalbion.com/en/items/T8_OFF_SHIELD), [Diary](https://allthingsalbion.com/en/items/T8_OFF_BOOK), [Torch](https://allthingsalbion.com/en/items/T8_OFF_TORCH). Defense vs players/mobs são bônus percentuais, não Armor/MR.

## C.3. Armaduras

| Peça | Stats IP1100 publicados | Observação |
|---|---|---|
| Mercenary Hood | +269 HP; +98 energia; +2,7 HP/s; +1,22 energia/s; peso8,5kg; durabilidade36.450. | Armor/MR não listados na linha consultada. |
| Mercenary Jacket | +188 Armor; +188 Magic Resistance; +138 CCR; +539 HP; +49 energia; ataques e habilidades físicos/mágicos+20%; cura conjurada+20%; +5,4 HP/s e regen HP+150%; +0,61 energia/s e regen energia+6%; CC vs players+20%; peso17,1kg; durabilidade54.675. | Bônus são percentuais. CC vs mobs não confirmado. |
| Mercenary Shoes | +269 HP; +29 energia; +2,7 HP/s; +0,37 energia/s; carga máxima+59; peso8,5kg; durabilidade45.563. | Carga sem utilidade no escopo. |
| Soldier Helmet | +269 HP; +98 energia; +2,7 HP/s; +1,22 energia/s; peso8,5kg; durabilidade36.450. | Armor/MR não listados. |
| Soldier Armor | +236 Armor; +193 Magic Resistance; +156 CCR; +539 HP; +49 energia; ataques/habilidades físico/mágico+10%; cura conjurada+10%; +5,4 HP/s e regen HP+150%; +0,61 energia/s e regen energia+4%; CC vs players+40%; peso17,1kg; durabilidade54.675. | +40% é duração de CC, não redução de dano. |
| Soldier Boots | +269 HP; +29 energia; +2,7 HP/s; +0,37 energia/s; carga máxima+59; peso8,5kg; durabilidade45.563. | Armor/MR não listados. |
| Scholar Cowl | +269 HP; +98 energia; +2,7 HP/s; +1,22 energia/s; peso8,5kg; durabilidade36.450. | ID T8_HEAD_CLOTH_SET1; não é Mage Cowl. |
| Scholar Robe | +133 Armor; +159 Magic Resistance; +127 CCR; +539 HP; +49 energia; ataques/habilidades físico/mágico+40%; cura conjurada+40%; +5,4 HP/s e regen HP+150%; +0,61 energia/s e regen energia+12%; peso17,1kg; durabilidade54.675. | ID SET1 Scholar; Mage é SET3. |
| Scholar Sandals | +269 HP; +29 energia; +2,7 HP/s; +0,37 energia/s; carga máxima+59; peso8,5kg; durabilidade45.563. | ID T8_SHOES_CLOTH_SET1. |

Fontes: [Mercenary Hood](https://allthingsalbion.com/en/items/T8_HEAD_LEATHER_SET1), [Jacket](https://allthingsalbion.com/en/items/T8_ARMOR_LEATHER_SET1), [Shoes](https://allthingsalbion.com/en/items/T8_SHOES_LEATHER_SET1); [Soldier Helmet](https://allthingsalbion.com/en/items/T8_HEAD_PLATE_SET1), [Armor](https://allthingsalbion.com/en/items/T8_ARMOR_PLATE_SET1), [Boots](https://allthingsalbion.com/en/items/T8_SHOES_PLATE_SET1); [Scholar Cowl](https://allthingsalbion.com/en/items/T8_HEAD_CLOTH_SET1), [Robe](https://allthingsalbion.com/en/items/T8_ARMOR_CLOTH_SET1), [Sandals](https://allthingsalbion.com/en/items/T8_SHOES_CLOTH_SET1).

Armor/MR são valores; Defense vs players/mobs e bônus de dano/cura são percentuais. Valor não listado não prova ausência ou zero. A tabela anterior misturava Normal e Good; esta substitui os stats anteriores.

---

# D. Catálogo e fichas de habilidades e passivas

## D.1. Todas as opções por item e slot

Os nomes são as opções em inglês na página atual. Nomes PT-BR de skills não foram conferidos um a um no cliente. Dados numéricos abaixo usam a variante básica T8; valores marcados pendentes não devem ser tratados como completos.

| Item | Q / primeira escolha | W / segunda escolha | E | Passivas selecionáveis |
|---|---|---|---|---|
| Battleaxe | Rending Strike; Rending Spin; Rending Rage | Deadly Chop; Adrenaline Boost; Battle Rush; Internal Bleeding; Raging Blades | Blood Bandit | Deep Cuts; Life Leech; Increased Defense; Aggressive Rush |
| Dagger | Sunder Armor; Deadly Swipe; Assassin Spirit | Throwing Blades; Dash; Forbidden Stab; Shadow Edge; Chain Slash | Bloodthirsty Blade | Deep Cuts; Life Leech; Auto-Attack Speed; Aggressive Rush |
| Fire Staff | Fire Bolt; Burning Field; Searing Flame | Flame Blast; Wall of Flames; Raging Flare; Fire Wave; Fire Artillery | Pyroblast | Burn; Energetic; Aggressive Caster; Furious |
| Frost Staff | Frostbite; Ice Shard; Frozen Surge | Frost Bomb; Frost Beam; Frost Nova; Frost Lance; Glacial Obelisk | Freezing Wind | Frost; Energetic; Aggressive Caster; Furious |
| Holy Staff básico | Generous Heal; Smite; Holy Flash | Sacred Pulse; Holy Beam; Holy Blessing; Holy Orb; Reawaken | Desperate Prayer | Adrenaline Driven Charity; Energetic; Magic Force; Ascended |
| Mercenary Hood | Energizing Shield; Cleanse; Howl | — | — | Balanced Mind; Swiftness; Quick Thinker |
| Mercenary Jacket | Mend Wounds; Inferno Shield; Bloodlust | — | — | Balanced Mind; Swiftness; Quick Thinker |
| Mercenary Shoes | Dodge; Refreshing Sprint; Break Free | — | — | Courier; Balanced Mind; Swiftness; Quick Thinker |
| Soldier Helmet | Energizing Shield; Stone Skin; Block | — | — | Toughness; Authority; Tenacity |
| Soldier Armor | Mend Wounds; Taunt; Fury | — | — | Escolha1: Toughness/Authority/Tenacity; escolha2: Spirit Crush/Protective Instinct |
| Soldier Boots | Dodge; Rejuvenating Sprint; Wanderlust | — | — | Courier; Toughness; Authority; Tenacity |
| Scholar Cowl | Energizing Shield; Force Field; Aegis of Energy | — | — | Aggression; Concentration; Efficiency |
| Scholar Robe | Mend Wounds; Frost Shield; Speed Caster | — | — | Aggression; Concentration; Efficiency |
| Scholar Sandals | Dodge; Energetic Sprint; Focused Run | — | — | Courier; Aggression; Concentration; Efficiency |

Os cinco cajados, a adaga e o machado são de uma mão e aceitam off-hand. O Holy Staff básico não é Lifetouch/Fallen/Hallowfall. Os mesmos nomes de skill em armas de artefato não significam os mesmos números: confira AP e item de origem.

## D.2. Battleaxe — T8 Normal, AP 138

| Skill | Mira, tempo, alcance | Custo e recarga | Efeito atual encontrado | Estado |
|---|---|---|---|---|
| Rending Strike (Q) | Inimigo, range3m, instantâneo. | Arquivo: energia bruta1,6, CD2s; custo tooltip atual não confirmado. | 195 físico; aplica1 carga. Cada carga causa ~83 físico total em6s; máximo3. Com3, healing received do alvo−12% por5s. Tick cadence pendente. | Parcial |
| Rending Spin (Q) | Ao redor do usuário até5m, instantâneo. | Captura: custo3, CD3s. | Dano varia por distância:231 a2,5m e264 na borda5m. Aplica uma carga em cada inimigo acertado. | Parcial; valores antigos, confirmar atuais |
| Rending Rage (Q) | Dois cortes em cone; terceira etapa salta a posição até9m. | Combo reseta2,5s; custos/cooldowns por etapa corrompidos. | Primeiras etapas:165 físico e1 carga. Terceiro passo Raging Leap:165 físico e root em raio5m; duração de controle ~1,61s no dado atual. | Parcial |
| Deadly Chop (W) | Alvo a3m; cast0,4s. | Arquivo: energia8, CD15s. | 502 físico; reduz resistências em16% por8s na captura T8. Unidade atual do debuff a confirmar. | Parcial |
| Adrenaline Boost (W) | Buff próprio, instantâneo. | Dado atual: custo30, CD20s. | +25% dano, +40% movimento e +40% velocidade de AA até9s. Termina após3s sem causar dano direto. Captura antiga: duração7s e3,5s sem dano. | Parcial |
| Battle Rush (W) | Dash até ponto, range12m, raio5m. | Custo atual36, CD18s; captura antiga dizia11 e20s. | Enemies próximos: healing received−20% por3s; até5 aliados próximos: healing received+20% por4s. | Parcial |
| Internal Bleeding (W) | Área centrada no usuário, raio6m, instantâneo. | Custo26; CD15s. | 193 físico direto; alvos móveis sangram66 físico a cada0,5s por até8s. | Parcial; máximo de ticks/renovação pendente |
| Raging Blades (W) | Aura centrada no usuário, raio5m, dura3s. | Custo30; CD12s; instantâneo. | Duas lâminas mágicas causam73 a cada0,5s. Por inimigo atingido,+4% dano até10 stacks; buff3s. | Parcial |
| Blood Bandit (E) | Duas etapas direcionais, range até17m; combo reseta9s. | Dado atual: custo40, CD10s; separar custos por etapa pendente. | Etapa1 dano conforme0/1/2/3 cargas:528/627/726/825 físico. Etapa2 causa363 físico e cura110/177/243/331 conforme cargas do primeiro inimigo atingido. | Parcial; seleção/consumo das cargas e cooldown pendentes |

Passivas Battleaxe:

- **Deep Cuts:** a cada4 AA aplica bleed. Captura T8:55 físico total; duração atual não recuperada.
- **Life Leech:** a cada AA rouba15% da vida efetivamente perdida pelo inimigo na captura. Verificar cálculo pós-resistência/PvE.
- **Increased Defense:** a cada5 AA aumenta “damage resistances” em29% por2s na captura. Confirmar stat e se29% não é coeficiente.
- **Aggressive Rush:** a cada4 AA,+8% dano por3s na captura. Refresh/stack pendentes.

Fonte: [Elder’s Battleaxe T8](https://allthingsalbion.com/en/items/T8_MAIN_AXE).

## D.3. Dagger — T8 Normal, AP 144

| Skill | Mira, tempo, alcance | Custo e recarga | Efeito encontrado | Estado |
|---|---|---|---|---|
| Sunder Armor (Q) | Inimigo, range2m, instantâneo. | Captura: energia3, CD2s; custo atual pendente. | 230 físico; cargas por8s reduzem resistências−4% vs players/−6% vs mobs; até3 cargas. | Parcial |
| Deadly Swipe (Q) | Salto ao ponto até4,5m, área3m. | Captura: custo9, CD4s. | 258 físico; ganha carga Assassin Spirit por inimigo atingido; ao acertar pelo menos um, restaura21 energia. Cada carga dá+6% dano por8s, até3. | Parcial |
| Assassin Spirit (Q) | Self-toggle, até15s, pode desligar. | Captura: energia6, cooldown de reuso1s (bruto/tooltip diferem). | Gera uma carga a cada2s; reduz Defense4%; carga concede+6% dano por8s, máximo3. | Parcial |
| Throwing Blades (W) | Cone na direção, 3 lâminas perfuram alvos; range12m. | Captura: energia11 bruta, CD15s. | 207 físico no extrato; por inimigo único atingido,+15% movimento e+10% dano por5s, até3. Unidade “207” e se é por lâmina/alvo pendem. | Parcial |
| Dash (W) | Dash até ponto, range8m. | Captura traz energia0,08 e CD23,5s; valor atual não confirmado. | +15% dano por4s após dash. | Parcial |
| Forbidden Stab (W) | Alvo inimigo a2m; instantâneo; interrompe cast. | Custo24; CD15s. | 290 físico; Healing Received do alvo negado por1,5s. Duração/ações interrompidas a testar. | Parcial alto |
| Shadow Edge (W) | Projétil até22m, primeiro inimigo atingido; teleporta/puxa para trás dele. | Custo41; CD20s; acertar player reduz CD25%. | Stun player ~1,68s; imune a CC/debuff durante deslocamento até o alvo. Velocidade do projétil e diferença PvE pendentes. | Parcial |
| Chain Slash (W) | Alvo e saltos ao inimigo mais próximo até7m do último; máximo3 alvos; range inicial6m. Invisível e imune a dano enquanto salta. | Energia9 na captura; CD15s. | Página atual: dano379/482/689 por hits1/2/3. Mudou máximo4→3 em24/11/25 e distância6→7m em11/03/26. | Parcial; confirmar dano por hit no cliente |
| Bloodthirsty Blade (E) | Buff próprio, AA aplica efeito ao inimigo, até6s, pode desligar. | Energia48; CD20s; instantâneo. | AA soma172 mágico vs players/103 vs mobs; rouba100% da vida removida por esse dano; +30% movimento; auto-dano verdadeiro−2,5% Max HP a cada1s. | Parcial alto; primeiro tick e cancelamento pendem |

Passivas Dagger:

- **Deep Cuts:** a cada4 AA. Captura antiga:57 físico, duração ausente.
- **Life Leech:**15% da vida perdida do alvo por AA na captura; fórmula efetiva pendente.
- **Auto-Attack Speed:** a cada5 AA,+30% por3s no arquivo; verificar valor atual.
- **Aggressive Rush:** a cada4 AA,+6% dano por3s na captura; refresh pendente.

Fontes: [Dagger T8](https://allthingsalbion.com/en/items/T8_MAIN_DAGGER), [Bloodthirsty Blade e histórico atual](https://allthingsalbion.com/en/spells/BLOODTHIRSTYBLADE), [Forbidden Stab](https://allthingsalbion.com/en/spells/FORBIDDENSTAB).

## D.4. Fire Staff — T8 Normal, AP 120

| Skill | Mira, tempo, alcance | Energia/CD | Efeito atual encontrado | Estado |
|---|---|---|---|---|
| Fire Bolt (Q) | Projétil em inimigo; cast0,8s; range13m. | Custo9; sem CD próprio indicado. | 178 mágico direto + burn57 total em4s; até5 cargas. Tick do burn pendente. | Parcial |
| Burning Field (Q) | Ponto no chão, raio3m, cast0,5s, range15m. | Custo6; CD4s. | 201 mágico no impacto; campo4s, 158 mágico/0,5s vs player ou57 vs mob; não refletível. | Parcial |
| Searing Flame (Q) | Ataque direcional; combo de3 acertos e finalizador; range18/20m. | Custo atual14 por etapa reportado; CD1,5s; cast0,3s/0,4s; reset5s. | Primeiros3:284 mágico + burn126 total/4s. Quarto:574 direto +126 burn. Precisa acertar para continuar. | Parcial |
| Flame Blast (W) | Alvo pode ser inimigo, aliado ou self; range11m; explosão raio5m após1,6s. | Custo23; CD12s; instantâneo. | Explosão incendeia inimigos atingidos por402 mágico; inimigo primário recebe115 adicional imediato. Se alvo principal for self/aliado,+60% movimento por1,6s. | Parcial alto; elegibilidade por modo pendente |
| Wall of Flames (W) | Parede/frente do usuário, dura5s; largura reportada14m; espessura não confirmada. | Custo43; CD15s; instantâneo. | Toque aplica burn417 mágico total/4s, não refletível; inimigos fogem0,5s, monstros uma vez. | Parcial |
| Raging Flare (W) | Projétil direcional que explode; raio5m; range22m; cast0,4s. | Custo46; CD20s. | 588 mágico e burn184 total/3s. | Parcial |
| Fire Wave (W) | Cone frontal; range12m; instantâneo. | Custo34; CD12s (2025 registrou15s). | 497 mágico segundo leitura atual; +201 se alvo está sob Fire Bolt/Burning Field/Searing Flame; knockback~5,59m. Natureza de 497 (instantânea ou temporal) pendente. | Parcial |
| Fire Artillery (W) | Canaliza orbes no inimigo; range18m; intervalo1,5s; canal reportado3s. | Custo46; cast inicial1,5s; CD15s. | Cada orbe158 mágico em raio3m; área de fogo6s; DoT43 vs player/16 vs mob a cada0,5s, até4 stacks, não refletível. | Parcial; total de orbes/canal no cliente |
| Pyroblast (E) | Carrega/canaliza; range15m; explosão raio4m; até1,2s. | Custo43; CD15s. | Estágios0/0,6/1,2s:402/689/976 mágico; canal completo knockback3,5m. | Parcial |

Passivas Fire:

- **Burn:** cada AA aplica72 mágico total/3s; intervalo de ticks pendente.
- **Energetic:** AA restaura3,6 energia na página atual; verificar se exige acerto.
- **Aggressive Caster:** após4 spells, −40% cast por3s.
- **Furious:** após5 spells,+10% dano por4s.

Fonte: [Fire Staff T8](https://allthingsalbion.com/en/items/T8_MAIN_FIRESTAFF).

## D.5. Frost Staff — T8 Normal, AP 120

| Skill | Mira, tempo, alcance | Energia/CD | Efeito atual encontrado | Estado |
|---|---|---|---|---|
| Frostbite (Q) | Projétil direcional; range18m; cast0,3s. | Custo14; CD1,2s. | 293 mágico;1 stack por3s, máximo3; ao chegar a3, stun~1,12s. Regra de consumo/reset pendente. | Parcial |
| Ice Shard (Q) | Ponto no chão, raio3m, cast1,2s, range14m. | CD0 na captura; custo atual pendente. | 373 mágico vs player/258 vs mob. | Parcial |
| Frozen Surge (Q) | Faixa frontal no chão, comprimento16m, largura reportada3,8m, range16m. | Custo14; CD3s. | 258 mágico e slow20%/3s. | Parcial; largura a validar |
| Frost Bomb (W) | Ponto no chão, range11m, explode após1,6s. | Custo29; CD10s. | Slow inicial30% em raio5m; depois477 mágico em raio5m e slow20%/5s. | Parcial |
| Frost Beam (W) | Alvo inimigo; dano em área ao redor; raio de dano4m, canal até2,7s, range12m. | Custo37; CD15s; instantâneo. | 90 mágico a cada0,3s; cada tick slow e redução de AA15%, máximo5, dura2s pós canal. Outra leitura dá raio5m para debuff e4m para dano. | Parcial/conflito de raio |
| Frost Nova (W) | Teleporte a ponto até11m; não atravessa obstáculos; impacto raio3m na origem. | Custo34; CD20s. | 201 mágico; stun1,4s; usuário imune a dano0,2s. | Parcial |
| Frost Lance (W) | Posição/direção, range9m. | Custo8; CD8s. | Ao atingir, explode raio3m por425 mágico; reduz resistências12%/3s na captura T8. | Parcial |
| Glacial Obelisk (W) | Coloca objeto no chão, range12m; cast0,4s; dura6s; recast antes de expirar. | Custo23; CD16s; janela~5,9s, recarga após expiração~10,1s. | Até10 aliados em raio6m recebem+20% dano e cooldown rate. Recast:221 mágico e slow40%/4s; raio da explosão não recuperado. | Parcial |
| Freezing Wind (E) | Cone frontal, range12m; instantâneo. | Custo46; CD18s. | 574 mágico no impacto; root em todos acertados2,8s. Não há pulsos nem slow gradual pós update. Largura/ângulo pendentes. | Parcial alto |

Passivas Frost:

- **Frost:** após4 spells, próximo AA enraíza ~1,2s na leitura atual; captura 2025 traz0,86s. Expiração do próximo AA pendente.
- **Energetic:**3,6 energia por AA segundo página atual; acerto pendente.
- **Aggressive Caster:** após4 casts,−40% cast/3s.
- **Furious:** após5 spells,+10% dano/4s.

Fontes: [Frost Staff T8](https://allthingsalbion.com/en/items/T8_MAIN_FROSTSTAFF), [Freezing Wind e histórico](https://allthingsalbion.com/en/spells/FREEZINGWIND?w=T8_MAIN_FROSTSTAFF), [mecânicas CC](https://allthingsalbion.com/en/mechanics/).

## D.6. Holy Staff básico — T8 Normal, AP 120

**Identidade:** T8_MAIN_HOLYSTAFF é o Holy Staff comum, uma mão, nome PT-BR de referência “Cajado Sagrado”. Não é Lifetouch/Fallen/Hallowfall.

| Skill | Mira, tempo, alcance | Energia/CD | Efeito T8 IP1100 | Estado |
|---|---|---|---|---|
| Generous Heal (Q) | Alvo aliado; range15m; cast0,5s. | Energia18; CD1,5s. | Cura201; alvo recebe+5% Healing Received/4s, até3 stacks. | Parcial; autocura/refresh pendente |
| Smite (Q) | Área chão; raio2,5m; cast0,5s; delay0,25s; range13m. | Energia11; CD3s, reduz50% se acertar inimigo. | 330 mágico vs player/390 vs mob; próximo dano direto nos atingidos em3s dá109 mágico adicional. | Valores atuais no banco; tooltip cliente pendente |
| Holy Flash (Q) | Ponto chão; raio5m; range13m; cast0,4s + hit delay0,4s. | Energia23; CD3,5s. | Cura213 em até10 aliados na área. | Parcial; incluir caster e escolha de alvos pendentes |
| Sacred Pulse (W) | Alvo aliado; raio5m ao redor; range13m; instantâneo, stand0,3s. | Energia32; CD12s. | Cura81 até5 aliados; causa321 mágico vs players/482 vs mobs; empurra players12,58m; mobs lançados1s. | Parcial; line of sight e alvo de cura pendentes |
| Holy Beam (W) | Só alvo aliado; não pode self; range12m; canal3s; conjurador slow30%. | Energia37; CD12s; início instantâneo. | Cura101 por0,5s; incrementa12 a cada0,5s, até7 stacks. Se houver7 ticks, soma959; tick inicial deve ser cronometrado. | Self-target confirmado impossível; timing parcial |
| Holy Blessing (W) | Alvo aliado; range13m; instantâneo. | Energia23; CD15s. | +86 Armor e+30% Healing Received por4s; imunidade a forced movement. | Parcial; CC exato/purge pendentes |
| Holy Orb (W) | Projétil direcional, explode ao tocar aliado; range25m; cura raio7m. | Energia29; CD15s; instantâneo. | Cura272 até10 aliados ao redor do impacto. | Parcial; velocidade/colisão/primeiro alvo pendentes |
| Reawaken (W) | Alvo aliado knocked down; range12m; cast1s; stand0,6s; hit delay0,2s. | Energia66; CD30s; target lockout3min. | Levanta alvo e restaura30% HP máxima. A mudança de alvo para ally é de23/09/2026. | Efeito confirmado; conflito com projeto em H |
| Desperate Prayer (E) | Alvo aliado; range13m; instantâneo; stand0,6s. | Energia43; CD10s. | Cura201 se alvo>40% HP,443 se abaixo40%; se >40%, +5% Healing Cast ao curador15s, até3 stacks. Caso exatamente40% pendente. | Parcial |

Passivas Holy:

- **Adrenaline Driven Charity:** após cada4 spells castadas,+20% Healing Cast/3s; refresh pendente.
- **Energetic:** ataque básico restaura3,6 energia na página T8.
- **Magic Force:** após5 spells, próximo AA empurra alvo~2,99m. Fonte atual não explicita interrupção; captura antiga dizia interromper cast. Interrupção atual não confirmada.
- **Ascended:** opção confirmada; efeito atual completo não recuperado.

Fontes: [Holy Staff T8](https://allthingsalbion.com/en/items/T8_MAIN_HOLYSTAFF), [Smite e histórico](https://allthingsalbion.com/en/spells/SMITE_AOE), [Reawaken](https://allthingsalbion.com/en/spells/REAWAKEN), [Sacred Pulse](https://allthingsalbion.com/en/spells/PULSINGHEAL?w=T8_MAIN_HOLYSTAFF), [catálogo](https://allthingsalbion.com/en/spells).

## D.7. Armaduras: fichas recuperadas e lacunas

### Skills encontradas em múltiplas peças

| Skill | Ocorrência e efeito atual | Valores/campos pendentes |
|---|---|---|
| Energizing Shield | Mercenary Hood, Soldier Helmet, Scholar Cowl. No Scholar Cowl IP1100: escudo505 pré-resistência/3s, recupera25% energia faltante, CD25s, instantâneo, sem custo. | Mesmo valor nos outros helmets não foi comparado individualmente nesta rodada. |
| Mend Wounds | Mercenary Jacket, Soldier Armor, Scholar Robe; self-heal fora de combate. | Página atual indica canal7s, movimento−50%; a cada1s cura9% Max HP e recupera7,5% Max Energy; CD30s, custo0; não recebe Healing Cast Bonus. Número exato de pulsos/primeiro tick/limiar “fora de combate” requer teste. |
| Dodge | Mercenary Shoes, Soldier Boots, Scholar Sandals; salto a ponto. | Range5m, CD20s, imunidade a dano/debuff/CC por0,8s, +40% movimento/5s em atualização de13/04/2026; custo0, instantâneo. Trajetória/obstáculo pendentes. |
| Stone Skin | Soldier Helmet, self buff. | Duração4s, CD30s; fonte atual descreve aumento de Defense ~33,33%. Valor final/idioma do tooltip pendente. |
| Block | Soldier Helmet, canaliza enquanto pode mover. | Imune a dano e CC durante~2,5s; CD30s, custo0. Se pode atacar ou usar skill não confirmado. |
| Frost Shield | Scholar Robe, self buff. | +83 resistência/8s; reflete15% do dano como mágico; slow40%/2s em atacante; custo26/CD40, instantâneo. +83 é ponto de resistência. |
| Speed Caster | Scholar Robe, self buff. | −50% cast e−70% energia por8s; custo26/CD30, instantâneo. Não acelera skill instantânea. |
| Focused Run | Scholar Sandals, canal4,5s. | +70% movimento; imune stun/root/slow; restaura11 energia/0,5s; CD30s, instantâneo. Ações permitidas durante canal pendentes. |
| Energetic Sprint | Scholar Sandals. | +80% movimento/5s; restaura11 energia/1s; CD30s, custo0. Valores antigos davam10. |
| Break Free | Mercenary Shoes, dash a ponto. | Até12m, limpa CC, pode ser usada sob stun/silence, custo0, CD30s. Confirmar alcance e quais CC remove. |
| Force Field | Scholar Cowl. | Knockback9m em raio6m, ignora CCR;177 mágico; CD30s, stand0,5s. |
| Aegis of Energy | Scholar Cowl, self. | +105 Armor/+28 Magic Resistance/4s; ao receber dano restaura42 energia; CD30s, instantâneo. “Por evento” e limite precisam teste. |
| Howl | Mercenary Hood, cone frontal. | Fonte atual indica163 mágico, slow35%/4s,−30% dano causado/4s e interrompe cast. Custo, ângulo/range, CD, PvP/PvE não fechados. |
| Rejuvenating Sprint | Soldier Boots. | Captura antiga tem +80% movimento/5s e cura X; cura/ticks atuais ainda não encontrados. Parcial. |

### Opções de armadura sem ficha completa

| Item | Ativas | Passivas | Pendências |
|---|---|---|---|
| Mercenary Hood | Energizing Shield; Cleanse; Howl | Balanced Mind; Swiftness; Quick Thinker | Purge completo, raio, CD, aliados e números por slot. |
| Mercenary Jacket | Mend Wounds; Inferno Shield; Bloodlust | Balanced Mind; Swiftness; Quick Thinker | Bloodlust: heal por aplicação, janela, stacks e eventos elegíveis; Inferno Shield; Mend ticks. |
| Mercenary Shoes | Dodge; Refreshing Sprint; Break Free | Courier; Balanced Mind; Swiftness; Quick Thinker | Refreshing Sprint atual, duração, cooldown rate e valores de passivas por peça. |
| Soldier Helmet | Energizing Shield; Stone Skin; Block | Toughness; Authority; Tenacity | Ações permitidas em Block; comparar Shield entre helmets; números exatos de passivas. |
| Soldier Armor | Mend Wounds; Taunt; Fury | Choice: Toughness/Authority/Tenacity; Spirit Crush/Protective Instinct | Taunt completo; threat; passivas PvE; Mend. |
| Soldier Boots | Dodge; Rejuvenating Sprint; Wanderlust | Courier; Toughness; Authority; Tenacity | Heal/ticks de Sprint; carga, velocidade e cancelamento de Wanderlust. |
| Scholar Cowl | Energizing Shield; Force Field; Aegis of Energy | Aggression; Concentration; Efficiency | Passivas por slot; condição do restore de Aegis. |
| Scholar Robe | Mend Wounds; Frost Shield; Speed Caster | Aggression; Concentration; Efficiency | Mend; confirmar stats passivos por slot. |
| Scholar Sandals | Dodge; Energetic Sprint; Focused Run | Courier; Aggression; Concentration; Efficiency | Canal de Focused Run e passivas por slot. |

### Soldier Armor: mudanças centrais

- **Fury:** ativa por10s; dano recebido gera stacks até8; cada stack dá+8% todo dano e+5% duração CC; custo29, CD35s. Em23/02/2026 virou ativa e perdeu cura/penalidade antiga; em21/07/2026 dano por stack caiu9→8%. Não usar descrição velha de cura30%/−10% Defense PvP.
- **Taunt:** inimigo, prioridade máxima contra mob e ameaça em área reportada ~5m. Contra player, a fonte atual indica+20% dano causado e−25% Defense vs players/3s. Custo/CD/range final pendentes.
- **Spirit Crush:** cada AA diminui HP máximo e atual do mob12% por3s; sem efeito em jogadores. Reaplicação pendente.
- **Protective Instinct:** passiva PvE,+400% Threat na fonte atual.

### Passivas cujo valor muda por peça

| Passiva | Valor encontrado | O que falta |
|---|---|---|
| Balanced Mind | Mercenary: +1,5% dano e Healing Cast, +1% Defense na captura antiga. | Confirmar se todas as peças têm a mesma cifra. |
| Swiftness | Mercenary: +6% AA speed. | Confirmar escopo/stack com Torch. |
| Quick Thinker | Mercenary:+2,5% Cooldown Rate. | Confirmar soma com Tome/Torch. |
| Courier | +carga no item ou +0,3kg em passiva antiga; unidades/fontes divergem. | Sem relevância sem peso no jogo; não reconciliado. |
| Toughness | Soldier: Defense; captura dá2,5% helmet,5% chest. | Valor boots e escala exata pendentes. |
| Authority | Soldier: duração de CC; 5% head/10% chest na captura. | Boots e regra de stacking pendentes. |
| Tenacity | Soldier: CCR; 10% head/20% chest na captura. | Boots e fórmula pendentes. |
| Aggression | Scholar: dano e Healing Cast; 3,5% Cowl/Sandals e8% Robe na captura. | Confirmar valores atuais. |
| Concentration | Scholar: cast reduction;5% Cowl/Sandals,10% Robe. | Aditividade com Speed Caster/Tome. |
| Efficiency | Scholar: custo energia;6% Cowl/Sandals,12% Robe. | Aditividade e arredondamento. |

Fontes: [Mercenary Hood](https://allthingsalbion.com/en/items/T8_HEAD_LEATHER_SET1), [Jacket](https://allthingsalbion.com/en/items/T8_ARMOR_LEATHER_SET1), [Shoes](https://allthingsalbion.com/en/items/T8_SHOES_LEATHER_SET1); [Soldier Helmet](https://allthingsalbion.com/en/items/T8_HEAD_PLATE_SET1), [Armor](https://allthingsalbion.com/en/items/T8_ARMOR_PLATE_SET1), [Boots](https://allthingsalbion.com/en/items/T8_SHOES_PLATE_SET1); [Scholar Cowl](https://allthingsalbion.com/en/items/T8_HEAD_CLOTH_SET1), [Robe](https://allthingsalbion.com/en/items/T8_ARMOR_CLOTH_SET1), [Sandals](https://allthingsalbion.com/en/items/T8_SHOES_CLOTH_SET1).

## D.8. Recuperação de marcadores quebrados do arquivo 2025

| Campo quebrado | Valor recuperado nesta rodada | Estado |
|---|---|---|
| Battleaxe Rending bleed | ~83 físico total/carga por6s, até3; −12% heal receive por5s em3 stacks. Ticks não encontrados. | Parcial |
| Rending Rage | 165 físico por etapa, terceiro root raio5m/~1,61s; custos por etapa pendentes. | Parcial |
| Internal Bleeding | 66 físico/0,5s até8s se alvo se move; raio6; dano direto193. | Parcial |
| Raging Blades | raio5m,3s,73 mágico/0,5s,+4% por inimigo, máximo10. | Parcial |
| Blood Bandit | Dano528/627/726/825; cura110/177/243/331; 363 dano etapa2. | Parcial |
| Dagger Forbidden Stab | 290 físico e negação de cura1,5s; custo24/CD15. | Parcial alto |
| Bloodthirsty Blade | dano próprio−2,5% Max HP/tick; energia48; alteração12/10/26. | Parcial alto |
| Chain Slash | até3 alvos, salto7m, danos atuais379/482/689; valores 2025 antigos. | Parcial |
| Fire Bolt / Searing Flame | Burn57 total/4s e126 total/4s; etapas descritas em D.4. | Parcial |
| Flame Blast | raio5m, delay1,6s, dano402,115 imediato no inimigo; buff+60% movimento/1,6s. | Parcial alto |
| Fire skills restantes | Campos centrais recuperados em D.4, geometria/ticks/canal pendentes. | Parcial |
| Frost skills | Principais valores em D.5; detalhes de tick/raio e CC indicados. | Parcial |
| Freezing Wind | 574 e root2,8s atuais, custo46/CD18/range12. | Parcial alto |
| Holy skills | Valores atuais recuperados em D.6; alvo self de Holy Beam confirmado impossível. | Parcial alto |
| Armaduras | Energizing Shield, Mend Wounds, Dodge, Howl, Block, Sprint, Taunt, Aegis e Focused Run descritos em D.7. | Parcial |

A transcrição fornecida não contém fichas de capas; elas foram pesquisadas diretamente nesta rodada.

---

# E. Capas das cinco cidades — T8.0 Normal

## E.1. Atributos comuns

As cinco capas reais usam IP nominal1100 e compartilham stats básicos recuperados para Elder’s Cape: **+20 energia máxima, +0,24 energia/s, peso8,5kg, durabilidade50.119**. Não encontrei defesa ou habilidade selecionável. Efeito é passivo automático. Cooldowns derivados de campo bruto/coeficiente são inferências e precisam de tooltip do cliente.

Fonte dos stats: [Elder’s Cape T8](https://allthingsalbion.com/en/items/T8_CAPE). Efeitos: [Bridgewatch](https://allthingsalbion.com/en/spells/PASSIVE_CAPE_BRIDGEWATCH), [Fort Sterling](https://allthingsalbion.com/en/spells/PASSIVE_CAPE_FORTSTERLING), [Lymhurst](https://allthingsalbion.com/en/spells/PASSIVE_CAPE_LYMHURST), [Martlock](https://allthingsalbion.com/en/spells/PASSIVE_CAPE_MARTLOCK), [Thetford](https://allthingsalbion.com/en/spells/PASSIVE_CAPE_THETFORD).

| Capa | Gatilho e efeito | Área/alvos | Duração/recarga | Limites e confiança |
|---|---|---|---|---|
| **Elder’s Bridgewatch Cape — Sandstorm** | Usar habilidade do terceiro slot da arma; nas armas pesquisadas é E. | Raio5m em torno do usuário; afeta inimigos. | Dura6s. Cooldown estimado~58s a IP1100; tooltip final não observado. | Slow−40%, CCR−30%. Dados indicam gatilho CastFinished e bloqueio se cooldown da capa ou hostiledismount debuff estiver ativo. Se E falha/interrompe, confirmar. Sem split PvP/PvE encontrado. |
| **Elder’s Fort Sterling Cape — Untouchable** | Ao sofrer stun, silence, transformação ou root, limpa CC/debuffs exceto DoT. | Próprio usuário. | Duração de untouchable ~1s na leitura atual; cooldown estimado~80s, não confirmado no tooltip. | Não ativa durante cooldown da capa; stun TIME_FREEZE_EFFECT é exceção. DoT permanece. PvP/PvE sem split encontrado. |
| **Elder’s Lymhurst Cape — Energy Reserve** | Cast que deixa energia **abaixo de40%** da máxima. | Próprio usuário. | Recupera70% da energia máxima em10s; cooldown~138s em dados atuais, tooltip pendente. | Condição estrita menor que40%, não “até40%”. Não é instantâneo. Primeiro tick/intervalo, ordem custo-reembolso e purge pendentes. |
| **Elder’s Martlock Cape — Shield of Protection** | Vida cai abaixo de25%. | Próprio usuário; Defense vs players e mobs. | +50% Defense vs All/5s; cooldown estimado~157s. | Não é escudo de HP. Fonte diz que não é purgável. HP exatamente25%, dano que cruza o limiar e reativação pendem. |
| **Elder’s Thetford Cape — Chain Lightning** | AA pode disparar raio automático. | Hostis até4 alvos, saltos até9m. | Efeito instantâneo; dados atuais sugerem ICD~15s. | Dano~242 mágico IP1100; fonte antiga divergia (~220). Confirmar split PvP/PvE, reflect e seleção do alvo seguinte. |

Capas não têm custo manual nem mira. Bridgewatch é relevante para E; Thetford pode competir com contadores de AA, mas a ordem de processamento não foi testada.

---

# F. Fórmulas e mecânicas gerais

## F.1. Resistência, dano e Defense

A reconstrução comunitária apresenta mitigação por resistência como:

**dano recebido = dano bruto × 100 / (100 + resistência)**

Exemplos matemáticos:100 resistência deixa50% do dano;200 deixa33,3%;50 deixa66,7%. Isso se aplica a Armor/Magic Resistance e não deve ser confundido com Defense vs Players, bônus de redução percentual ou CCR. Algumas habilidades adicionam Armor/MR em pontos; outras dão percentual de Defense.

Fonte: [mecânicas de defesa, cooldown e cura](https://allthingsalbion.com/en/mechanics/). A página está em desenvolvimento; não é fórmula oficial documentada pela Sandbox.

## F.2. Dano, cura, cooldown e escudo

- **Bônus de dano/cura:** não confirmei fórmula oficial global para multiplicar todos os buffs. Habilidades diferenciam Physical/Magic Attack, Ability, Healing Cast e Healing Received. Não presuma que todos os bônus se multiplicam.
- **Cooldown Rate:** regra comunitária publicada: cooldown final = cooldown base / (1 + soma de taxas). Isso sugere somar rates antes da divisão. Confirme ao combinar Tome/Torch/passivas/Glacial Obelisk.
- **Cura:** a fórmula comunitária combina valor base, Healing Cast do curador, Healing Received do alvo e Healing Sickness. Não confirmada oficialmente para todos os modos.
- **Escudos:** Scholar Cowl declara escudo absorvido antes das resistências; outros podem calcular diferente. Escudo não é vida máxima.
- **Velocidade:** percentuais como+80% não equivalem a m/s. Fórmula e caps gerais não foram confirmados.

## F.3. Healing Sickness

A página comunitária descreve Healing Sickness em PvP quando múltiplos usuários Holy/Nature curam na janela de10s; efeitos sequenciais podem gerar cargas e uma penalidade a Healing Received ao cruzar um limiar. Modos e zonas podem alterar regras. Não validei a regra exata em fonte oficial ou cliente nesta rodada.

Não aplique automaticamente ao PrettierRPG. FFA limita cura de jogador a si mesmo, mas isso não decide se cura própria gera penalidade própria. O dono precisa decidir se adota Healing Sickness.

Fonte: [mecânicas comunitárias](https://allthingsalbion.com/en/mechanics/). Confiança média-baixa para condições precisas.

## F.4. CC, DoT/HoT e acúmulos

A fonte comunitária descreve escala de duração de CC por AP/IP e mitigação por CCR, além de diminishing returns. Está em construção; não confirmei todos os tipos, intervalos de reset, exceções por alvo ou regras de NPC. Nesta lista há efeitos que ignoram CCR (Force Field), imunidades próprias (Dodge, Frost Nova, Block, Fort Sterling) e duração variável pelo alvo.

Não há comprovação global suficiente para afirmar se todos os DoT/HoT acumulam, substituem ou renovam. Guardar regra por habilidade: Rending/Burn têm stacks explícitos, Internal Bleeding só aplica ticks enquanto o alvo se move, passivas ativam por contador. Pendem: efeito após morte de emissor/alvo, renovação de tick, ordem de escudo/resistência e se reflect aciona on-hit.

## F.5. Vida, energia, regeneração e arredondamento

- Vida/energia adicionadas por item estão em C. Vida e energia base do personagem nu e regen natural dentro/fora de combate **não confirmadas com valores atuais**.
- Regen indicada por segundo não revela sozinha o tick da interface.
- Dano/cura pode arredondar; não encontrei regra global de casas decimais.
- Modos/regiões podem ter IP caps e modificadores. Não aplique caps ao PrettierRPG sem escolher modo equivalente.

---



### Anexo B — correções e complementos do terceiro levantamento

## B. Tabela de divergências entre as duas pesquisas

| Item / campo | Captura de 2025 do Albion Online 2D | Pesquisa de 4/11/2026 | Dado mais recente verificável | Explicação e estado |
|---|---|---|---|---|
| Proveniência geral | Captura de páginas Albion Online 2D; anotada como 29.020.1 / 24-07-2025 | Pesquisa usou All Things Albion; não era continuação de versão da página 2D | A captura é evidência histórica fornecida pelo usuário; o URL atual não reconstrói 2025 | **Confirmado** quanto à origem e data indicada; o estado exato da página de 2025 depende da captura. |
| Qualidade/IP | T8 Normal; valores de item e skills mostram campos como 41/23/22 e placeholders | Em partes, inicialmente comparou Good/IP1120; neste round anterior foi convertido para Normal/IP1100 | Este round usa exclusivamente Normal/IP1100; Good difere em +20 IP | **Confirmado**. Não comparar tooltip Normal com Good. |
| Peças de tecido | Seção rotulada Mage, mas títulos internos/IDs são Scholar SET1 | O relatório anterior usou Mage em alguns trechos, apesar da nota de divergência | `T8_HEAD_CLOTH_SET1`, `T8_ARMOR_CLOTH_SET1`, `T8_SHOES_CLOTH_SET1` = Scholar Cowl/Robe/Sandals; Mage é SET3 | **Confirmado**. As três fichas de 2025 são Scholar; não importar skills Mage. |
| Mercenary Shoes | Captura/consulta antiga traz `Break Free` | “Rush” apareceu como possibilidade pendente | Opções atuais: `Dodge`, `Refreshing Sprint`, `Break Free`. Não há skill `Rush` nesse slot | **Confirmado**; “Rush” foi erro/ambiguidade do relatório anterior. Fonte: [Mercenary Shoes](https://allthingsalbion.com/en/items/T8_SHOES_LEATHER_SET1). |
| Dagger — Bloodthirsty Blade | Ataque acrescentava magia; custo cru14; o auto-dano aparecia como zero/incompleto | Auto-dano e custo ficaram parcialmente em aberto | IP1100: +172 magia por AA vs jogador / +103 vs monstro; rouba 100% da vida efetivamente removida por esse bônus; +30% movimento; auto-dano verdadeiro −2,5% da vida máxima a cada1s; energia de tooltip48; CD20s; até6s, pode desativar | **Confirmado** para valores/histórico; timing do primeiro tick e total no desligamento é **parcial**. Em 12/10/2026 o auto-dano passou de4% para2,5%. O custo cru14 não é custo final do tooltip. Fonte: [Bloodthirsty Blade e histórico](https://allthingsalbion.com/en/spells/BLOODTHIRSTYBLADE). |
| Dagger — Chain Slash | Captura antiga traz alvo/alcance máximo diferentes | Pesquisa anterior marcou valores atuais sem prova suficiente de cada etapa | Até3 alvos; saltos até7m do último; alcance inicial6m; dano atual publicado379/482/689 por sequência de 1/2/3 hits | **Provável/Parcial** até conferir no cliente. O limite caiu de4 para3 em24/11/2025; distância de6 para7m em11/03/2026. Fonte: [Chain Slash](https://allthingsalbion.com/en/spells/CHAINSLASH). |
| Holy Staff — Smite | Captura indicava −390 sem divisão PvP/PvE; custo de energia cru4 | Houve divergência com base antiga e custo reportado como11 | T8 IP1100: 330 magia vs jogador /390 vs monstro; próximo dano direto no alvo em3s acrescenta109 magia; acertar inimigo reduz CD em50%; energia de tooltip11; CD3s; conjuração0,5s; impacto após0,25s; alcance13m; raio2,5m | **Confirmado na base atual**, mas ainda requer observação no cliente. O 4 é campo cru/base, não custo exibido para IP1100. O split PvP/PvE está registrado na ficha atual. Fonte: [Smite](https://allthingsalbion.com/en/spells/SMITE_AOE). |
| Frost Staff — Freezing Wind | Linha corrompida: texto gradual, dano −499 e efeito de congelamento | Resultado antigo ficou conflitante/inconclusivo | T8 IP1100: 574 magia instantânea; root imediato2,8s; energia46; CD18s; alcance12m. Patch de29/06/2026 alterou root/dano e removeu efeito gradual/slow | **Confirmado** para efeito, custo e CD em base contemporânea; cone/ângulo continuam **não confirmados**. Fonte: [Freezing Wind](https://allthingsalbion.com/en/spells/FREEZINGWIND?w=T8_MAIN_FROSTSTAFF), [notas oficiais de balanceamento](https://forum.albiononline.com/index.php/Thread/220920-Update-Changes/). |
| Soldier Armor — atributos | Armor143/MR112/CCR40 eram campos crus do item | O relatório anterior não separava bem valor bruto de valor equipado | Normal/IP1100: Armor236; Magic Resistance193; CCR156; HP539; energy49; dano físico/mágico+10%; Healing Cast+10%; regen HP+5,4/s e+150%; regen energia+0,61/s e+4%; CC contra players+40% e mobs+40% | **Confirmado** na página T8 atual. Os números antigos são base/brutos, não valor equipado. Fonte: [Soldier Armor](https://allthingsalbion.com/en/items/T8_ARMOR_PLATE_SET1). |
| Soldier Armor — estrutura | Texto antigo separava slots de forma confusa | Dúvida de quantas opções ativas/passivas | Uma ativa selecionável: `Mend Wounds`, `Taunt` ou `Fury`; dois grupos passivos, com escolha `Toughness/Authority/Tenacity` e depois `Spirit Crush/Protective Instinct` | **Confirmado** no catálogo atual; os efeitos individuais ainda são parciais. |
| Ataque básico / velocidade | Campos de dano bruto: machado41, adaga23, cajados22; attack speed antigo 1/1 | Valores anteriores misturavam qualidade e IP | Na página atual IP1100: Battleaxe98,1,1/s,108 DPS; Dagger55,2/s,110 DPS; cajados53,1,35/s,71 DPS | **Confirmado** para o valor atualmente renderizado. A causa precisa da diferença entre attack speed bruto1 e1,1/1,35 não foi isolada; pode envolver escala/versionamento. Não inventar fórmula de velocidade. |
| Scholar Cowl — Energizing Shield | Dados incompletos e cooldown antigo20s | Pesquisa anterior já citava mudança, mas a ficha não fechava tudo | IP1100: escudo505 por3s; restaura25% da energia faltante; CD25s; instantâneo/self | **Confirmado**. O CD mudou de20 para25 em11/08/2025. Fonte: [Energizing Shield](https://allthingsalbion.com/en/spells/ENERGIZINGSHIELD). |
| Scholar Cowl — Aegis of Energy | Captura antiga apontava valores incompletos | Havia dúvida entre4s e5s | +105 Armor e+28 Magic Resistance por4s; cada dano recebido restaura42 energia; CD30s, instantâneo/self | **Confirmado**. O efeito de cinco segundos é valor anterior, não atual. Fonte: [Aegis of Energy](https://allthingsalbion.com/en/spells/AEGISOFENERGY). |
| Scholar Robe — Frost Shield | +0,3 resistência, reflect15%, slow20% | Pesquisa anterior dizia slow20% | IP1100: +83 pontos de resistência por8s; reflete15% do dano recebido como magia; slow40% por2s no atacante; energia26/CD40 | **Confirmado** na base atual. `0,3` é coeficiente/dado bruto, não “+0,3 resistência”; slow mudou20→30% em24/11/2025 e30→40% em23/02/2026. Fonte: [Frost Shield](https://allthingsalbion.com/en/spells/FROSTSHIELD). |
| Scholar Robe — Speed Caster | CD35s; −50% cast/−70% energia por8s | Repetia CD35s | Efeito continua; custo26; CD30s desde26/05/2026; instantâneo/self | **Confirmado**. Fonte/histórico: [Speed Caster](https://allthingsalbion.com/en/spells/SPEEDCASTER). |
| Passivas repetidas entre slots | Captura e fichas às vezes reaproveitam nome/valor | Algumas passivas foram generalizadas entre cowl, robe e sandals | Mesmo nome não garante mesmo valor: Scholar head/feet: Aggression+3,5%, Concentration−5%, Efficiency−6%; Scholar robe: +8%,−10%,−12% respectivamente | **Confirmado** na base por peça; gatilhos são passivos/contínuos conforme atributo, mas stacking com outros itens precisa teste. |
| Campos `0`, `X`, `{n}`, `NaN` | Presentes em valores de habilidade e item | Parte foi tratada como zero ou inferida | `0` pode ser coeficiente, arredondamento ou campo ausente; placeholders devem continuar pendentes sem uma fonte atual explícita | **Confirmado como regra de leitura**; significado individual depende do campo. |

## C. Identidade e atributos dos itens T8.0 Normal

Esta seção corrige o ponto de nomenclatura e resume as medidas que mudam a leitura das capturas. Para valores de armas/offhands/armaduras não atualizados aqui, veja a tabela completa do segundo round; esse relatório registra páginas individuais de cada item e usa Normal/IP1100. A ausência de um campo na página não prova que o bônus seja zero.

### C.1. Scholar, não Mage

| ID / item | Nome correto | Fonte direta |
|---|---|---|
| `T8_HEAD_CLOTH_SET1` | Elder’s Scholar Cowl — Capote/Capuz de Erudito do Ancião | [Item](https://allthingsalbion.com/en/items/T8_HEAD_CLOTH_SET1) |
| `T8_ARMOR_CLOTH_SET1` | Elder’s Scholar Robe — Túnica de Erudito do Ancião | [Item](https://allthingsalbion.com/en/items/T8_ARMOR_CLOTH_SET1) |
| `T8_SHOES_CLOTH_SET1` | Elder’s Scholar Sandals — Sandálias de Erudito do Ancião | [Item](https://allthingsalbion.com/en/items/T8_SHOES_CLOTH_SET1) |
| `T8_*_CLOTH_SET3` | Mage/Mago (outra linha) | Exemplo: [Mage Cowl SET3](https://allthingsalbion.com/en/items/T8_HEAD_CLOTH_SET3) |

Traduções PT-BR acima são rótulos de trabalho da localização atual; se o projeto exigir correspondência literal do cliente em português, registrar uma captura da localização PT-BR. IDs, nomes em inglês e opções confirmam sem ambiguidade que o alvo pedido é Scholar.

### C.2. Valores de referência T8 Normal

| Item | Valor de referência / observação atual |
|---|---|
| Battleaxe | IP1100; ataque básico98; velocidade1,1/s; DPS108; alcance3m; AP138; Elder’s Battleaxe página atual. |
| Dagger | IP1100; ataque básico55; velocidade2/s; DPS110; alcance2m; AP144. |
| Fire/Frost/Holy Staff | IP1100; ataque básico53; velocidade1,35/s; DPS71; alcance9m; AP120 cada. Holy é o cajado básico, ID `T8_MAIN_HOLYSTAFF`, não uma variante de artefato. |
| Elder’s Shield | CCR+50 pontos; Defense vs Players+5,2%; Defense vs Mobs+5,2%; Threat+20,5%; sem ativa/passiva selecionável. |
| Rosalia’s Diary (variante T8 de Tome of Spells) | Energia máxima+29; regen energia+0,37/s; cast time reduction+2,1%; sem skill selecionável. |
| Elder’s Torch | Velocidade de ataque básico+12,3%; Cooldown Rate+0,6%; sem skill selecionável. |
| Soldier Armor | Armor236; MR193; CCR156; HP539; energia49; dano/habilidade física e mágica+10%; Healing Cast+10%; regen HP+5,4/s e+150%; regen energia+0,61/s e+4%; CC recebido vs player+40% e vs mob+40%. |
| Scholar Cowl | HP269; energia98; regen HP2,7/s; regen energia1,22/s; IP1100. |
| Scholar Robe | Armor133; MR159; CCR127; HP539; energia49; dano/skill física e mágica+40%; Healing Cast+40%; regen HP5,4/s e+150%; regen energia0,61/s e+12%. |
| Scholar Sandals | HP269; energia29; regen HP2,7/s; regen energia0,37/s; carga máxima+59kg; IP1100. |
| Capas reais T8 | Todas: +20 energia máxima; +0,24 energia/s; peso8,5kg; durabilidade50.119; IP1100. Valores individuais estão em E. |

**Unidade:** Armor/MR/CCR são pontos do atributo; `Defense vs Players/Mobs`, dano, cura, regeneração e velocidade são percentuais/taxas conforme o nome do campo. `+40% CC duration vs players/mobs` é aumento de duração do controle aplicado, não mitigação de dano. Rosalia’s Diary é o item que ocupa o slot e corresponde ao Tome of Spells T8; não tratar o nome base “Tome of Spells” como outro item independente.

Páginas diretas: [Battleaxe](https://allthingsalbion.com/en/items/T8_MAIN_AXE), [Dagger](https://allthingsalbion.com/en/items/T8_MAIN_DAGGER), [Fire Staff](https://allthingsalbion.com/en/items/T8_MAIN_FIRESTAFF), [Frost Staff](https://allthingsalbion.com/en/items/T8_MAIN_FROSTSTAFF), [Holy Staff](https://allthingsalbion.com/en/items/T8_MAIN_HOLYSTAFF), [Shield](https://allthingsalbion.com/en/items/T8_OFF_SHIELD), [Tome/Rosalia’s Diary](https://allthingsalbion.com/en/items/T8_OFF_BOOK), [Torch](https://allthingsalbion.com/en/items/T8_OFF_TORCH), [Soldier Armor](https://allthingsalbion.com/en/items/T8_ARMOR_PLATE_SET1), [Scholar Cowl](https://allthingsalbion.com/en/items/T8_HEAD_CLOTH_SET1), [Scholar Robe](https://allthingsalbion.com/en/items/T8_ARMOR_CLOTH_SET1), [Scholar Sandals](https://allthingsalbion.com/en/items/T8_SHOES_CLOTH_SET1).

## D. Habilidades e passivas recuperadas ou corrigidas

A matriz completa de opções de Q/W/E e escolhas passivas por peça está no segundo round, seção D.1; esta seção atualiza especificamente os campos quebrados e diferenças identificadas no terceiro round. Valores de dano/cura são para T8.0 Normal/IP1100 salvo indicação. “Tooltip/IP” significa valor apresentado pela base para a arma equipada; o cliente real ainda pode arredondar.

### D.1. Battleaxe

| Habilidade | Recuperação/correção | Campos que seguem pendentes |
|---|---|---|
| Rending Strike / Rending Spin / Rending Rage | Sangramento compartilhado: ~83 dano físico total por carga em6s; até3 cargas; ao chegar a3, Healing Received do alvo−12% por5s. Rending Rage: ataques das etapas iniciais165 físico e1 carga; 3ª etapa pula ao ponto e dá165 físico, root em raio5m por ~1,61s. | Cadência/ticks do bleed; custos/casts/ranges/CD específicos por etapa de Rage; se carga renova duração e como consumo/reset funciona. O valor83 é escalado publicado, não observação em combate. |
| Internal Bleeding | Raio6m; 193 físico direto. Alvos que se movem sangram66 físico a cada0,5s por até8s. Energia26/CD15s. | Número máximo efetivo de ticks, comportamento se para de mover, renovação e DoT após morte. |
| Raging Blades | Aura raio5m por3s; duas lâminas; 73 magia por0,5s; cada inimigo distinto acertado dá+4% dano, até10 cargas; duração do buff3s. | Como hits repetidos renovam/consomem cargas e ordem de múltiplos alvos. |
| Blood Bandit | Primeira etapa causa528/627/726/825 físico com0/1/2/3 cargas de sangramento; etapa final causa363 físico e cura110/177/243/331, determinada pelo número de cargas do primeiro inimigo atingido. | Se sangramentos são consumidos; escolha de alvo que determina a cura; custos por etapa, limites de cura e cooldown do combo. |
| Passivas | Deep Cuts: a cada4 AA, captura indica55 físico total; Life Leech: cura15% da vida perdida pelo alvo por AA; Increased Defense: a cada5 AA, captura indica+29% resistência/duração2s; Aggressive Rush: a cada4 AA,+8% dano/3s. | Duração atual de Deep Cuts; se Life Leech usa dano efetivo pós-defesa; unidade correta de “resistance”; refresh/stack do buff. |

Fonte principal: [Elder’s Battleaxe](https://allthingsalbion.com/en/items/T8_MAIN_AXE). **Parcial:** não converter 55/29% dos campos antigos em valores finais atuais sem observar o tooltip.

### D.2. Dagger

| Habilidade | Valor/regra atual | Campos pendentes |
|---|---|---|
| Forbidden Stab | 290 físico; alcance2m; instantâneo; interrompe conjuração; nega Healing Received por1,5s; energia24; CD15s. | Quais tipos de canalização interrompe; se bloqueia todo heal ou zera multiplicador; imunidades/purge. |
| Bloodthirsty Blade | Cada AA dá +172 magia vs player /+103 vs mob; cura usuário por100% da vida efetivamente removida por esse bônus; movimento+30%; auto-dano verdadeiro−2,5% vida máxima a cada1s; duração máxima6s, toggle; energia48/CD20s. | Primeiro tick (imediato ou em1s), número máximo de ticks se mantida6s, estado ao cancelar/interromper e se cura da própria lâmina é anterior à morte do alvo. |
| Chain Slash | Máximo3 alvos; alcance inicial6m; cada salto até7m do último alvo; dano publicado379/482/689 conforme 1/2/3 impactos; invisibilidade e imunidade a dano durante saltos conforme a descrição da habilidade. | Se números são dano por impacto ou total cumulativo; colisão/ordem de alvo e diferenças PvP/PvE. |
| Passivas | Deep Cuts por AA a cada4 hits, captura antiga57 físico; Life Leech15%; Auto-Attack Speed+30% por3s após5 AA; Aggressive Rush+6% dano por3s após4 AA. | Duração/ticks atuais de Deep Cuts; confirmar limiares, se stacks renovam e se valores são do slot/item T8. |

Fontes: [Dagger T8](https://allthingsalbion.com/en/items/T8_MAIN_DAGGER), [Bloodthirsty Blade](https://allthingsalbion.com/en/spells/BLOODTHIRSTYBLADE), [Forbidden Stab](https://allthingsalbion.com/en/spells/FORBIDDENSTAB), [Chain Slash](https://allthingsalbion.com/en/spells/CHAINSLASH).

### D.3. Fire Staff — atualizações de valores do arquivo 2025

A pesquisa anterior lista as opções e seus valores preliminares em D.4. Estes são os campos mais úteis recuperados dos placeholders; manter “parcial” onde o tick/alcance/duração está em aberto.

| Skill | Campo recuperado a IP1100 | Pendências indispensáveis |
|---|---|---|
| Fire Bolt | 178 magia direto; burn57 total por4s; até5 cargas; cast0,8s; range13m; energia9. | Intervalo e número de ticks do burn; renovação/acúmulo; projétil e velocidade. |
| Searing Flame | Três acertos de combo:284 mágico + burn126/4s; quarto finalizador574 + burn126/4s; alcance18/20m; cast0,3/0,4s; reset5s. | Tick do burn; custo exato por etapa e se o dano segue 1 alvo ou atravessa; duração do debuff. |
| Flame Blast | Mira primária pode ser inimigo/aliado/self; explosão após1,6s, raio5m; inimigo secundário na área recebe402 magia e alvo primário inimigo +115 adicional imediato; se alvo primário é aliado/self, recebe+60% movimento por1,6s. | Dano exato por alvo, se self pode ser primário em cada modo; alvo morto/fora de posição e cancelamento. |
| Wall of Flames | Parede frontal com largura indicada14m e duração5s; atravessar/encostar aplica burn417 mágico total/4s; interrompe/faz inimigos recuar0,5s. | Espessura, colisão, número de ticks, comportamento com mobs versus players. |
| Fire Wave | Cone frontal alcance12m; dano listado497; +201 contra alvos sob Fire Bolt/Burning Field/Searing Flame; knockback reportado~5,59m; CD12s. | Confirmar se497 é instantâneo, área/ângulo, custo34 e condição de bônus atual. |
| Fire Artillery | Orbes canalizados; range18m; intervalo1,5s; área de fogo6s; cada orbe158 magia em raio3m; DoT43 vs player/16 vs mob por0,5s até4 stacks. | Duração/canalização (captura reporta3s, cast inicial1,5s), quantidade de orbes, dano total, custo/CD atuais. |
| Pyroblast | Dano escalonado publicado em0/0,6/1,2s:402/689/976 magia; alvo/área de explosão raio4m; knockback3,5m se canal completo; alcance15m. | Se estágios são hits separados ou dano final; custo43/CD15; interrupção/cancelamento e número de alvos. |
| Passiva Burn | Cada AA aplica72 magia total/3s. | Ticks/intervalo, acúmulo/renovação e se queimadura pode ser purificada. |

Fonte: [Elder’s Fire Staff](https://allthingsalbion.com/en/items/T8_MAIN_FIRESTAFF). Valores de canais/ticks de algumas habilidades ainda vêm da captura anterior e não devem ser promovidos a atuais sem conferir o timestamp da página específica.

### D.4. Frost Staff — atualizações e Freezing Wind

| Skill | Valor/regra mais recente | Pendência |
|---|---|---|
| Frostbite | Dano293 magia; 1 carga por3s, máximo3; ao chegar à terceira, stun ~1,12s. | Se as cargas expiram juntas, se o stun consome cargas e regras de resistência/imunidade. |
| Frozen Surge | Dano258 magia e slow20% por3s; corredor frontal comprimento16m; largura publicada3,8m. | Largura/forma do indicador no cliente e colisão. |
| Frost Bomb | Slow inicial30% em raio5m; explosão posterior477 magia em raio5m, slow20% por5s; atraso publicado1,6s. | Confirmar raios iguais, timing e se a primeira aplicação pode ser purificada. |
| Frost Beam | Dano90 magia a cada0,3s; canal até2,7s; área de dano reportada raio4m e área de debuff raio5m; slow/AA speed−15%, até5 stacks, dura2s após canal. | Conflito entre raios; total de ticks; custo37/CD15, interrupção e alvo em movimento. |
| Frost Nova | Teleporte até11m; dano201 magia; stun1,4s em raio3m; usuário imune a dano0,2s. Declara não atravessar obstáculos. | Confirmar se raio está centrado na posição inicial ou final; linha de colisão real. |
| Glacial Obelisk | Coloca objeto a até12m; cast0,4s; dura6s; até10 aliados em raio6m recebem+20% damage e cooldown rate; recast causa221 magia e slow40%/4s. | Raio da explosão, custo23/CD16 e cooldown entre colocar/recast; buffs exatos vs self. |
| Freezing Wind | Cone/direção; instantâneo; range12m; 574 magia imediato; root2,8s; energia46/CD18. Não há dano em pulsos nem slow gradual na versão atual. | Largura/ângulo do cone e alvos atingidos quando a mira passa por parede. |

Fontes: [Frost Staff T8](https://allthingsalbion.com/en/items/T8_MAIN_FROSTSTAFF), [Freezing Wind](https://allthingsalbion.com/en/spells/FREEZINGWIND?w=T8_MAIN_FROSTSTAFF), [notas oficiais de balanceamento](https://forum.albiononline.com/index.php/Thread/220920-Update-Changes/). A nota oficial é especialmente relevante para não reutilizar a descrição de 2025 de dano gradual/congelamento.

### D.5. Holy Staff básico — Smite e itens de cura

**Identidade do item:** `Elder’s Holy Staff` / `T8_MAIN_HOLYSTAFF`, Holy Staff comum de uma mão. Não é Lifetouch, Fallen, Hallowfall ou outra versão de artefato.

| Skill | Ficha atual recuperada | Pendência |
|---|---|---|
| Generous Heal | Alvo aliado, alcance15m, cast0,5s, cura201, energia18, CD1,5s; alvo recebe+5% Healing Received por4s, máximo3 cargas. | Autoalvo, duração do stack com recast, ticks não aplicável (cura direta). |
| Smite | Ponto no chão/área, raio2,5m, range13m, cast0,5s, hit delay0,25s; 330 magia vs player/390 vs mob; próximo dano direto no alvo em3s recebe+109 magia; acerto reduz cooldown50%; energia11/CD3s. | Se bônus vale por aplicação/alvo e se DoT/AA acionam; cliente pode arredondar energia. O valor bruto4 da captura não é custo tooltip. |
| Holy Flash | Ponto no chão, raio5m, range13m, cast0,4s + impacto0,4s; cura213 em até10 aliados; energia23/CD3,5s. | Se o próprio caster conta como alvo, ordem de seleção, PvP/PvE e line of sight. |
| Sacred Pulse | Alvo aliado; raio5m ao redor, range13m, instantâneo (stand0,3s); cura81 até5 aliados; dano321 mágico vs player/482 vs mob; empurra player12,58m e mobs por1s; custo32/CD12s. | O dano é centrado no alvo/caster? Regras completas do knockback, alvos elegíveis e LoS. |
| Holy Beam | Só outro aliado; não aceita o próprio usuário; alcance12m, canal3s; conjurador recebe slow30%; cura começa101 e cresce+12 por tick de0,5s, até7 stacks; custo37/CD12s. | Sequência exata de ticks/total959 se forem sete aplicações; o patch de29/06/26 aumentou CD10→12s. Energia37 é o valor publicado atual; confirmar arredondamento no cliente. |
| Holy Blessing | Buff aliado, range13m, +86 Armor e+30% Healing Received por4s; protege contra forced movement; energia23/CD15s. | Quais controles incluem “forced movement”, interação com purge e autocast. |
| Holy Orb | Projétil direcional, range25m; ao colidir com aliado cura raio7m, 272 até10 aliados; energia29/CD15s. | Velocidade, primeiro alvo e colisão com mundo. |
| Reawaken | Mira aliado derrubado, range12m, cast1s; levanta com30% HP máxima; energia66/CD30s, lockout no alvo3min. | Timing completo/condições de interromper. O efeito conflita diretamente com a regra do projeto. |
| Desperate Prayer | Alvo aliado, range13m; cura201 se acima de40% HP e443 se abaixo de40%; ao curar acima do limite, +5% Healing Cast no conjurador por15s, até3 stacks; energia43/CD10s. | Condição exatamente40%, autoalvo, tick/cura final e interação com Healing Sickness. |

**Limite de evidência do Holy Beam:** a base atual consultada mostra energia37; confirmar o arredondamento no cliente antes de congelar o dado. A ficha segue parcial por cadência e por exigir alvo aliado.

Passivas da Holy Staff: `Adrenaline Driven Charity` após4 spells concede+20% Healing Cast/3s; `Energetic` restaura3,6 de energia em AA; `Magic Force` após5 spells, próximo AA empurra (~2,99m) e a captura antiga diz que interrompe cast; `Ascended` é opção, mas efeito atual completo não foi recuperado. Fontes: [Holy Staff](https://allthingsalbion.com/en/items/T8_MAIN_HOLYSTAFF), [Smite](https://allthingsalbion.com/en/spells/SMITE_AOE), [Reawaken](https://allthingsalbion.com/en/spells/REAWAKEN), [Sacred Pulse](https://allthingsalbion.com/en/spells/PULSINGHEAL?w=T8_MAIN_HOLYSTAFF).

### D.6. Conjunto Scholar completo

Os números abaixo são específicos dos itens `SET1`. Não são os do Mage `SET3`. As três peças são T8, Normal, IP1100.

#### Elder’s Scholar Cowl

Atributos de item: HP+269; energia+98; regen HP+2,7/s; regen energia+1,22/s.

| Opção | Alvo/execução | Efeito atual em IP1100 | Custo / recarga / duração | Estado |
|---|---|---|---|---|
| Energizing Shield | Instantânea, self | Escudo505, pré-resistência, por3s; restaura25% da energia que falta | custo0; CD25s | Confirmado pela base atual; UI para arredondamento pendente |
| Force Field | Instantânea com stand time0,5s; onda ao redor, raio6m | Knockback de9m, ignora CCR; dano177 mágico | custo0; CD30s | Parcial: interação com parede/alvos múltiplos e cooldown ao cancelar |
| Aegis of Energy | Instantânea, self | +105 Armor e+28 Magic Resistance por4s; ao receber dano restaura42 energia | custo0; CD30s | Parcial: por hit, por evento ou limite interno; duração da janela de restore |
| Aggression | Passiva contínua do item | +3,5% dano e Healing Cast no Cowl | — | Valor atual por peça; stack global não confirmado |
| Concentration | Passiva contínua do item | −5% tempo de conjuração | — | Soma/multiplicação com Tome e outros buffs pendente |
| Efficiency | Passiva contínua do item | −6% custo de energia | — | Soma/multiplicação e arredondamento pendentes |

Fontes: [Scholar Cowl](https://allthingsalbion.com/en/items/T8_HEAD_CLOTH_SET1), [Energizing Shield](https://allthingsalbion.com/en/spells/ENERGIZINGSHIELD), [Force Field](https://allthingsalbion.com/en/spells/FORCEFIELD), [Aegis of Energy](https://allthingsalbion.com/en/spells/AEGISOFENERGY).

#### Elder’s Scholar Robe

Atributos: Armor133; MR159; CCR127; HP+539; energia+49; dano físico/mágico+40%; Healing Cast+40%; regen HP+5,4/s e regen HP+150%; regen energia+0,61/s e regen energia+12%.

| Opção | Alvo/execução | Efeito atual em IP1100 | Custo / recarga / duração | Estado |
|---|---|---|---|---|
| Mend Wounds | Só usuário; fora de combate; canal7s; movimento próprio−50%; sem dano/ataque durante canal presumido, confirmar | Recupera9% da vida máxima e7,5% da energia máxima por aplicação de1s; a cura não recebe Healing Cast Bonus | energia0; CD30s; provável8 pulsos do dado de effectcount, primeiro timing não observado | Parcial: quantidade/primeiro tick; não usar total até testar |
| Frost Shield | Instantânea, self | +83 pontos Armor/MR por8s; reflete15% do dano recebido como magia; attacker slow40% por2s | energia26; CD40s | Efeito central atual; dano refletido/ordem de mitigação pendente |
| Speed Caster | Instantânea, self | conjuração−50% e custos de energia−70% por8s | energia26; CD30s | Confirmado em página atual/histórico; cumulatividade pendente |
| Aggression | Passiva contínua do item | +8% dano e Healing Cast | — | Valor do chest, não copiar Cowl/Sandals |
| Concentration | Passiva contínua do item | −10% cast time | — | Stack pendente |
| Efficiency | Passiva contínua do item | −12% energy cost | — | Stack pendente |

**Mend Wounds:** a definição atual registra `effectcount=8`, intervalo1s e primeiro intervalo0; isso sugere uma aplicação imediata e depois uma por segundo, com oito pulsos. O total teórico seria72% HP e60% energia máximos, mas isso é **inferência da estrutura de dados**, não confirmação de tooltip/cliente. Usar por enquanto somente o valor por aplicação9%/7,5%.

Fontes: [Scholar Robe](https://allthingsalbion.com/en/items/T8_ARMOR_CLOTH_SET1), [Mend Wounds](https://allthingsalbion.com/en/spells/MENDWOUNDS), [Frost Shield](https://allthingsalbion.com/en/spells/FROSTSHIELD), [Speed Caster](https://allthingsalbion.com/en/spells/SPEEDCASTER).

#### Elder’s Scholar Sandals

Atributos: HP+269; energia+29; regen HP+2,7/s; regen energia+0,37/s; carga máxima+59kg.

| Opção | Alvo/execução | Efeito atual em IP1100 | Custo / recarga / duração | Estado |
|---|---|---|---|---|
| Dodge | Dash/teleporte curto para posição, instantâneo | Alcance5m; imune a dano/debuff/CC por0,8s; +40% movimento por5s (valor de update listado); caminho a conferir | custo0; CD20s | Parcial: trajetória/obstáculo e atualização de movimento |
| Energetic Sprint | Self, instantâneo | +80% velocidade de movimento por5s; restaura11 energia a cada1s | custo0; CD30s | Parcial: número/ordem dos ticks e cancelamento |
| Focused Run | Canal self4,5s | +70% movimento enquanto canaliza; imune a stun/root/slow; restaura11 energia a cada0,5s | custo0; CD30s | Parcial: ações permitidas durante foco e número de ticks |
| Courier | Passiva | +59kg capacidade máxima | — | Confirmado como atributo; sem peso/inventário no projeto é inerte |
| Aggression | Passiva contínua do item | +3,5% dano e Healing Cast | — | Valor dos footwear; não copiar robe |
| Concentration | Passiva contínua do item | −5% cast time | — | Stack pendente |
| Efficiency | Passiva contínua do item | −6% custo energia | — | Stack pendente |

Fontes: [Scholar Sandals](https://allthingsalbion.com/en/items/T8_SHOES_CLOTH_SET1), [Energetic Sprint](https://allthingsalbion.com/en/spells/ENERGETICSPRINT), [Focused Run](https://allthingsalbion.com/en/spells/FOCUSEDRUN), [Dodge](https://allthingsalbion.com/en/spells/DODGE).

### D.7. Armaduras compartilhadas e correções pontuais

| Skill/itens | Confirmação mais nova | Pendência |
|---|---|---|
| Energizing Shield — Mercenary Hood / Soldier Helmet / Scholar Cowl | A ficha Scholar em T8 IP1100 é escudo505/3s; +25% energia faltante; CD25. Não copiar automaticamente o valor entre hats sem comparar AP/IP. | Comparar o valor nos três itens e confirmar se cooldown é idêntico. |
| Mend Wounds — Mercenary Jacket / Soldier Armor / Scholar Robe | Custo0; CD30; canal7s; movimento−50%; 9% HP máx e7,5% energia máx por pulso de1s; fora de combate; Healing Cast não aumenta a cura. | Os pulsos por item podem escalar diferente; validar quantidade/tick/condição fora de combate em cada um. |
| Mercenary Shoes | Opções atuais Dodge / Refreshing Sprint / Break Free | Não há opção `Rush`; Refreshing Sprint continua incompleta na pesquisa. |
| Soldier Armor | Stats e slot groups confirmados em B; Fury stack atual +8% dano e+5% duração CC por stack, máximo8/10s; Taunt tem impacto em player e threat em mob; Spirit Crush/Protective Instinct são PvE | Valores/custo/range/duração integral de Taunt; threat; gatilhos de Fury; passivas. |
| Aegis of Energy | Atual é4s; +105 Armor/+28 MR;42 energia por dano recebido; CD30 | Limite interno e quantos eventos ativam. |
| Howl — Mercenary Hood | Ficha atual publicada: 163 mágico, slow35%/4s, dano causado−30%/4s e interrompe conjuração | Alcance/cone/custo/CD e diferença PvP/PvE não fechados. |
| Break Free — Mercenary Shoes | Dash até12m, remove CC, utilizável sob stun/silence; CD30s, custo0 | Quais efeitos não remove e se dash atravessa obstáculo. |

Dados de armadura consultados em [Mercenary Hood](https://allthingsalbion.com/en/items/T8_HEAD_LEATHER_SET1), [Mercenary Jacket](https://allthingsalbion.com/en/items/T8_ARMOR_LEATHER_SET1), [Mercenary Shoes](https://allthingsalbion.com/en/items/T8_SHOES_LEATHER_SET1), [Soldier Helmet](https://allthingsalbion.com/en/items/T8_HEAD_PLATE_SET1), [Soldier Armor](https://allthingsalbion.com/en/items/T8_ARMOR_PLATE_SET1), [Soldier Boots](https://allthingsalbion.com/en/items/T8_SHOES_PLATE_SET1), Scholar pages cited in D.6.

## E. Capas das cinco cidades

Todas as capas reais básicas T8 são IP1100 e têm stats comuns publicados: **+20 energia máxima; +0,24 energia/s; peso8,5kg; durabilidade50.119**. Nenhuma tem habilidade de mira selecionável; são efeitos automáticos. As páginas atuais expõem definições brutas de cooldown e histórico de tooltip: abaixo separo o valor bruto, o último cooldown de tooltip encontrado e seu estado. O tooltip arquivado não foi observado no cliente 32.040.1; use os valores atuais com confiança provável, não como confirmação direta de interface.

| Capa / passiva | Gatilho e efeito atual | Alvo/área/duração | Recarga, exceções e confiança |
|---|---|---|---|
| **Bridgewatch — Sandstorm** | CastFinished do slot3 da arma (E); gatilho antigo por AA foi substituído em2023. | Aura inimiga raio5m por6s, até25 alvos; dentro aplica slow−40% e CCR−30% por5s, com reaplicação possível. O slow ignora CCR, DR e bônus de duração. | Definição bruta: dummy time74,5s, modifier IP−1,5; último tooltip T8:1:15 em2/04/2021. Não dispara com cooldown da capa ou `hostiledismountdebuff`. E interrompida/falha e PvP/PvE pendem. |
| **Fort Sterling — Untouchable** | Ao receber stun, silence, transformação ou root: limpa efeitos de controle/debuff exceto DoT e concede imunidade por~1s | Self | Definição bruta atual: dummy time168s, modifier de IP−8; último tooltip arquivado T8:2:19 em2/04/2021. Ativa ao receber stun, silence, transformação ou root; imunidade CC por1s; `Time Freeze` stun não dispara. Remove CC/debuff menos DoT; cooldown impede nova ativação. Tooltip atual não observado. |
| **Lymhurst — Energy Reserve** | Depois de lançar habilidade e ficar estritamente abaixo de40% da energia máxima | Self; restaura70% da energia máxima em10s; dados indicam10 parcelas de7% em intervalo1s | Definição bruta atual: dummy time182s, modifier de IP−4; último tooltip T8:3:02 (2/04/2021). O total caiu de80% para70% em20/11/2024; a página não registra mudança posterior de cooldown. Gatilho é `<40%`, não `<=40%`. Definição tem10 incrementos de7%, intervalo1s e primeiro intervalo0. O buff de energia tem categoria Buff e pode ser removido por purges que afetam essa categoria; timing/ordem custo-reembolso e tooltip atual não observados. |
| **Martlock — Shield of Protection** | Evento ReceiveDamage quando HP próprio é estritamente<25% (a descrição curta diz “quando cai abaixo”). | Self; +50% Defense vs players e mobs durante5s; não é HP shield. | Definição bruta atual: dummy time245s, modifier IP−8; último tooltip T8:3:45. Descrição atualizada em26/05/2026 e não purgável; não dispara enquanto mountbuff ou cooldown da capa ativos. Cliente atual/limiar cruzado pendentes. |
| **Thetford — Chain Lightning** | Ataque básico dispara automaticamente no inimigo do ataque | 242 magia por impacto em até4 alvos; cada salto busca o inimigo mais próximo a até9m do último e não repete alvo. | Último cooldown de tooltip arquivado:15s (sem mudança de cooldown posterior encontrada; provável atual). Cliente atual não observado. PvP/PvE, reflect e stack com efeitos de AA pendentes. |

Páginas individuais: [Bridgewatch item](https://allthingsalbion.com/en/items/T8_CAPEITEM_FW_BRIDGEWATCH), [Fort Sterling item](https://allthingsalbion.com/en/items/T8_CAPEITEM_FW_FORTSTERLING), [Lymhurst item](https://allthingsalbion.com/en/items/T8_CAPEITEM_FW_LYMHURST), [Martlock item](https://allthingsalbion.com/en/items/T8_CAPEITEM_FW_MARTLOCK), [Thetford item](https://allthingsalbion.com/en/items/T8_CAPEITEM_FW_THETFORD); spells [Sandstorm](https://allthingsalbion.com/en/spells/PASSIVE_CAPE_BRIDGEWATCH), [Untouchable](https://allthingsalbion.com/en/spells/PASSIVE_CAPE_FORTSTERLING), [Energy Reserve](https://allthingsalbion.com/en/spells/PASSIVE_CAPE_LYMHURST), [Shield of Protection](https://allthingsalbion.com/en/spells/PASSIVE_CAPE_MARTLOCK), [Chain Lightning](https://allthingsalbion.com/en/spells/PASSIVE_CAPE_THETFORD).

## F. Mecânicas gerais verificáveis e limites

### F.1. Vida e energia base

A mecânica atual de personagem nu do Albion, segundo a base comunitária, é **1200 HP e120 energia**. Uma nota oficial histórica de balanceamento registra aumento de1000/100 para1200/120. Regeneração natural publicada na base: **1% da vida máxima por segundo** e **1,5 energia por segundo**. Não localizei confirmação oficial de quando exatamente a regeneração de HP pausa durante combate, se os números têm arredondamento por tick ou se o modo/território aplica exceção. A regra antiga do projeto — personagem nu1000 HP/100 energia — é uma escolha própria e difere do Albion atual.

Fontes: [patch oficial Nimue](https://albiononline.com/news/nimue-balance-patch-is-live), [mecânicas comunitárias atuais](https://allthingsalbion.com/en/mechanics/).

### F.2. Resistência, Defense e controle de grupo

A reconstrução comunitária usa fator de mitigação de resistência `100/(100 + resistência)` para dano físico/mágico e uma função específica para Defense vs players; isso separa resistência em pontos de redução percentual. Exemplo algébrico sob essa fórmula:100 resistência → 50% do dano,200 → 33,3%,50 →66,7%. Não confundir Armor/MR adicionados em pontos, Defense percentual vs Player/Mob e CCR (redução de duração de CC).

A mesma página publica cooldown final `CD_base/(1 + Cooldown Rate)`, e cast time com rate correspondente. É uma fórmula comunitária derivada, não especificação oficial para todas as habilidades. Bônus de dano/cura e suas taxas podem ter caps; a fonte menciona caps, mas as combinações de multiplicadores/ordem não foram verificadas aqui por teste.

### F.3. Dano, cura e escudos

- **Dano de habilidade:** base × AP/100 × fator de IP publicado, salvo fórmulas próprias. PvP e PvE podem aplicar coeficientes distintos: Smite, Sacred Pulse, Fire Artillery e outros mostram splits em páginas atuais.
- **Cura:** a base comunitária descreve `cura exibida × (1 + Healing Cast) × (1 + Healing Received) × (1 − Healing Sickness)`. Não generalizar sem checar habilidade; Mend Wounds declara não ser beneficiada por Healing Cast. A cura escalada por IP tem expoente distinto do dano.
- **Escudo:** Energizing Shield explicita absorção antes das resistências; isso não deve ser presumido para todos escudos. Escudo não é vida nem redução universal.
- **Bônus:** não foi comprovado se cada buff de dano/cura é aditivo ou multiplicativo. Percentuais de passivas e equipamentos não devem ser somados manualmente até definir a ordem de cálculo.
- **Arredondamento:** nenhuma regra global foi confirmada. O banco e a interface podem arredondar números visíveis; dano flutuante pode não revelar coeficiente bruto.

### F.4. Healing Sickness

A fonte comunitária descreve uma penalidade relacionada a múltiplos curadores Holy/Nature dentro de10s, incluindo autocura, e regra própria para acúmulos da autocura Holy: Generous Heal/Holy Flash podem somar cargas; a partir de11 cargas, o Healing Received cai40% por2min; a primeira cura reduzida pode aparecer após a sexta repetição; curar aliado remove o efeito segundo essa página. Isso não foi confirmado em texto oficial atual nem em cliente nesta pesquisa. A cura no PrettierRPG deve seguir a regra de modo já decidida e o dono precisa escolher se importa também essa mecânica.

Fontes: [mecânicas comunitárias](https://allthingsalbion.com/en/mechanics/), [explicação oficial histórica de Healing Sickness](https://albiononline.com/news/percival-midseason-patch-is-here). Confiança média-baixa para limiares e duração atuais.

### F.5. CC, duração, acúmulos e efeitos ao morrer

All Things Albion descreve diminishing returns por tipo de CC: Stun/Root/Silence com acréscimos por aplicação até cap, janelas de reset diferentes para slow/knockback/forced movement/polymorph; CCR reduz duração; há exceções específicas por habilidade. A fonte reconhece interpretação comunitária e muitos efeitos customizados. Não usar uma DR global sem testar os skills da lista.

Acúmulo, renovação e remoção são por habilidade: exemplos explícitos incluem Rending Bleed até3, Raging Blades até10, Generous Heal até3, Frostbite até3, Chain Slash até3 alvos. Para outros DoT/HoT não foi confirmada regra global; também não foi confirmado o que acontece com dano periódico depois da morte do emissor/alvo, ao reaplicar o mesmo DoT, em purificação, reflection e imunidade.

### F.6. Alvos, ataque básico, mira e colisão

- O patch atual permite bind de botões laterais/central do mouse e mudou atalhos para posição física da tecla; perfis novos assumem US QWERTY, e as notas dizem que Linux usa esse layout como pressuposto. Não foi recuperada uma tabela oficial completa de teclas padrão de cada slot.
- Armas usam Q/W/E na nomenclatura dos slots. Isso não valida por si só os binds atuais.
- Cada página de spell ajuda classificar alvo (enemy/ally/ground/self), alcance, cast e atraso; isso não determina todos os casos de seleção e linha de visão.
- Frost Nova declara não atravessar obstáculos. Não generalizar para outras dashes/teleportes/projéteis.
- A pesquisa não confirmou auto-approach ao iniciar ataque básico fora de range; comportamento ao alvo correr, ficar atrás de obstáculo, cancelar seleção e interromper cast também exige cliente.
- Quick Cast / cast no pressionar, no soltar e mira com clique dependem de configuração. Não atribuir o comportamento configurável como default único.

Fonte: [Patch 4 oficial](https://steamcommunity.com/app/761890/announcements/), [spell database](https://allthingsalbion.com/en/spells/), [Frost Staff](https://allthingsalbion.com/en/items/T8_MAIN_FROSTSTAFF).

