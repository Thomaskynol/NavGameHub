// Controle: mouse = DESEJO (bolinha ○, estável no mundo) nas 2 câmeras;
// nariz PERSEGUE com w_max (shared/turn.js, servidor autoritativo).
// FP (cockpit, padrão NetWars 1993): mesmo desejo/perseguição do TP, câmera
//   rígida no nariz, A/D rolagem manual, W/S empuxo momentâneo, sem auto-nivelar.
// TP (atrás, War Thunder): + bank automático (bank-to-turn), W/S = manete
//   persistente, A/D = bank fino + leme.
// ✛ central = PARA ONDE o tiro realmente vai (direção do nariz).
import {
  ROLL_SPEED, TP_YAW_RATE, TP_PITCH_RATE,
  BANK_MAX, ROLL_CHASE, RUDDER_SPEED, THR_RATE,
  FP_RAD_PER_PX, MOUSE_PX_CLAMP,
} from '../shared/constants.js';
import { wrapPi } from '../shared/orient.js';
import { moveDesired, stepNose, cursorFromError, TP_DESIRED_SPREAD } from '../shared/turn.js';

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// delta de mouse por evento, limitado (evita salto após lag/alt-tab)
const clampPx = (v) => clamp(v, -MOUSE_PX_CLAMP, MOUSE_PX_CLAMP);

// Raio do cursor (px): fração da menor dimensão da tela. Fora disso, clamp.
export function cursorRadius() {
  return Math.max(120, Math.min(innerWidth, innerHeight) * 0.35);
}

export function createInput(canvas, getSettings) {
  const keys = new Set();
  const st = {
    // real (nariz): enviado ao servidor, define para onde o tiro vai
    yaw: 0, pitch: 0, roll: 0,
    // desejo (bolinha ○, estável no mundo): mouse move nas 2 câmeras; o
    // nariz persegue com w_max (predição local = mesma função do servidor
    // autoritativo). FP usa o mesmo desejo do TP (missão §3: bolinha +
    // perseguição gradual); a diferença FP é a câmera rígida no nariz.
    dyaw: 0, dpitch: 0,
    // cursor virtual (screen-space, px a partir do centro): espelho do erro
    // desejo−nariz (só leitura p/ HUD/E2E; o ○ do HUD projeta o ponto mundo)
    cx: 0, cy: 0,
    thr: 0.65, // manete TP (persiste); FP ignora
    missile: 0, swap: 0, seq: 0, locked: false, firing: false,
    active: false, // gate: só vira/enfileira quando em partida (main liga)
    freeAim: false, // fallback sem pointer lock (pointerlockerror/rejeição)
  };
  const listeners = { pause: null, score: null, mute: null, help: null };
  const camMode = () => (getSettings().camMode === 'tp' ? 'tp' : 'fp');

  function clearKeys() { keys.clear(); st.firing = false; st.missile = 0; st.swap = 0; }
  function recenter() { st.cx = 0; st.cy = 0; st.dyaw = st.yaw; st.dpitch = st.pitch; }

  addEventListener('keydown', (e) => {
    if (e.code === 'Tab') { e.preventDefault(); listeners.score?.(true); return; }
    if (e.code === 'Escape') { listeners.pause?.(); return; }
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.code === 'KeyM') { listeners.mute?.(); return; }
    if (e.code === 'KeyH') { listeners.help?.(); return; }
    if (e.code === 'KeyF' && !e.repeat) st.swap = 1;
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'Tab') listeners.score?.(false);
  });
  addEventListener('blur', () => { clearKeys(); recenter(); });
  document.addEventListener('pointerlockchange', () => {
    st.locked = document.pointerLockElement === canvas;
    if (!st.locked) { clearKeys(); recenter(); } // sem mira travada: para de virar
  });
  // sem lock o jogo continua jogável (mira livre, sem captura)
  document.addEventListener('pointerlockerror', () => { st.freeAim = true; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearKeys(); recenter(); } });
  addEventListener('mousemove', (e) => {
    if (!st.active) return;
    if (document.pointerLockElement !== canvas && !st.freeAim) return;
    const s = getSettings();
    const mode = camMode();
    const g = (s.sensitivity ?? 1);
    const dx = clampPx(e.movementX);
    const dy = clampPx(e.movementY * (s.invertY ? -1 : 1));
    // Mouse move o DESEJO (bolinha ○, estável no mundo) nas 2 câmeras:
    // dx>0/D vira à direita, dy>0 vira p/ baixo — mesmo ganho por pixel (k),
    // com Screen-relative pelo roll (War-Thunder mouse-aim, Lane B):
    // cursor-direita é direita DA TELA em qualquer bank. O nariz persegue
    // em update() com w_max (nunca teleporta); mouse parado = desejo fixo.
    const k = FP_RAD_PER_PX * g;
    const d = moveDesired(st.dyaw, st.dpitch, dx, dy, k, st.roll);
    st.dyaw = d.yaw; st.dpitch = d.pitch;
  });
  function lockPointer() {
    if (document.pointerLockElement !== canvas) {
      try {
        const r = canvas.requestPointerLock();
        if (r && r.catch) r.catch(() => { st.freeAim = true; });
      } catch { st.freeAim = true; }
    }
  }
  canvas.addEventListener('mousedown', (e) => {
    listeners.unlock?.();
    // clique que captura o lock NÃO dispara tiro: só trava a mira.
    // tiro só quando já estava travado.
    if (document.pointerLockElement !== canvas && !st.freeAim) { lockPointer(); return; }
    if (e.button === 0) st.firing = true;
    if (e.button === 2) st.missile = 1;
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) st.firing = false; });
  canvas.addEventListener('click', () => {
    listeners.unlock?.();
    lockPointer();
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    listeners.unlock?.();
    if (document.pointerLockElement === canvas || st.freeAim) st.missile = 1;
    else lockPointer();
  });

  // Taxas do nariz a partir do desejo (chamado todo frame com dt real).
  // Direita no desejo = virar à direita; cima no desejo = subir.
  // Vale FP e TP (mesmo desejo/perseguição w_max); difere só o bank.
  function update() {
    if (!st.active) return;
    // dt interno via rAF diff (60fps típico); chama 1x/frame do main loop.
    const now = performance.now();
    const dt = Math.min(0.1, (now - (update._t || now)) / 1000 || 0.016);
    update._t = now;
    const mode = camMode();
    const a = keys.has('KeyA') ? 1 : 0;
    const d = keys.has('KeyD') ? 1 : 0;
    if (mode === 'tp') {
      // Leme fino A/D move o DESEJO screen-relative (como o mouse): gira por
      // −roll via moveDesired — com bank a tecla move o nariz p/ o lado DA
      // TELA (roll=0 idêntico ao yaw de mundo). Servidor persegue o mesmo
      // desejo ⇒ sem divergência predição/autoridade.
      const rd = moveDesired(st.dyaw, st.dpitch, -(a - d) * RUDDER_SPEED * 0.4 * dt, 0, 1, st.roll);
      st.dyaw = rd.yaw; st.dpitch = rd.pitch;
      // Nariz persegue o desejo com w_max (predição local idêntica ao
      // servidor autoritativo); mouse parado = desejo fixo = converge e para.
      const n = stepNose(st.yaw, st.pitch, st.dyaw, st.dpitch, dt, TP_YAW_RATE, TP_PITCH_RATE);
      st.yaw = n.yaw; st.pitch = n.pitch;
      // Cursor ○ espelha o erro desejo−nariz (nunca some, clamp circular).
      // Screen-relative: passa o roll p/ aparecer onde o desejo está NA TELA;
      // nx/ny já vêm de tela, então autoBank/deadzone operam na tela.
      const R = cursorRadius();
      const c = cursorFromError(st.yaw, st.pitch, st.dyaw, st.dpitch, R, TP_DESIRED_SPREAD, st.roll);
      st.cx = c.cx; st.cy = c.cy;
      const DZ = 0.03; // deadzone central: voa reto
      const ex = Math.abs(c.nx) < DZ ? 0 : c.nx;
      const ey = Math.abs(c.ny) < DZ ? 0 : c.ny;
      // bank-to-turn: banca p/ dentro da curva + A/D fino
      const autoBank = clamp(-ex * 1.4, -1, 1) * BANK_MAX;
      st.roll = wrapAngle(st.roll + ((a - d) * ROLL_SPEED * 0.8 + (autoBank - st.roll) * ROLL_CHASE * 0.6) * dt);
      const w = (keys.has('KeyW') || keys.has('ArrowUp')) ? 1 : 0;
      const s = (keys.has('KeyS') || keys.has('ArrowDown')) ? 1 : 0;
      st.thr = clamp(st.thr + (w - s) * THR_RATE * dt, -0.6, 1);
    } else {
      // FP: nariz persegue o DESEJO com w_max (predição local idêntica ao
      // servidor autoritativo, que persegue o mesmo dyaw/dpitch do sample).
      // Mouse parado = desejo fixo = converge e para (nada gira sozinho).
      const n = stepNose(st.yaw, st.pitch, st.dyaw, st.dpitch, dt, TP_YAW_RATE, TP_PITCH_RATE);
      st.yaw = n.yaw; st.pitch = n.pitch;
      // Cursor ○ espelha o erro desejo−nariz NA TELA (só leitura; FP não tem
      // auto-bank: A/D é rolagem manual, sem auto-nivelar).
      const c = cursorFromError(st.yaw, st.pitch, st.dyaw, st.dpitch, cursorRadius(), TP_DESIRED_SPREAD, st.roll);
      st.cx = c.cx; st.cy = c.cy;
      st.roll = wrapAngle(st.roll + (a - d) * ROLL_SPEED * dt);
    }
  }

  return {
    state: st,
    on(evt, fn) { listeners[evt] = fn; },
    down(code) { return keys.has(code); },
    mode: camMode,
    update,
    recenter,
    snapActual(yaw, pitch, roll) {
      st.yaw = yaw; st.pitch = pitch; st.roll = roll || 0;
      recenter(); // respawn/teleporte: desejo = nariz (começa voando reto)
    },
    sample() {
      const mode = camMode();
      const boosting = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 1 : 0;
      let w = 0, s = 0, thr = undefined;
      if (mode === 'tp') {
        thr = Math.round(st.thr * 1000) / 1000;
        w = st.thr > 0.05 ? 1 : 0;
        s = st.thr < -0.05 ? 1 : 0;
      } else {
        w = (keys.has('KeyW') || keys.has('ArrowUp')) ? 1 : 0;
        s = (keys.has('KeyS') || keys.has('ArrowDown')) ? 1 : 0;
      }
      // desejo (bolinha ○): nariz persegue com w_max no servidor autoritativo
      // (ramo dyaw existente, igual ao TP) — FP e TP enviam; o servidor ignora
      // o nariz instantâneo e integra ao desejo (nunca teleporte).
      const m = {
        t: 'input', seq: ++st.seq,
        w, s,
        a: keys.has('KeyA') ? 1 : 0, d: keys.has('KeyD') ? 1 : 0,
        yaw: wrapPi(st.yaw), pitch: wrapPi(st.pitch), roll: wrapPi(st.roll),
        fire: st.firing ? 1 : 0,
        boost: boosting,
        w2: 0, swap: 0,
      };
      // desejo (bolinha) + nariz predito: servidor persegue o desejo com
      // w_max e ignora o nariz instantâneo (vale FP e TP).
      m.dyaw = wrapPi(st.dyaw);
      m.dpitch = wrapPi(st.dpitch);
      if (thr !== undefined) m.thr = thr;
      if (keys.has('KeyE')) st.missile = 1;
      if (st.missile) { m.w2 = 1; }
      if (st.swap) { m.swap = 1; }
      return m;
    },
    consumeFire() { st.missile = 0; st.swap = 0; },
  };
}
