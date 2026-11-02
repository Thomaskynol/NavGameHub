// Asfalto Vivo — fachada da UI (contrato canônico: ARCHITECTURE §6).
// A integração (main.js) usa somente: initUI, show, updateRoom, setConn, toast, hud.

import { createHud } from './hud.js';
import { createUI } from './screens.js';

let ui = null;
let hudApi = null;
let onAction = () => {};

const hudFacade = {
  visible(v) { hudApi?.visible(!!v); },
  update(payload) { hudApi?.update(payload); },
  notice(text, kind, ms) { hudApi?.notice(text, kind, ms); },
  countdown(n) { hudApi?.countdown(n == null ? null : Number(n)); },
  setInvalidLap(b) { hudApi?.setInvalidLap(!!b); },
};
export const hud = hudFacade;

export function initUI({ onAction: emit } = {}) {
  if (typeof emit === 'function') onAction = emit;

  const mount = document.getElementById('av-ui');
  if (!mount) throw new Error('initUI: elemento #av-ui não encontrado');

  hudApi = createHud();
  const urlRoom = new URLSearchParams(location.search).get('room') || '';

  ui = createUI({
    mount,
    hud: hudApi,
    urlRoom,
    emit: (action) => { try { onAction(action); } catch (err) { console.error('onAction falhou:', err); } },
    toast: (msg, kind) => ui?.toast(msg, kind),
  });

  mount.append(hudApi.root, ui.pauseLayer, ui.connPill, ui.toastWrap);

  // Abertura inicial: home (com destaque de convite se ?room= presente).
  show('home', urlRoom ? { roomCode: urlRoom } : undefined);
  setConn('connecting');

  return ui;
}

export function show(screen, data) {
  ui?.show(screen, data);
}

export function updateRoom(state) {
  ui?.updateRoom(state);
}

export function setConn(status, msg) {
  ui?.setConn(status, msg);
}

export function toast(msg, kind) {
  ui?.toast(msg, kind ?? 'ok');
}
