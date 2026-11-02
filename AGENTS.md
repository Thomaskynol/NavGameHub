# AGENTS.md — Game Hub

Este arquivo orienta agentes que trabalham neste repositório. O objetivo é entregar mudanças úteis, preservar os jogos e os dados existentes e informar com precisão o que foi realmente validado.

## 1. Contexto e prioridades

O Game Hub reúne jogos de navegador para grupos de amigos. Uma máquina Linux hospeda o Hub e os servidores necessários; jogadores em computadores acessam pelo navegador a partir do endereço do Hub. O projeto deve poder ser transportado em um pendrive NTFS e funcionar pela rede local sem internet depois de preparado.

A versão inicial integra **Asfalto Vivo** (corrida), **VAVA2D** (tiro) e **Catan Deluxe** (tabuleiro). Os jogos têm código e arquiteturas próprios. Outros jogos, inclusive single-player, poderão ser adicionados: não reescreva os existentes em uma stack única por conveniência e não assuma que um jogo novo pode ser integrado apenas copiando uma pasta.

Ordem de referência:

1. Instruções atuais e específicas do usuário.
2. `Docs/PRODUTO.md`, com requisitos e critérios de aceite. Confirme o nome e a capitalização no repositório.
3. Este arquivo e instruções mais específicas aplicáveis aos diretórios envolvidos.
4. `Docs/INTEGRACAO_JOGOS.md`, `hub/PROTOCOLO.md`, README, scripts, testes e código para entender a implementação atual.

Documentação e código podem divergir; investigue a divergência. Não apresente uma decisão operacional provisória como uma preferência confirmada pelo usuário. Se uma escolha afetar significativamente o produto e não houver contexto suficiente, explique as alternativas e pergunte; resolva escolhas técnicas rotineiras com julgamento e registre as relevantes.

Antes de trabalhar, identifique a raiz, leia as instruções pertinentes e confira branch, commit e estado do Git. Investigue os componentes afetados e o caminho real que os usuários percorrem. Preserve alterações preexistentes e arquivos pessoais; não presuma que arquivos não rastreados são descartáveis.

## 2. Skills e forma de trabalho

- Use as skills **obra/superpowers** e **Planning with Files** disponíveis no ambiente do OpenCode. Descubra seus nomes e instruções reais no catálogo do ambiente; não invente nomes, conteúdo ou execução de skills.
- Aplique as práticas pertinentes das skills à tarefa, especialmente investigação da causa, planejamento, implementação incremental, testes e verificação antes da entrega. Para tarefa não trivial, use Planning with Files para manter plano, progresso e evidências no local indicado pela skill ou pela convenção do projeto, sem sobrescrever arquivos existentes. Para alteração pequena, mantenha o processo proporcional.
- Instruções explícitas do usuário prevalecem sobre orientações genéricas das skills. Caso uma skill não esteja disponível, registre qual faltou e prossiga com as práticas equivalentes aplicáveis; não finja tê-la executado.
- Para uma mudança não trivial, identifique comportamento esperado, componentes e fronteiras afetadas, riscos e como observar o resultado antes de implementar. Implemente em incrementos verificáveis; corrija a causa, não apenas o sintoma. Evite refatorações extensas, abstrações e dependências sem justificativa.
- Preserve a jogabilidade, controles, modos, opções, interface própria e funcionamento independente dos jogos, salvo mudança autorizada ou necessária e explicada. Não substitua um jogo por uma simulação ou demonstração reduzida.

## 3. Invariantes do produto

Use o produto como fonte detalhada; ao mexer nas áreas abaixo, preserve e valide os comportamentos relevantes:

- **Identidade e salas:** apelido simples e único em todo o Hub enquanto ocupado; entrada por código ou lista; anfitrião, participantes, jogo, capacidade e prontidão coerentes. Se o anfitrião sair, outro assume; sala vazia é removida.
- **Capacidade:** a capacidade configurada não excede o máximo do jogo selecionado e não fica abaixo da ocupação. Ela inclui quem está esperando. Para trocar para jogo com máximo menor, primeiro é preciso reduzir a capacidade respeitando a ocupação; nunca expulsar pessoas ou mudar capacidade silenciosamente. O servidor deve impor as regras, inclusive em entradas simultâneas.
- **Ciclo da partida:** jogadores ficam prontos no Hub e entram na mesma partida. Preparação, modos, mapas, equipes e eventual segundo pronto permanecem no jogo. Entrada durante a partida depende do suporte real; quem não puder jogar aguarda na sala se houver vaga. Ao fim, o grupo retorna à mesma sala do Hub.
- **Isolamento e concorrência:** várias salas e partidas podem coexistir, inclusive no mesmo jogo, sem limite global artificial de quantidade. Participantes, códigos, eventos, resultados e limpeza não podem cruzar grupos. Considere reserva/criação concorrente, colisões, mudanças de fase, mensagens atrasadas e retomadas legítimas.
- **Falha e continuidade:** trate erros de servidor, timeouts, desconexões, recursos pendentes e reinícios de forma clara e recuperável, conforme o contrato implementado e o produto. Não apresente erro como término normal nem garanta reconexão não validada.
- **Interface:** identidade arcade, colorida, neon e fortemente cyberpunk, com boa legibilidade, estados e erros claros em navegadores de computador. Os jogos preservam seus próprios visuais.

## 4. Integração, dados e operação

- O Hub e os jogos são componentes distintos. Ao alterar integração, acompanhe a cadeia completa aplicável: sala do Hub → seleção e criação da partida → estado/propriedade → entrada dos clientes → jogo → fim → retorno e limpeza. Confira produtores **e** consumidores de cada contrato, incluindo status HTTP, campos, erros e reintentos.
- Códigos de sala, tokens de instância e sessões têm papéis distintos. Não associe uma partida apenas porque um código existe; não faça entrada cega após colisão. Um fechamento atrasado não pode remover uma partida de outro dono ou uma sala independente. Uma retomada legítima não deve duplicar jogadores.
- Respostas de estado precisam distinguir corretamente inexistência, conflito, indisponibilidade e outras condições relevantes. Um cliente que recebe erro não implica que o Hub o tenha recebido. Em particular, se um código histórico for recusado na criação, verifique que **o próprio Hub** toma a ação esperada sem apagar dados ou deixar o grupo preso.
- Preserve bancos, chats, recursos e arquivos do usuário. A ausência de requisito de histórico de partidas ou de histórico Git antigo não autoriza apagar dados existentes. Migrações devem ser compatíveis com versões anteriores pertinentes, atômicas quando aplicável e testadas com bancos temporários, falha e reabertura. Não teste falhas destrutivas no banco real.
- O servidor precisa ser acessível a clientes pela rede local, inclusive no anfitrião. Após a preparação, Hub e jogos devem funcionar sem internet. Não acrescente dependência obrigatória de CDN, fonte externa, autenticação ou API remota durante o uso.
- O alvo é Linux, especialmente openSUSE Tumbleweed, Debian e Linux Mint, usando runtimes disponíveis na máquina. Verifique e documente versões e dependências reais; não presuma que todo Linux tenha Node.js, npm ou Python. Não dependa de caminhos pessoais ou de um ponto de montagem fixo.
- NTFS, permissões, `exec`, links simbólicos, dependências nativas e diferenças entre máquinas podem afetar o pendrive. Não prometa compatibilidade a partir de um teste em outro filesystem: valide o ambiente real quando disponível e registre as condições.
- Preserve inicialização e encerramento seguros: portas configuradas devem chegar a todos os componentes; não sinalize processos alheios por PID antigo; não deixe serviços, salas ou recursos órfãos. Não altere firewall, roteador, instalações globais ou configurações do sistema sem autorização adequada.
- Fontes, builds e processos em execução podem estar em versões diferentes. Identifique qual artefato o comando de uso efetivamente executa. Após alterar fontes, gere os builds afetados e valide esses builds quando o fluxo de produção depender deles. Não considere que `dist` ausente ou antigo está atualizado só porque o código-fonte passou nos testes.

## 5. Qualidade da implementação

- Prefira código simples, legível e consistente com as convenções locais. Verifique a causa e os efeitos nos três jogos quando a alteração mudar um contrato comum; implemente só o que a tarefa exige.
- Valide entradas e imponha invariantes no servidor, não apenas na interface. Trate estados inesperados, falhas parciais e concorrência sem ocultar erros ou reportar sucesso prematuramente.
- Evite caminhos absolutos pessoais em código, scripts e testes. Testes e ferramentas devem apontar para a cópia do projeto em execução, não uma cópia antiga no computador de desenvolvimento.
- Não duplique regras sem necessidade, não remova funcionalidades para facilitar testes e não mude o contrato silenciosamente. Atualize os consumidores e a documentação quando a mudança alterar o comportamento.
- Mantenha segredos fora de código versionado, relatórios e logs compartilhados. Não registre identificadores ou dados pessoais desnecessários.

## 6. Validação: resultado de teste não é aceite automático

Planeje a validação a partir do **comportamento esperado** e dos riscos, não apenas dos arquivos modificados. Um teste verde prova somente o que suas ações e asserções observam. Antes de usar um teste como evidência:

1. Leia seu cenário e suas asserções. Confira se exercita o componente, a versão e o caminho reais que a conclusão menciona.
2. Verifique se uma etapa atribuída ao sistema foi de fato realizada por ele. Exemplo: criar manualmente uma segunda sala prova que ela pode ser criada; não prova que o Hub detectou o conflito e tentou novamente.
3. Em regressões e concorrência, force o estado ou a intercalação relevantes de forma controlada e confira também efeitos colaterais: grupo alheio intacto, dados preservados, ausência de duplicatas e estado recuperável. Quando viável e seguro, demonstre que o teste detecta a falha anterior; explique se não puder.
4. Confira que os testes fazem parte do comando agregado que se afirma ter executado. Detecte testes não descobertos, skips, erros apenas registrados em log, comandos inexistentes, caminhos de outra cópia e uso de código ou build antigo.
5. Para mudança em contrato, teste as duas pontas e o fluxo integrado afetado: sucesso, erro, resposta incompleta ou incompatível, repetição e falha parcial, conforme o risco. Fakes são úteis para controlar condições; não os descreva como servidor ou jogo real.

Use testes proporcionais e relevantes; não escreva testes apenas para espelhar a implementação. Execute os comandos necessários após a última mudança relevante e preserve o código de saída real. Evite pipelines que mascarem falha; registre comando, resultado e skips. Uma execução anterior a alterações posteriores ou em outra cópia não valida o estado final.

Diferencie sempre:

- teste unitário, fake e simulação controlada;
- protocolo com servidor real;
- navegador isolado com ações reais;
- hook/fixture que força estado ou final;
- jogo concluído por regras naturais;
- fluxo completo Hub → jogo real → término → retorno à mesma sala;
- teste em localhost, LAN com dois computadores e execução sem internet;
- teste no filesystem e distribuição reais versus somente leitura estática ou ambiente aproximado.

Um teste com hook pode validar transições, mas não prova partida completa. Bloquear URLs no navegador não prova, sozinho, ausência de rede externa no servidor ou nos demais jogos. Inspecionar referências externas não prova uso offline em execução. Quando o ambiente permitir, valide cada jogo e os componentes relevantes sem internet, mantendo a LAN necessária.

Para browser, use perfis e contextos isolados, preferencialmente headless, separados do Firefox e dos perfis pessoais do usuário. Falhas inesperadas de página e recursos necessários precisam influenciar o resultado do teste; exceções devem ser específicas e justificadas. Não abra abas no navegador pessoal para automação.

Use os comandos existentes, como `npm test` e `npm run e2e`, conforme seu escopo real; consulte os scripts antes de afirmar o que cobrem. Em alterações de integração, acrescente a verificação ponta a ponta relevante. Se faltarem dependências ou condições para um teste, avance no restante e informe a pendência concreta: não substitua silenciosamente a execução por leitura de código.

## 7. Git, entrega e comunicação

- Preserve alterações preexistentes. Não use `git reset --hard`, `git clean`, exclusões amplas, remoção de `.git` aninhado ou operações equivalentes sem autorização específica. Evite registrar jogos como submódulos/gitlinks por acidente.
- Use um único repositório geral quando aplicável. Não invente identidade Git nem altere configuração global. Faça commit local se solicitado ou autorizado; confira o conteúdo antes. Não faça push, PR, publicação ou deploy sem pedido explícito.
- Ao final, relate o que mudou e por quê; o comportamento observado; comandos e resultados relevantes; o que não foi executado e a razão; e o estado do Git quando pertinente. Informe falhas, skips, uso de fakes/hooks e limites de ambiente com clareza.
- Só declare um requisito concluído quando a evidência cobrir o cenário exigido. Se houver pendências, identifique o que já funciona, o que segue não comprovado, seu impacto e o próximo passo concreto. Não apresente um resumo, uma suíte verde ou um relatório como prova de comportamento que não foi exercitado.
