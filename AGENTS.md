# Instruções para agentes — Game Hub

## Propósito e fonte de requisitos

Este repositório contém um Game Hub para reunir jogos de navegador e jogá-los em grupo pela rede local. O projeto é hospedado em Linux e deverá funcionar a partir de um pendrive NTFS, inclusive sem internet depois de preparado.

- Leia o documento de produto em `Docs/` antes de propor ou alterar comportamentos. Confira a grafia real de `produto.md`/`PRODUTO.md`: Linux diferencia maiúsculas de minúsculas.
- `Games/` contém os jogos existentes. Descubra suas tecnologias, regras, limites, dependências e instruções no próprio código; não os invente.
- Siga também instruções mais específicas dos diretórios afetados, quando existirem e forem compatíveis com as instruções atuais do usuário.
- Mantenha separadas as decisões confirmadas no produto e as suposições ou escolhas de implementação. Se precisar decidir algo não especificado, use uma solução coerente, registre-a e não atribua a decisão ao usuário.
- Estas instruções não substituem o documento de produto. Caso haja conflito, siga a instrução mais recente e específica do usuário e registre a divergência relevante.

## Como trabalhar neste projeto

- Trabalhe na raiz e nas pastas já existentes, preservando arquivos e alterações que não fazem parte da tarefa. Entenda o estado atual antes de editar.
- É permitido adaptar os códigos em `Games/` quando necessário para integração ou para a tarefa solicitada. Preserve a jogabilidade, os modos, os controles, as opções e os recursos dos jogos, salvo quando o usuário pedir outra coisa.
- Não substitua um jogo por uma versão reduzida, uma página demonstrativa ou uma simulação. Se algo não puder ser preservado, identifique o impacto e não declare a integração completa.
- Os jogos podem usar linguagens, servidores e arquiteturas diferentes. Não reescreva todos em uma stack única por conveniência. Favoreça interfaces de integração claras e mudanças proporcionais ao problema.
- Organize o código para que seja possível incluir jogos no futuro sem uma alteração espalhada por todo o projeto. Jogos futuros podem ser multiplayer ou single-player; não presuma que todos tenham a mesma estrutura.
- Evite refatorações amplas e novas funcionalidades que não contribuam para a tarefa. Prefira soluções legíveis, manutenção simples e dependências justificadas.

## Comportamentos essenciais

- A identidade do jogador usa apelido simples, único no Hub enquanto ocupado. A identidade e a sala devem acompanhar o jogador ao entrar no jogo e ao retornar.
- Uma sala tem código, anfitrião, jogo, capacidade, participantes e estado de prontidão. É possível entrar pelo código ou pela lista de salas.
- A **capacidade configurada da sala** não pode exceder o máximo do jogo selecionado. Não confundir capacidade configurada com número de jogadores presentes. A capacidade também não pode ser reduzida abaixo do número de pessoas que estão na sala.
- O servidor deve validar as regras e impedir que entradas simultâneas ultrapassem a capacidade; não dependa somente de verificações na interface.
- Ao sair o anfitrião, outro participante assume automaticamente se houver alguém. Salas e recursos que não estiverem mais em uso devem ser limpos adequadamente.
- O grupo fica pronto no Hub e é encaminhado à partida correta. O jogo pode ter sua própria preparação e solicitar um segundo pronto. Manter as opções específicas na interface do jogo.
- O ingresso em uma partida em andamento depende do suporte real do jogo; se não houver suporte, quem entrar na sala com vaga aguarda a próxima partida. Quem espera também ocupa vaga.
- Ao final, o grupo retorna à mesma sala do Hub, incluindo quem aguardava. Salas e partidas simultâneas devem permanecer isoladas, inclusive em instâncias do mesmo jogo.
- Não impor um limite global artificial de salas. Limites de jogos individuais e limites reais de recursos continuam existindo.

## Rede, Linux e pendrive

- O servidor deve poder ser acessado por navegadores de outros computadores que alcancem o anfitrião na rede, não apenas por `localhost`. Os usuários partem do endereço do Hub e não devem precisar descobrir portas internas dos jogos manualmente.
- Após a preparação, o Hub e os jogos devem funcionar na rede local sem internet. Não dependa, durante o uso, de CDNs, fontes remotas, autenticação externa ou APIs públicas.
- Considere openSUSE Tumbleweed, Debian e Linux Mint, usando os runtimes disponíveis no sistema e documentando dependências e versões realmente necessárias.
- Evite dependência de caminhos absolutos do computador de desenvolvimento, permissões executáveis presumidas, links simbólicos ou outras características não garantidas em um pendrive NTFS. Teste as condições reais quando disponíveis e relate limitações.
- Inicialização e encerramento devem ser documentados. Ao gerenciar servidores ou processos auxiliares, evite processos órfãos, conflitos de porta e recursos abandonados.
- Não publique o serviço, abra portas no roteador, altere o firewall, modifique configurações globais do sistema ou instale dependências globalmente sem solicitação ou necessidade devidamente autorizada.

## Interface

O Hub deve ter identidade **arcade, colorida, neon e fortemente cyberpunk**, com acabamento visual caprichado, hierarquia clara e texto legível. Catálogo, salas, estados, erros e controles devem comunicar o que está acontecendo. Os jogos podem manter seus próprios visuais. Recursos gráficos, fontes e bibliotecas necessários ao uso devem estar disponíveis offline.

## Git e integridade

- O projeto usa um repositório Git geral na raiz. Não transforme os jogos em submódulos ou gitlinks acidentalmente; os arquivos necessários devem ser versionados no repositório geral.
- Antes de operações Git, inspecione o estado existente. Preserve alterações, arquivos não rastreados e arquivos relevantes dos jogos. Não use `git reset --hard`, `git clean` ou exclusões amplas para resolver problemas sem autorização específica.
- Não remova metadados `.git` de jogos arbitrariamente. Na migração inicial, isso só deve ser feito após inspeção e autorização do usuário, preservando os arquivos necessários; o usuário informou que não precisa dos históricos antigos.
- Configure exclusões com cuidado: não ignore código, assets ou uma pasta de build que seja a única fonte disponível de algum jogo. Não versione segredos, caches ou dependências baixadas desnecessariamente.
- Use commits locais quando fizer sentido e houver identidade Git configurada. Não invente identidade nem altere a configuração global. Não faça push, PR, publicação ou deploy sem pedido explícito.

## Testes e evidências

- Execute verificações proporcionais às mudanças, incluindo testes das regras críticas e das integrações alteradas. Um build, uma resposta HTTP ou uma captura de tela não prova uma partida multiplayer funcional.
- Para fluxos de navegador, use automação ou navegador controlado com **perfil isolado**, separado do Firefox e dos perfis pessoais do usuário. Não abra abas no navegador pessoal para testes.
- Em mudanças no fluxo principal, verifique com múltiplos clientes reais a criação/entrada em sala, prontidão, jogo, retorno, regras de capacidade e isolamento entre partidas, conforme aplicável.
- Preserve e confira o código de saída real dos comandos de teste. Ao usar pipelines, não mascare falhas com `echo`, `tail` ou comandos posteriores; registre o comando e o resultado verificável.
- Teste o uso offline com a rede local necessária disponível; diferencie bloquear recursos externos no navegador de uma verificação completa também do servidor.
- Não declare testados uma distribuição, um pendrive NTFS, um segundo computador ou uma partida completa quando só houver teste simulado, `localhost` ou outro ambiente. Registre o que foi feito, o resultado e as limitações.
- Ao encerrar uma tarefa, informe mudanças relevantes, comandos e resultados de validação, estado do Git e pendências concretas. Não esconda falhas nem afirme conclusão de critérios que não foram atendidos.
