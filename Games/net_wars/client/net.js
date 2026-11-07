// WS + envio de input a 20Hz. Tolera campos futuros do servidor (times,
// escudo, mísseis, power-ups, wave): repassa snapshot como veio; faltando = undefined.
// Mede ping e idade do snapshot p/ aviso de conexão.
import { MSG } from '../shared/protocol.js';

// Política de retry pura/testável (a): close pré-WELCOME CONTA tentativa;
// sucesso só pós-WELCOME zera (via reset()); backoff base·2^k, máx N;
// um timer por vez (arm() limpa o anterior).
export function createRetryPolicy(maxTries = 3, baseMs = 1000) {
  let tries = 0, timer = 0;
  return {
    get tries() { return tries; },
    reset() { clearTimeout(timer); timer = 0; tries = 0; },
    exhausted() { return tries >= maxTries; },
    arm(onFire) {
      clearTimeout(timer);
      if (tries >= maxTries) return false;
      const delay = baseMs * (2 ** tries);
      timer = setTimeout(() => { timer = 0; tries++; onFire(); }, delay);
      return true;
    },
  };
}

// Fechamento explícito: repetir é inútil (1008 hello inválido, 1013 denied)
// ou errado (1000 'hub close' ressuscitaria sala que o hub encerrou). (a)(c)
export function isExplicitClose(code, reason) {
  if (code === 1008 || code === 1013) return true;
  if (code === 1000 && /hub close/i.test(String(reason || ''))) return true;
  return false;
}

// Aba oculta (d): timer de fundo (~1s throttled) ainda refrescaria o input no
// servidor e a nave seguiria ATIRANDO sozinha. O protocolo não tem flag blur
// (validInput não prevê; servidor ignora extras) → neutraliza a atuação aqui,
// preservando atitude/seq (sem snap no servidor). Só observa se houver DOM.
let pageHidden = false;
function watchVisibilityOnce() {
  if (typeof document === 'undefined' || !document?.addEventListener) return;
  if (watchVisibilityOnce._doc === document) return; // 1 listener por documento
  watchVisibilityOnce._doc = document;
  try {
    document.addEventListener('visibilitychange', () => { pageHidden = !!document.hidden; });
    if (typeof addEventListener === 'function') addEventListener('pagehide', () => { pageHidden = true; });
    pageHidden = !!document.hidden; // já oculto no 1º connect também neutraliza
  } catch (e) { try { console.warn('[net] visibility watcher install failed', e); } catch {} }
}

export function connect(url, sendInput, hooks) {
  // https: exige wss: (página segura bloqueia ws: inseguro)
  if (typeof location !== 'undefined' && location.protocol === 'https:' && url.startsWith('ws://')) {
    url = 'wss://' + url.slice('ws://'.length);
  }
  let dead = false; // guard de geração: close() invalida; socket antigo não toca estado novo
  let sampleWarned = false; // sendInput quebrou: avisa só 1x por conexão (sem spam a 20Hz)
  watchVisibilityOnce(); // (d) blur→neutral a partir do 1º connect
  const ws = new WebSocket(url);
  const st = { lastSnapAt: 0, pingMs: null, connected: false };
  const send = (o) => { try { if (!dead && ws.readyState === 1) ws.send(JSON.stringify(o)); } catch {} };
  ws.onopen = () => {
    if (dead) return;
    st.connected = true;
    try { ws.send(JSON.stringify({ t: MSG.HELLO, ...hooks.hello })); } catch {}
    hooks.onOpen?.();
  };
  const clearTimers = () => { clearInterval(timer); clearInterval(pingTimer); };
  ws.onclose = (ev) => {
    clearTimers(); // reconexão quebrada não deixa timer órfão
    st.connected = false;
    if (!dead) hooks.onClose?.(ev && ev.code, ev && ev.reason);
  };
  ws.onerror = () => { if (!dead) hooks.onError?.(); };
  ws.onmessage = (ev) => {
    if (dead) return;
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === MSG.SNAPSHOT) { st.lastSnapAt = performance.now(); hooks.onSnap(m); }
    else if (m.t === MSG.EVENT) hooks.onEvent(m);
    else if (m.t === MSG.WELCOME) hooks.onWelcome(m);
    else if (m.t === MSG.PONG) {
      st.pingMs = Math.round(performance.now() - (m.t0 || performance.now()));
      hooks.onPing?.(st.pingMs);
    }
  };
  const timer = setInterval(() => {
    if (dead || ws.readyState !== 1) return;
    let m;
    try { m = sendInput(); } catch (e) {
      if (!sampleWarned) { sampleWarned = true; try { console.warn('[net] sendInput failed', e); } catch {} }
      return; // sem sample, nada a enviar (aviso só na 1ª vez: sem spam a 20Hz)
    }
    // (d) oculto: zera atuação (fire/míssil/switch/boost/empuxo), preserva
    // atitude + seq — sem snap no servidor, sem tiro fantasma no fundo.
    if (m && pageHidden) { m.fire = 0; m.w2 = 0; m.swap = 0; m.boost = 0; m.w = 0; m.s = 0; m.thr = 0; }
    // P0-3: pacote primeiro em try próprio; feedback (áudio) em try isolado
    // DEPOIS — onFired lançando nunca mais engole laser/míssil/switch, e o
    // consumeFire() do sample nunca é perdido por exceção de áudio.
    try { ws.send(JSON.stringify(m)); } catch {}
    if (m && (m.fire || m.w2 || m.swap)) { try { hooks.onFired?.(m); } catch {} }
  }, 50);
  // ping a cada 3s p/ medir latência (servidor responde pong)
  const pingTimer = setInterval(() => {
    if (!dead && ws.readyState === 1) {
      try { ws.send(JSON.stringify({ t: MSG.PING, t0: performance.now() })); } catch {}
    }
  }, 3000);
  return {
    state: st,
    snapAgeMs() { return st.lastSnapAt ? performance.now() - st.lastSnapAt : Infinity; },
    start() { send({ t: MSG.START }); },
    ready(v) { send({ t: MSG.READY, v: v ? 1 : 0 }); },
    shuffle() { send({ t: MSG.SHUFFLE }); },
    rematch() { send({ t: MSG.REMATCH }); },
    leave() { send({ t: MSG.LEAVE }); },
    close() { dead = true; clearTimers(); try { ws.close(); } catch {} },
  };
}
