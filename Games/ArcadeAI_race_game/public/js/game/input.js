/**
 * public/js/game/input.js — singleton de teclado (lane gfx). ARCHITECTURE §6.
 *
 *   getInput() => { throttle, brake, steer, handbrake, nitro, recoverPress }
 *   setActive(bool)   // integração liga/desliga; desligado zera tudo
 *   onEsc(cb)         // main.js tem listener próprio de Esc; aqui só a fachada
 *
 * Controles: W/↑ acelera · S/↓ freia/re · A/← D/→ esterça · Space freio de mão ·
 * Shift nitro · R recupera (borda de subida; getInput() consome a bandeira).
 * Ignora teclas com foco em input/textarea/[contenteditable]; limpa tudo em
 * `blur` da janela e `visibilitychange` → oculta (§9).
 */

const keys = { up: false, down: false, left: false, right: false, hb: false, nitro: false };
let active = false;
let recoverPress = false;
const escCbs = new Set();

const ZERO = Object.freeze({
  throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, recoverPress: false,
});

function typing() {
  const el = document.activeElement;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || !!el.isContentEditable;
}

function clearAll() {
  keys.up = keys.down = keys.left = keys.right = keys.hb = keys.nitro = false;
  recoverPress = false;
}

window.addEventListener('keydown', (e) => {
  if (!active || e.repeat || typing()) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.up = true; break;
    case 'KeyS': case 'ArrowDown': keys.down = true; break;
    case 'KeyA': case 'ArrowLeft': keys.left = true; break;
    case 'KeyD': case 'ArrowRight': keys.right = true; break;
    case 'Space': keys.hb = true; e.preventDefault(); break;
    case 'ShiftLeft': case 'ShiftRight': keys.nitro = true; break;
    case 'KeyR': recoverPress = true; break;
    case 'Escape':
      for (const cb of [...escCbs]) { try { cb(); } catch { /* handler isolado */ } }
      return;
    default: return;
  }
  if (e.code.startsWith('Arrow')) e.preventDefault(); // não rola a página
});

window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.up = false; break;
    case 'KeyS': case 'ArrowDown': keys.down = false; break;
    case 'KeyA': case 'ArrowLeft': keys.left = false; break;
    case 'KeyD': case 'ArrowRight': keys.right = false; break;
    case 'Space': keys.hb = false; break;
    case 'ShiftLeft': case 'ShiftRight': keys.nitro = false; break;
    default: break;
  }
});

window.addEventListener('blur', clearAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearAll(); });

/** Liga/desliga o teclado (pausa, telas de menu). Desligado devolve zeros. */
export function setActive(on) {
  active = !!on;
  if (!active) clearAll();
}

/**
 * Amostra atual. `recoverPress` é borda de subida e é CONSUMIDO na leitura
 * (edge → true uma única vez; engine lê 1×/frame).
 */
export function getInput() {
  if (!active) return { ...ZERO };
  const r = recoverPress;
  recoverPress = false;
  return {
    throttle: keys.up ? 1 : 0,
    brake: keys.down ? 1 : 0,
    steer: (keys.left ? 1 : 0) - (keys.right ? 1 : 0), // +1 = esquerda (hd↑, lat↑)
    handbrake: keys.hb,
    nitro: keys.nitro,
    recoverPress: r,
  };
}

/** cb() no Esc (sem repeat). Retorna função que remove o callback. */
export function onEsc(cb) {
  if (typeof cb !== 'function') return () => {};
  escCbs.add(cb);
  return () => escCbs.delete(cb);
}
