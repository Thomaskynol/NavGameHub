# Asfalto Vivo — Arquitetura e contratos de integração

Documento canônico para todas as frentes de trabalho. Em caso de conflito entre este
documento e implementações parciais, **este documento prevalece**. Requisitos de produto:
ver `SPEC.md`.

## 0. Stack e execução

- **Cliente:** Three.js (servido de `node_modules` via rota `/vendor/*`), ES Modules puros,
  **sem etapa de build**. Navegadores atuais de desktop (Chrome/Edge/Firefox/Safari atuais).
- **Servidor:** Node >= 18, `ws` para WebSocket, HTTP estático próprio (sem Express).
  Escuta `0.0.0.0` (aceita LAN). `PORT` env default `8080`.
- **Rotas HTTP:** `/` → `public/`; `/shared/*` → `shared/`; `/vendor/*` →
  `node_modules/three/build/`; `/api/info` → JSON `{addresses:[...]}` (IPs da LAN p/ dica de convite).
- **Idioma da UI:** português do Brasil. Nomes internos de código em inglês.
- **Persistência:** `localStorage` (`av.settings`, `av.records`) + `sessionStorage` (`av.session`).
- Sem assets externos: meshes procedurais (Three.js), áudio sintetizado (WebAudio), fonte do sistema.

## 1. Mapa de arquivos e propriedade (NUNCA escrever fora do seu domínio)

| Domínio | Arquivos | Dono |
|---|---|---|
| Contratos | `ARCHITECTURE.md`, `shared/protocol.js`, `shared/constants.js` | orquestrador (somente leitura p/ outros) |
| Pistas + matemática | `shared/tracks.js`, `shared/trackMath.js`, `tools/check_tracks.js` | lane tracks |
| Servidor | `server/**`, `test/**` | lane servidor |
| Jogo 3D/física | `public/js/game/**`, `public/js/input.js` | lane gfx |
| UI/HUD | `public/index.html`, `public/css/**`, `public/js/ui/**`, `public/js/store.js` | lane ui (designer) |
| Áudio | `public/js/audio.js` | lane áudio |
| Integração | `public/js/main.js`, `public/js/net.js` | lane integração |
| Docs finais | `README.md`, `CREDITS.md` | orquestrador |

Importe módulos compartilhados no navegador como `/shared/trackMath.js` etc. No servidor,
importe como `../shared/trackMath.js`. Nenhum módulo de cliente importa outro domínio
diretamente além das fachadas públicas listadas em §6 (main.js orquestra tudo).

## 2. Sistema de coordenadas e dados de pista

- Plano XZ (X leste, Z sul), Y para cima. Unidades: metros. Volta no sentido **horário visto
  de cima é indiferente** — o sentido de corrida é a ordem dos pontos do centerline.
- `s` = distância percorrida ao longo do centerline fechado, `s ∈ [0, length)`, `s=0` é a
  **linha de chegada/grid**. `lat` = deslocamento lateral assinado (**esquerda do sentido de
  corrida = positivo**).
- `shared/tracks.js` exporta `TRACKS` (objeto por id) com formato exato:

```js
export const TRACKS = {
  costeiro: {
    id: 'costeiro',
    name: 'Circuito Costeiro',
    theme: 'coast',            // 'coast' | 'industrial'
    points: [[x,z], ...],      // >= 24 pontos de controle, NÃO repetir o primeiro no fim
    widths: [m, ...],          // largura TOTAL da pista por ponto; mesmo tamanho de points; 9..18
    env: { sky:'#hex', ground:'#hex', groundFar:'#hex', fog:'#hex', fogNear:n, fogFar:n,
           sun:'#hex', ambient:'#hex' },
    decor: [ {kind, x, z, rot?, scale?, tint?}, ... ],
  },
  industrial: { id:'industrial', name:'Distrito Industrial', theme:'industrial', ... },
};
```

`decor.kind` suportados (renderizador gfx deve criar primitiva low-poly p/ cada um):
costeiro: `palm, rock, dune, parasol, hut, boat, lighthouse, buoy`;
industrial: `container, warehouse, crane, silo, pipe, fence, lightpole, smokestack, crate`;
comum: `tree, barrier, stand, billboard, tirestack`.
`decor` posiciona **forda** da faixa jogável (|lat| > width/2 + 2), nunca bloqueando a pista.
Kerbs (zebras), corrimãos/barreiras exteriores e postes ao longo do traçado são **gerados
proceduralmente pelo gfx** a partir do sampler (não no decor manual).

### `shared/trackMath.js` — API do sampler (usada por servidor, gfx, ui/minimapa, TT)

```js
export function createSampler(track) => {
  length,                              // perímetro em metros (número)
  project(x, z) => { s, lat, heading, width, inside },  // s ∈ [0,length); inside = |lat| <= width/2
  pointAt(s) => { x, z, heading },     // posição e tangente (rad) no arco s
  curvature(s) => number,              // aprox. 1/raio, sinal = lado da curva
  polyline(n = 400) => [[x,z], ...],   // pontos do centro p/ minimapa, fechado
  checkpoints(k = 8) => [s0, s1, ...], // s_i = i*length/k (cp0 = chegada), retorno só os k valores
  grid(n) => [{ x, z, heading, s, lat }], // slots p/ n carros atrás da linha, alternando lat
}
```

Implementação: Catmull-Rom fechado sobre `points`, pré-amostrado (~4 amostras/m, min
2000 amostras), busca binária para projeção. Deve ser puro, sem dependências, idêntico no
servidor e no cliente. `tools/check_tracks.js` valida: fechamento, sem autointerseção,
raio mínimo >= 8 m, larguras válidas, os dois traçados distintos (área/hashed centerline),
e imprime estatísticas (comprimento, nº de curvas fechadas). Rode: `npm run check:tracks`.

## 3. Protocolo WebSocket (`shared/protocol.js` é a fonte canônica)

JSON, `{t: '<tipo>', ...campos}`. Sala: código de 6 chars `[A-Z2-9]` (sem caracteres
ambíguos). Payloads com curto nome.

### Cliente → Servidor

| t | payload | notas |
|---|---|---|
| `create` | `{name, color}` | cria sala, emite `joined` |
| `join` | `{room, name, color, resume?}` | `resume` = token; se casa com jogador `away` na sala → reconecta |
| `leave` | `{}` | sai da sala atual |
| `set` | `{color?|null, ready?|null, track?|null, laps?|null}` | track/laps só host; servidor faz reset de `ready` de todos quando track/laps mudam |
| `start` | `{}` | só host; valida >=2 conectados e todos ready |
| `ready_load` | `{}` | cliente terminou de carregar a cena do grid |
| `st` | `{x,z,hd,v,steer,hb,nit,off,dr}` | estado do carro local a 15 Hz; hd rad; v m/s com sinal (+frente); steer [-1..1]; hb/nit/off 0|1; dr 0..1 (derrapa) |
| `ping` | `{ts}` | heartbeat 2 s + sincronia de relógio |

### Servidor → Cliente

| t | payload | notas |
|---|---|---|
| `welcome` | `{serverNow}` | logo após conectar |
| `err` | `{code, msg}` | códigos: `NOT_FOUND, FULL, BAD_NAME, BAD_COLOR, NOT_HOST, NOT_READY, RACING, INVALID, RATE, RECONNECT_EXPIRED` |
| `joined` | `{room, you:id, token, mode:'lobby'\|'waiting'\|'race', state}` | `mode:'race'` ⇒ reconexão em corrida; envia também snapshot atual embutido em `state.race` |
| `state` | `{status:'lobby'\|'countdown'\|'race'\|'results', hostId, track, laps, players:[{id,dname,color,ready,conn:'on'\|'away'}], max, seats, race?}` | broadcast em qualquer mudança de lobby; `dname` = nome de exibição (servidor resolve duplicatas com sufixo ` #2`, etc.) |
| `prepare` | `{track, laps, roster:[{id,dname,color}], grid:[{id,x,z,heading}], startAt}` | largada preparada; `startAt` = serverNow do GO (confirmado após todos `ready_load`/timeout 20 s) |
| `cd` | `{n, at}` | ticks 3,2,1 → n=0 é GO; `at` = serverNow alvo |
| `sn` | `{seq, raceNow, cars:[{id,x,z,hd,v,steer,hb,nit,off,dr,place,lap,cp,le,bl,ll,fin,ft,rec}]}` | snapshot 15 Hz; `le`=ms da volta atual; `bl`/`ll`=melhor/última volta ms ou null; `fin` 0|1; `ft` ms ou null; `rec` nº de recuperações |
| `lap` | `{id, lap, timeMs, bestMs, valid}` | volta concluída (broadcast) |
| `fin` | `{id, place, timeMs}` | jogador terminou |
| `deadline` | `{at}` | serverNow do encerramento (1º finisher + 45 s) |
| `results` | `{rows:[{id,dname,color,place,timeMs,bestMs,dnf,progress}], reason}` | corrida encerrada |
| `back_lobby` | `{}` | resultados → lobby; seguido de `state` |
| `cancel` | `{msg}` | contagem cancelada (ex.: <2 jogadores); volta ao lobby |
| `snap_self` | `{x,z,hd,v}` | correção imposta ao carro deste cliente (colisão/correção de divergência) |
| `collide` | `{a,b,imp}` | evento cosmético (tela/som) p/ ambos |
| `notice` | `{kind, msg}` | ex.: contramão detectada no servidor, expulsão, etc. |
| `bye` | `{reason}` | sala fechada / substituído por conexão nova com o mesmo token |
| `pong` | `{ts, serverNow}` | resposta ao ping |

## 4. Autoridade de corrida (servidor)

- **Movimento:** cliente simula o próprio carro (autoridade local p/ sensibilidade) e envia
  `st`. Servidor **projeta** `(x,z)` no sampler para obter `s`/`lat` oficial (não confia em
  `s` do cliente). Valida `|v| <= maxSpeed*1.25` (constante); se exceder, marca e envia
  `snap_self` com correção.
- **Checkpoints:** K=8 em `s_i = i*length/8`. Por jogador: `nextCp` inicia 1; atingir cp
  `nextCp` (distância ao ponto do cp < 12 m e `|lat| < width/2 + 6`) avança
  `nextCp = (nextCp+1) % 8` (com 0 = chegada). Volta só incrementa ao cruzar a linha
  (`nextCp==0` e transição de `s` alto→baixo = cruzamento para frente) com todos os cps
  anteriores colhidos. Ré/cruzamento para trás não conta. `lap == laps` ⇒ `fin=1`,
  `ft = raceNow`.
- **Ranking:** `progresso = lap*length + s` (com cps garantindo sequência). `place` por
  ordenação de progresso; `fin` primeiro, por `ft`; empate → maior `lap`, depois maior `s`,
  depois `id` (ordem estável igual p/ todos).
- **Colisão carro-carro:** raio 1.6 m; servidor detecta sobreposição nos `st` recebidos,
  resolve (separar + amortecer componente relativa ao longo da normal, fator 0.5, teto de
  impulso) e emite `snap_self` p/ envolvidos (só se deslocamento > 0.4 m) e `collide`.
  Paredes: **cada cliente** faz clamp lateral determinístico com a mesma regra
  (`lat` limitado a `width/2 + 3.5 m`, perda de componente lateral de velocidade,
  amortecimento 0.35) ⇒ resultado idêntico p/ todos.
- **Contagem/preparação:** `start` válido exige >=2 conectados e todos `ready`. Roster
  congela no `prepare`. Se desconectados/`away` reduzirem a <2 antes do GO ⇒ `cancel` +
  `state` (lobby). Timeout 20 s p/ `ready_load` (inicia mesmo assim; quem não carregou
  recebe `bye` e é removido).
- **Encerramento:** 1º `fin` ⇒ `deadline` = raceNow + 45 s. Corrida encerra quando todos
  concluíram ou abandonaram, ou no deadline. Abandono: `away` há 30 s sem retorno.
- **Reconexão:** token único por entrada na sala (guardado no cliente em `av.session`).
  Servidor mantém objeto do jogador 30 s em `away` (identidade, progresso, voltas intactos);
  retorno no prazo ⇒ reanexa (mesmo id/carro). Conexão nova com token já ativo ⇒ a mais
  recente vence; antiga recebe `bye {reason:'replaced'}`.
- **Host:** quem criou; ao sair, o mais antigo entre conectados (ordem de entrada). Migração
  não interrompe corrida.
- **Sala vazia** (0 jogadores) ⇒ destruída. Salas são 100% independentes.
- **`dname`:** nome com sufixo ` #2` etc. quando há apelidos iguais na sala; recalculado em
  entrada/saída; enviado em `state.players` e `results.rows`.
- **Rate limit:** ignora > 30 `st`/s por conexão; mensagens malformadas ⇒ desconecta.

## 5. Constantes (`shared/constants.js`)

Fonte única: limites de sala (`MAX_PLAYERS=6`, `LAPS_DEFAULT=3`, `LAPS_MIN/MAX=1/5`),
tempos (`RECONNECT_MS=30000`, `FINISH_GRACE_MS=45000`, `COUNTDOWN_S=3`, `READY_TIMEOUT_MS=20000`),
rede (`SNAPSHOT_HZ=15`, `STATE_HZ=15`, `PING_MS=2000`), física (`PHYSICS`: velocidades m/s,
acelerações, `NITRO`: duração/regen/boost), cores (`COLORS`: 10 opções `{id, hex, name}`),
chaves de storage. **Ajustes de feeling p/ gfx mudam apenas `PHYSICS`/`NITRO` aqui.**

## 6. Fachadas de cliente (firmas exatas)

Toda UI é pt-BR e construída pelo lane ui; a integração só usa estas fachadas.

### `public/js/store.js` (lane ui)

```js
export function loadSettings() => { volume:0..1, muted:bool, quality:'low'|'medium'|'high',
  fxIntensity:0..1, steerSensitivity:1, nickname:string, color:string /*hex*/ }
export function saveSettings(patch)      // merge + persiste
export function loadRecords() => { costeiro:{bestLapMs, at}, industrial:{...} }
export function saveRecord(trackId, lapMs) // só se menor; retorna bool
```

### `public/js/ui/index.js` (lane ui)

```js
export function initUI({ onAction })  // onAction({type:'...', ...payload}) — ações listadas abaixo
export function show(screen, data?)   // 'home'|'join'|'lobby'|'loading'|'tt_select'|'race'|'pause'|'results'|'settings'|'help'|'wait'
export function updateRoom(state)     // payload de `state` (lobby ou wait)
export function setConn(status, msg?) // 'connecting'|'online'|'reconnecting'|'offline'
export function toast(msg, kind?)     // 'ok'|'warn'|'err'
export const hud = {
  visible(bool), update(payload), notice(text, kind, ms), countdown(n /*3..0|null*/),
  setInvalidLap(bool),
}
// hud.update payload: { speedKmh, place, total, lap, laps, raceTimeMs, lapTimeMs,
//   bestLapMs|null, nitro:0..1, nitroActive:bool, youColor:'#hex',
//   standings:[{id,dname,color,place,lap,fin,dnf}],
//   minimap:{ polyline:[[x,z],...], bounds:{minX,minZ,maxX,maxZ},
//             you:{x,z,heading}, others:[{x,z,color}] } }
```

Ações `onAction`: `create` `{name,color}` · `join` `{name,color,code}` · `join_url`
`{name,color}` (código da URL) · `tt_start` `{trackId,name,color}` · `open_settings` ·
`open_help` · `back_home` · `lobby_copy` · `lobby_color` `{color}` · `lobby_ready`
`{ready}` · `lobby_track` `{trackId}` · `lobby_laps` `{laps}` · `lobby_start` ·
`lobby_leave` · `results_lobby` · `results_leave` · `pause_resume` · `pause_help` ·
`pause_quit` · `tt_restart` · `tt_change_track` · `tt_quit` · `settings_change`
`{patch}` · `settings_back` · `help_back` · `join_submit` `{code}` · `join_back`.

### `public/js/game/engine.js` (lane gfx)

```js
export function createEngine({ mount /*HTMLElement*/, getSettings, audio }) => ({
  async load(trackId)                  // constrói cena + carro local no grid slot 0 (TT) ou grid do servidor
  start(opts)                          // { startAtServerTime|null, now() => serverNow|null } inicia loop rAF
  pause(bool)                          // true: congela simulação (TT) / libera input e engata neutro (multiplayer)
  applySnapshot(snap)                  // payload de `sn`
  applyCorrection({x,z,hd,v})          // payload de `snap_self`
  getLocalState() => st|null           // payload de `st` (null se não em corrida)
  getHudPayload() => object            // §6 hud.update (exceto standings/minimapa: main monta)
  recover()                            // R: teleporta ao último checkpoint válido; cooldown 3 s
  on(event, cb)                        // 'notice' {text,kind}, 'lap' {timeMs,valid}, 'finish',
                                       // 'wrongway' bool, 'countdownEnd', 'nitro', 'collision' {imp}
  getCarPositions() => [{x, z, heading, color, isYou}]  // main monta o minimapa (polyline/bounds via trackMath)
  dispose()                            // cancela rAF, libera listeners, remove meshes
})
```

Física: passo fixo 120 Hz com acumulador (consistente entre FPS); câmera 3ª pessoa suave;
interpolação de remotos com buffer ~120 ms; R (recupera) valida contra `trackMath`;
nitro conforme `NITRO`; off-track (`inside=false`) ⇒ menos aderência + arrasto; paredes com
a regra de clamp §4. `input.js` (lane gfx): singleton que expõe
`getInput() => {throttle,brake,steer,handbrake,nitro,recoverPress}`, ignora teclas com foco
em `input/textarea/contenteditable`, limpa tudo em `blur`/`visibilitychange`, `Esc` emite
`onEsc(cb)`, e é ativado/desativado (`setActive(bool)`) pela integração.

### `public/js/audio.js` (lane áudio)

```js
export function initAudio()            // cria AudioContext no 1º gesto; seguro chamá-lo cedo
export function setAudioVolume(v01, muted)
export function sfx(name)              // 'click'|'join'|'countdown'|'go'|'lap'|'finish'|'collide'|
                                       // 'wall'|'wrongway'|'nitro'|'error'|'recover'|'menu_open'
export const engine = { start(), stop(), update(rpm01, load01, moving) }
export function nitroSfx(active)        // drone contínuo ligar/desligar
export function skidSfx(level01)        // derrapagem contínua
export function duck(bool)              // aba oculta ⇒ true (reduz master p/ 0)
```

### `public/js/net.js` (lane integração)

```js
export function connect() => Promise<void>
export function send(obj)
export function onMessage(cb)           // cb(msg) p/ todos os t tipados
export function disconnect()
export function status() => 'connecting'|'online'|'reconnecting'|'offline'
```

### `public/js/main.js` (lane integração)

Único orquestrador: roteia UI ↔ net ↔ engine ↔ audio; guarda `av.session`
(`{room, id, token, name, color}`) e tenta `join` com `resume` ao recarregar com `?room=`;
gerencia transições de tela, snapshot→hud, relógio sincronizado (offset EMA a partir de
`pong`/`sn.serverNow` — exibir tempos sempre com relógio do servidor), cooldown/retry de
reconexão (1 s, com `setConn`), e limpeza total entre corridas (`engine.dispose()`,
`audio.engine.stop()`, sem listeners duplicados).

## 7. Fluxo de telas

`home` (apelido+cor persistidos; botões Criar/Entrar/Contra o relógio/Configurações/Como
jogar; se `?room=` presente, pré-preenche e oferece entrar) → `lobby` (convite copiável,
lista, host, prontos, pista, voltas, vagas, status) → `loading` → `race` (HUD) → `results`
(→ lobby ou sair) → `lobby` (ready resetado). `wait` = entrou durante corrida ("aguardando
próxima corrida" + acompanhar classificação). Time trial: `tt_select` → `race` (menu Esc:
reiniciar/trocar pista/sair; voltas ilimitadas, melhor volta por pista).

## 8. Tempo e relógio

- Todo tempo oficial vem do servidor (`raceNow` em `sn`, `at` em `cd`, `ft`, `results`).
- Cliente mantém `offset = serverNow - performance.now()` via EMA de `pong` e `sn`;
  exibição de cronômetros usa `performance.now() + offset`.
- Nunca usar `Date.now()` para cronômetros de corrida.

## 9. Persistência

- `av.settings` §6 store; `av.records` por pista (`bestLapMs`, `at`);
  `av.session` `{room, id, token, name, color}` p/ reconexão por aba (sessionStorage —
  por aba, então abas distintas têm identidades distintas; duplicar aba copia o token, mas
  o servidor trata token duplicado: a conexão mais recente vence).

## 10. Verificação obrigatória por lane

- tracks: `npm run check:tracks` com saída limpa.
- servidor: `npm test` (testes node:test cobrindo: sala cheia/inexistente, host migra,
  lobby updates, corrida completa simulada com 2+ clientes ws, corte de checkpoints não
  conta volta, ré não conta, reconexão no prazo, encerramento com deadline, isolamento de
  duas salas, dname duplicado). Sem navegador.
- gfx/ui/áudio: `node --check` em cada arquivo JS; integração final: smoke manual.
- Nada de `console.error` poluído em operação normal.
