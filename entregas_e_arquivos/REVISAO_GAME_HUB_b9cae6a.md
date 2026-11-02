# Revisão independente — Game Hub

**Veredito: ainda não aprovado como implementação concluída.** Há falhas reproduzidas em isolamento de partidas e na segurança operacional do encerramento, além de lacunas relevantes de teste para o cenário do produto.

## Escopo, identidade e limites

- Pacote recebido: `GAME_HUB_REVISAO.zip`, SHA-256 `a6f4a3ff7c27726eb4b4f1c3bcd8600f4fa93f0d12132d392baec1f8a8feae6d`. Hash confere com o informado; ZIP íntegro; 248 arquivos do manifesto verificados.
- O relatório do pacote informa commit `b9cae6a` e árvore limpa. Como `.git/` foi omitido, **não foi possível verificar independentemente o commit ou o estado do repositório original**. O relatório também informa que o build do cliente VAVA incluído é anterior à última correção do seu código-fonte.
- A revisão usou cópias locais extraídas; o projeto do usuário não foi alterado.
- O pacote não contém `node_modules`. Para executar testes do Hub e Arcade, uma cópia de trabalho usou um adaptador de revisão que expõe o `ws` embutido no Playwright do ambiente. Ele não comprova a instalação exata do lockfile. Os seis testes da simulação compartilhada do VAVA rodaram com a transformação de TypeScript do Node 24 e um resolvedor temporário, não com o comando original via `tsx`.
- Não havia navegador Chromium executável, dependências completas de Catan/VAVA, segundo computador, pendrive NTFS ou outras distribuições disponíveis na revisão. Portanto **não foi executado o fluxo gráfico completo**, nem foi validado o ambiente de uso final.
- As sondas independentes são fornecidas separadamente em `SONDAS_GAME_HUB_b9cae6a.zip`. Foram executadas contra a cópia da revisão. São reproduções de falhas: exit 0 nelas significa que o comportamento problemático apareceu, não que o produto passou no aceite.

## Resultado geral da arquitetura

A separação entre Hub e servidores dos jogos é uma abordagem possível para stacks diferentes. O problema principal está no **contrato de posse e ciclo de vida** das salas, partidas e processos: códigos são verificados e criados em operações separadas, o encerramento se baseia apenas em PID ou código, e ações atrasadas podem perder contexto. Esses pontos tornam o isolamento e a limpeza frágeis.

`hub/server.js` possui 1.562 linhas e concentra estado, sessões, regras, chamadas HTTP, controle de ciclo de vida e transporte; `hub/public/app.js` possui 1.854 linhas. Tamanho, por si só, não é defeito nem exige reescrita. A concentração, porém, dificulta verificar interações entre responsabilidades, como mostram as falhas abaixo. Prefira correções direcionadas e extrações úteis, com testes, a uma refatoração geral sem necessidade.

## R1 — ALTO: `stop.sh` pode encerrar um processo que não é do Hub

**Evidência:** `start.sh:81-95` aceita PID vivo como prova de que o serviço já existe; `stop.sh:13-35` lê um número de `.run/pids/` e envia sinais ao PID/grupo sem confirmar a identidade do processo. PIDs podem ser reutilizados, especialmente ao reiniciar o computador ou transportar o pendrive com `.run/` persistida.

**Reprodução independente:** copiei `stop.sh` para um diretório temporário, iniciei um `sleep` descartável de minha propriedade e gravei apenas seu PID como um PID antigo do Hub. `stop.sh` retornou `0`, afirmou que o Hub foi encerrado e matou o processo de teste com SIGTERM. Nenhum processo real do usuário foi atingido.

**Correção esperada:** associar os metadados à instância e à identidade real do processo, inclusive início/boot ou mecanismo equivalente. Se o PID estiver obsoleto ou não houver certeza da posse, não enviar sinal a ele; limpar ou reportar os metadados com segurança. Encerrar corretamente apenas os processos que pertencem à instância iniciada. Cobrir PID reutilizado, metadados de outro boot/máquina, PID inexistente, inicialização duplicada e ciclo normal start/stop.

## R2 — ALTO: colisão de códigos em lançamentos simultâneos mistura grupos

**Evidência:** em `hub/server.js:598-603` a verificação observa apenas `room.match`; em `hub/server.js:847-875` o código é verificado, uma chamada HTTP assíncrona é aguardada e só depois é atribuído. Duas salas que iniciam ao mesmo tempo podem passar pela verificação antes de qualquer uma reservar o código. O cliente do Arcade trata `CODE_TAKEN` como sinal para entrar na sala existente (`Games/ArcadeAI_race_game/public/js/main.js:496-503`); Catan e VAVA têm comportamento equivalente.

**Reprodução independente:** forcei, no processo de teste, o mesmo candidato para dois lançamentos e segurei as respostas das duas verificações de disponibilidade para obter a intercalação concorrente. Duas salas diferentes do Hub receberam o mesmo código. No servidor **real** do Arcade, o primeiro cliente criou a sala, o segundo recebeu `CODE_TAKEN` e, seguindo a sequência de fallback do cliente, entrou na mesma sala: a lista passou a conter participantes dos dois grupos. A sonda usa clientes de protocolo e uma barreira HTTP controlada; não é uma execução em navegador nem a alegação de que uma colisão aleatória ocorreu no uso real.

O teste existente de isolamento (`hub/test/launch.test.js:275-306`) inicia uma sala após a outra e usa um jogo falso; ele não força os dois candidatos iguais nem a concorrência descrita.

**Caso relacionado no Catan:** `Games/Catan/src/server/db.ts:148-152,171-172` exclui salas fechadas da lista de salas abertas, mas considera seus códigos ainda ocupados no SQLite. Reproduzi em SQLite em memória: uma sala fechada não aparece em `loadOpenRooms`, mas `roomCodeExists` continua `true`. O endpoint do estado usa apenas sala aberta (`src/server/http.ts:88-93`), enquanto criação consulta o código no banco (`src/server/handlers.ts:206-211`). Assim, a cadeia 404 → código aparentemente livre → `CODE_TAKEN` pode ocorrer; a falha completa pela interface não foi executada nesta revisão.

**Correção esperada:** reserva/atribuição atômica por instância de partida e verificação de propriedade no servidor do jogo. Diferenciar retentativa legítima da mesma partida de uma colisão com outra sala; não fazer join cego com base apenas no código. Cobrir também códigos históricos do Catan, liberação, timeout e fechamento tardio que não pode encerrar outra partida que reutilizou um código.

## R3 — ALTO: sala do jogo pode ficar órfã ao sair após os resultados

**Evidência:** `hub/server.js:998-1021` devolve a sala ao lobby, apaga `room.match` e agenda o fechamento do jogo. Se os últimos jogadores saírem antes do temporizador, `destroyRoom` chama `clearRoomTimers`, que cancela o fechamento; como `room.match` já é nulo, também não chama `closeGameRoom` (`hub/server.js:299-324`).

**Reprodução independente:** usei o Hub real com um servidor de jogo controlado que implementa o protocolo. Após resultados e retorno ao lobby, os dois jogadores saíram antes do atraso de fechamento. A sala do Hub sumiu, mas a sala do jogo continuou existindo após o prazo; houve **zero** requisições de fechamento. Foi um teste de integração com jogo controlado, não uma partida completa em Catan.

No Catan, a desconexão normal apenas marca a pessoa como desconectada (`Games/Catan/src/server/handlers.ts:764-775`), enquanto o fechamento pelo Hub é o caminho que fecha e retira a sala (`handlers.ts:685-705`). Isso torna a falta de limpeza especialmente relevante para a persistência, embora eu não tenha repetido este cenário no servidor real do Catan.

**Correção esperada:** a limpeza pendente deve sobreviver à remoção da sala do Hub ou ser executada de forma segura nesse momento, respeitando a identidade da partida. Validar saída imediatamente antes/depois do prazo, várias partidas sucessivas e falhas/repetições do pedido de fechamento.

## R4 — MÉDIO: retomada do Arcade pelo Hub não reaproveita a sessão do jogo

**Evidência:** o caminho normal de boot do Arcade tenta restaurar `sessionStorage`, mas o modo Hub retorna antes dessa lógica (`Games/ArcadeAI_race_game/public/js/main.js:944-956`). `bootHub` faz create/join, e `startJoin` envia join sem o token `resume` (`main.js:759-787,959-968`). O Hub reenvia `play` com `create=0` na reconexão (`hub/server.js:493-505`).

**Reprodução independente:** no servidor real do Arcade, preenchi uma sala de seis pessoas e desconectei uma, mantendo sua vaga de reconexão. Um join novo com o mesmo nome e sem token recebeu `FULL`; usando o token original, entrou como o mesmo jogador. A interação de navegador e o recarregamento do iframe não foram reproduzidos aqui; a ligação com o modo Hub foi verificada por leitura do cliente.

**Correção esperada:** quando uma sessão do jogo ainda for válida e pertencer à mesma partida, retomar a identidade/vaga com o mecanismo próprio do jogo, sem criar duplicata. Tratar sessão expirada de forma honesta; não prometer restauração de jogos que não a implementam. Cobrir sala cheia, nome/partida corretos e recarregamento ou reconexão no navegador isolado.

## R5 — MÉDIO: pessoa aguarda no Hub enquanto o jogo ainda aceita jogadores no lobby

**Evidência e reprodução:** o Hub altera a fase para `playing` assim que a sala do jogo existe (`hub/server.js:912-925`). Uma entrada posterior é marcada como `waiting` exclusivamente por `midMatchJoin` (`server.js:683-705`), mesmo se o estado do jogo informar que está no lobby e `joinable=true`.

Com Hub e servidor reais do Arcade, criei uma sala de capacidade 3 com dois jogadores. Antes de a corrida começar, o endpoint do jogo informou `{phase:"lobby", joinable:true, players:2}`. Uma terceira pessoa entrou no Hub e recebeu `role:"waiting"`, sem receber `play`.

O produto pede que a pessoa entre quando o jogo permitir e aguarde quando não permitir. Convém ajustar o fluxo para distinguir **preparação ainda aberta** de uma corrida/partida que já começou e usar o estado efetivo do jogo; preserve a capacidade e as regras próprias de pronto. O teste `hub/test/e2e/flow3-midmatch.mjs:15-48` chama esse cenário de partida em andamento, mas não inicia a corrida antes de verificar a espera.

## R6 — MÉDIO: queda de pessoa não pronta pode iniciar a partida imediatamente

**Evidência:** `hub/server.js:457-469,810-819` chama `maybeAutoStart` na desconexão e considera apenas participantes conectados.

**Reprodução independente:** uma sala tinha três pessoas: duas prontas e uma não pronta. Ao desconectar a terceira, a sala entrou imediatamente em `launching`, mesmo mantendo a terceira pessoa na lista como desconectada e não pronta durante o prazo de graça.

O produto diz que todos dão pronto, mas não detalhou a política para uma queda temporária. É uma divergência operacional que merece ser corrigida ou explicitamente decidida: uma opção conservadora é não começar enquanto um participante não pronto ainda mantém sua vaga durante a graça e reavaliar após a saída/expiração. Não confundir desconexão temporária com saída definitiva.

## R7 — MÉDIO: porta configurada do jogo não chega ao Hub

**Evidência:** `README.md:31` e `start.sh:22-25,128-131` anunciam `ARCADE_PORT`, `VAVA_PORT` e `CATAN_PORT`, mas o Hub lê as portas fixas de `hub/games.json` e usa `game.port` tanto nos URLs de navegador quanto nas sondas (`hub/server.js:1037-1060`). Não há aplicação dessas variáveis ao manifesto carregado.

**Reprodução independente:** disponibilizei um serviço HTTP controlado em uma porta efêmera, com health HTTP 200, e defini essa porta em `ARCADE_PORT`. O Hub continuou passando `8091` à sonda de saúde e apresentou Arcade como offline. A sonda portátil observa a porta via callback de saúde controlado; a chamada padrão ao health também usa `game.port`, como mostra o código.

**Correção esperada:** garantir uma fonte coerente de portas para processos, health, endpoints e URLs enviadas ao navegador; testar também conflito de porta e manutenção dos padrões. Ou remover explicitamente o suporte anunciado, se o usuário decidir que não precisa dele.

## R8 — MÉDIO: falha de servidor de jogo deixa a sala presa em `playing`

**Evidência:** `hub/server.js:957-984` encerra após respostas 404 repetidas, mas não trata `state.kind === 'error'`, que inclui conexão recusada, timeout e respostas de erro. O temporizador continua indefinidamente.

**Reprodução independente:** iniciei o Hub real e um jogo controlado, alcancei `playing` e encerrei o endpoint do jogo. Depois de múltiplas verificações com tempos acelerados, a sala continuou `playing`; o anfitrião recebeu `BAD_PHASE` ao tentar mudar o jogo. O teste não simulou uma pane de rede física.

**Correção esperada:** detectar indisponibilidade persistente, informar que houve falha — sem fingir término normal — e permitir recuperar o grupo em uma sala utilizável ou outra política de recuperação explícita. Evitar encerrar por um único erro transitório.

## R9 — MÉDIO: testes E2E não são executáveis e confiáveis como suíte única

- `package.json:17` define `npm run e2e` como `node test/e2e/run.mjs`; esse arquivo não existe no pacote. Executei o comando e ele terminou com `MODULE_NOT_FOUND`, exit 1. A pasta existente é `hub/test/e2e/`.
- `hub/test/e2e/run-all.mjs:1-15` exclui `flow6-catan.mjs`, citando um bug anterior. Mesmo que a correção atual tenha resolvido esse bug, o agregador continua sem incluir o fluxo Catan.
- `hub/test/e2e/e2e-helpers.mjs:5`, os verificadores de navegador e `flow6-catan.mjs:6` dependem de caminhos absolutos específicos do computador do desenvolvedor. Isso impede reproduzir a suíte em outro caminho de montagem do pendrive sem adaptações.
- Os verificadores registram `pageerror` apenas em log (`verify-arcade-browser.mjs:19`, `verify-catan-browser.mjs:21`, `ui-smoke.mjs:19`); esses erros, isoladamente, não tornam o resultado negativo.
- As evidências do próprio pacote admitem que todos os finais foram forçados por hooks. `verify-arcade-browser.mjs:51-75` não inicia nem joga uma corrida antes do hook. `flow1-arcade-loop.mjs:45-65` cria/entra via protocolo e força o resultado. Isso pode testar transições, mas **não prova jogabilidade nem término natural**.

**Correção esperada:** criar um comando de E2E executável e portável a partir da raiz, incluir os três jogos e verificar a integridade da suíte. Tratar erros inesperados de página e requisições necessárias como falhas, com exceções justificadas. Separar provas com hooks de provas de jogabilidade real. Executar o smoke de corrida completa do Arcade ou explicar com evidência um teste equivalente; testar movimentos/ações reais e término por regras normais sempre que possível.

## R10 — MÉDIO: pré-requisito de Node anunciado com precisão insuficiente

`package.json:7-8` e o pacote do Catan exigem `node >=22.13`, enquanto `prepare.sh:20-29` e `start.sh:30-33` verificam apenas a versão **principal** 22. Uma versão 22 anterior a 22.13 pode passar na verificação inicial e depois falhar ou ser incompatível com as dependências. A versão observada pelo implementador foi 24.22.1; não testei uma instalação 22 anterior.

**Correção esperada:** verificar/documentar a versão mínima efetivamente suportada, incluindo versão secundária ou recurso necessário, com mensagem correta e teste de pré-requisito.

## Validação independente realizada

| Verificação | Resultado e limite |
| --- | --- |
| SHA-256 e integridade do ZIP; 248 hashes do manifesto | Conferem. Isso identifica o pacote, não o estado Git externo. |
| `npm run test:hub` | 14/14 passaram na cópia, usando `ws` embutido no Playwright como adaptador temporário. |
| `npm test` do Arcade | 35/35 passaram na cópia, com o mesmo adaptador de `ws`. Inclui testes de protocolo/servidor, não a corrida completa no navegador. |
| Simulação compartilhada VAVA | 6/6 passaram diretamente no Node 24 com resolução TypeScript temporária; não é a execução original com `tsx` nem teste do jogo em navegador. |
| `npm run e2e` | Falhou com `MODULE_NOT_FOUND`, exit 1; o caminho configurado não existe. |
| Sondas de R1–R8 e caso SQLite do Catan | Reproduziram os resultados descritos acima. As sondas que usam jogo falso são explicitamente identificadas; colisão e retomada também exercitaram o servidor real do Arcade. |
| Catan completo, VAVA completo, navegadores reais | Não executados nesta revisão: dependências e/ou navegador não presentes. |
| NTFS real, Debian, Mint, Firefox, outro computador e rede local sem internet | Não executados. Continuam necessários para aceitar esses cenários, ou devem ficar como pendências explícitas se o ambiente não estiver disponível. |

As capturas incluídas foram inspecionadas: o Hub apresenta uma direção visual escura com detalhes neon compatível com o tema solicitado. Capturas não demonstram jogabilidade ou funcionamento em rede.

## Recomendações para a próxima rodada

1. Preservar o estado atual e verificar a identidade da versão antes de editar; o pacote afirma `b9cae6a`, mas o repositório original deve ser conferido localmente.
2. Corrigir R1–R10 com testes regressivos permanentes. Reexecutar as sondas antes para confirmar a reprodução na versão local; adaptar as provas após a correção sem apagar as evidências do comportamento antigo.
3. Reconstruir os artefatos a partir dos fontes finais antes do E2E final, especialmente o cliente VAVA; registrar a identidade dos fontes/builds usados.
4. Validar os três jogos em navegadores isolados, incluindo ações reais e fins naturais quando possível. Identificar separadamente qualquer hook ou fixture que encurte a partida. Não chamar teste com jogo simulado ou final forçado de partida completa.
5. Preparar uma cópia de teste no NTFS e, quando os equipamentos estiverem disponíveis, testar de outro computador, com a LAN ativa e internet indisponível, além de Debian/Mint e Firefox. Não alterar a rede ou o firewall globais do usuário para simular o teste.
6. Entregar comandos, exit codes verdadeiros, o que passou, o que falhou, condições ambientais e pendências. Nenhum push ou deploy; commits locais são permitidos quando coerentes com o estado e as instruções do proprietário.
