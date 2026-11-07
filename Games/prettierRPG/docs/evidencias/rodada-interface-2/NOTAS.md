# Rodada interface 2 — lane CLIENT (checkpoint)

Servidor da captura: `PORT=18097 node server.js` (próprio, sem tocar `.prettierrpg.pid` alheio).
Captura: Playwright Chromium headless (contextos efêmeros 1280×720 e 1920×1080) + Firefox headless (menu).
Verificação: `node --check public/client.js` OK · `npm test` FULL 210/210 exit 0 ·
captura-A 11/11 + captura-B 4/4 + check-ack-event 6/6 + check-fix3 5/5, console+page zerados.

## Capturas
- `inicial-3-areas-1280.png` / `-1920.png` / `-full.png`: menu com 3 áreas antes da sala
  (esq controles+áudio+6 espaços · centro grade+Q/W/E/passivas · dir boneco+6 slots que trocam o centro) + detalhe abaixo.
- `selecao-equipamento.png`: troca de arma no centro (Adaga) sem erro.
- `firefox-menu-1280.png`: mesmo menu no Firefox.
- `combate-jogador-alvo-1280.png`: FFA browser+bot — painel jogador sup-esq + alvo junto, barra inf-central compacta, placar/tempo discretos.
- `mira-E-1280.png`: mira E honesta (linha de direção + anel de alcance + candidato; texto "Servidor valida o alvo — sem dano antes do aceite").
- `visao-lancador-1280.png` (A) / `visao-observador-1280.png` (lobby de quem entrou com partida em curso).
- `bloqueio-escudo-1280.png`: tecla 4 aceita (CD 24 no tile); anel prot depende do snapshot expor `prot/protecao` (ver limitações).
- `treino-1280.png` + `treino-monstro-1280.png`: treino PvE em rede — monstro com etiqueta, dano total 123 + DPS 24,6 do servidor.
- `combate-1920.png`: layout 1920×1080 sem resize manual.
- `2v2-lobby-1280.png`: lobby 2v2 com 4 presentes.

## Protocolo consumido (lane SIM, sem fingir)
- Skill canônica `{type:'skill', slot, skill, target, x, y}`; `attack`/`move`/`ready`/`build`/`team`/`mode`/`finish`/`editor`/`pveReset`/`leave`/`return`.
- **Ack por comando** (`{type:'ack', action, ok, error, slot?, target?, dmg?, absorbed?, healed?, casting?}` — só o emissor recebe):
  skill consome pendentes em FIFO por slot+alvo (rajadas não sobrescrevem: 1º ack→1º envio).
  `ok:true` → som `skill()` + projétil do E 1º uso; absorvido total (`absorbed>0, dmg=0`) → toast "Bloqueado — absorvido (sem dano)".
  `ok:false` → sem FX sucesso; motivo avisa pelo erro legado, exceto alcance/bloqueio (sem erro legado → toast + chase) e finish (limpa `acabando`).
- **Eventos broadcast** (`{type:'event', kind, action, src, target?, slot?, dmg?, absorbed?, healed?}` — A e B veem; `kind`: hit/blocked/miss/cast/move).
  Sons seguem eventos (fonte única; deltas geram SÓ números): `hit` perto de mim ou envolvendo-me → `acerto()`; cura em mim/time → `cura()`. `blocked/miss/cast` sem som de sucesso.
- Inferência por delta de snapshot (CD/cast/efeito) mantida como FALLBACK p/ servidor sem ack; quem consome primeiro vale (sem duplo).
- Blood Bandit E: cone direcional 17 m ±30° (`inCone` do sim) + LOS (parede bloqueia no `dealDamage`), multiacerto; cone vazio/bloqueado → `Errou.` gasto na etapa 1 (etapa 2 consome a janela). Mira desenha o cone real de alcance + ponto clicado (x/y da direção); sem dano prévio.
- Projétil do E (machado, 350 ms) SÓ no aceite do 1º uso; sem dano visual falso (números vêm de delta de HP do snapshot).

## Como cada cliente recebe (D) — verificado em 2 browsers isolados (`check-ack-event`, 6/6)
- A lança Q válida: recebe `ack {action:skill, ok:true, dmg:82, slot:Q, target}` → consome o pendente FIFO, som sucesso; atinge o bot.
- A vê `event {kind:hit, action:skill}`; **B (2º browser) vê o mesmo broadcast** `kind:hit, src=A` — documentado com os dois `lastEvent` lidos.
- Rajada 2×Q em 0,3 s: acks `[ok:true, ok:false "Em recarga."]` — 1º aceito, 2º recusado sem FX sucesso e sem sobrescrever (`ackLog`).
- Recusa geral: sem som de sucesso; motivo pelo erro legado (ou toast alcance/bloqueio quando sem erro legado).
- Cura: número verde + som SÓ p/ self/time (privacidade); dano vermelho todos veem. Mute/volume (`prpg-som`/`prpg-vol`, topo+menu+jogo sincronizados) silenciam tudo (sons passam pelo `AudioX`).
- Aceito-absorvido (ex.: escudo): aceite toca `skill()` + CD anda, mas sem número de dano (sem HP delta) + toast de bloqueio — feedback de aceite sem fingir dano. Anel azul-claro aparece se o snapshot trouxer `prot/protecao`.

## Política dos números (E)
- Janela FIXA 1,5 s por entidade+tipo (não renova no acúmulo; expirou → fecha e abre nova); dano e cura em grupos separados (nunca soma líquido).
- Sem limiar: todo delta real de HP vira número (pequenos contam); cura só self/time (privacidade).
- Números sobem a −84px (acima do nome −46px) com contorno; nomes colados escalonam (raio 60·zoom, passo 16·zoom).
- Cap 24: expira primeiro, corta a mais antiga — só sob rajada extrema; testado em node (fixa-sem-renovar PASS, nova-janela PASS, separados PASS, cap24 PASS).
- PvE na mesma janela fixa: dano no monstro (vermelho, todos veem); cura no boneco (verde, alvo cooperativo); dano no boneco não existe (sim §5) então delta negativo = reset 25%, sem número; respawn do monstro (morto→vivo) sem número.

## Toast fallback (F)
- Treino local: "números simplificados (equivalência parcial)" no toast de abertura e no fallback offline (servidor inalcançável). Ajuda (§ treino offline) mantém o aviso.

## Limitações honestas
- Cone da mira usa o meio-ângulo padrão 30° do sim; skills com largura própria e o LOS (parede) não são desenhados — o servidor valida e pode dar `Errou.` mesmo com o cone cheio atrás de parede.
- 2º E sem efeito que expira some em silêncio após 3 s (documentado, sem FX falso).
- Anel `prot` do escudo só aparece se o snapshot expuser o campo (aceite comprovado pelo CD 24; anel não afirmado sem o campo).
- Vazio marrom residual: o losango isométrico não preenche o canvas fora da arena 100×100; canvas 74vh + app 1400px maximizam, mas o mapa vazio é geometria, não CSS.
- 2v2 em jogo (não só lobby) e Firefox em combate: não capturados nesta rodada.
- `inicial-3-areas-full.png` e `-1920.png` são do build pré-ajuste do slider de áudio do menu (diferença só no slider); `-1280.png` e `firefox` são pós-ajuste.
