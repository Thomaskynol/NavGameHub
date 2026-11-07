// Protocolo WS (JSON {t,...}). Sem Node API — server e client importam.
// Compat: hello/input/snapshot do incr.1 continuam válidos; campos novos = opcionais.
// Novos (lobby autoritativo): start (host inicia), ready (prontidão real),
// shuffle (host redistribui equipes no lobby).
export const MSG = {
  HELLO: 'hello',
  INPUT: 'input',
  PING: 'ping',
  REMATCH: 'rematch',
  LEAVE: 'leave',
  START: 'start',
  READY: 'ready',
  SHUFFLE: 'shuffle',
  WELCOME: 'welcome',
  SNAPSHOT: 'snapshot',
  EVENT: 'event',
  PONG: 'pong',
};

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const bit = (v) => v === 0 || v === 1;
const optBit = (v) => v === undefined || bit(v);
const optStr = (v, max) => v === undefined || (typeof v === 'string' && v.length <= max);

// Dono opaco da partida via Hub (htok): 1..64 chars [A-Za-z0-9_-].
// Formato inválido = "sem dono" (nunca gera dono; comparação é só igualdade).
export function validHtok(v) {
  return typeof v === 'string' && v.length >= 1 && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v);
}
// Ângulos: finitos e com magnitude razoável (normalização 2π é aplicada no
// servidor; número absurdo é lixo de protocolo, não virou "limite de voo").
const ang = (v) => num(v) && Math.abs(v) <= 1e4;

export function validHello(m) {
  return (
    !!m &&
    typeof m === 'object' && !Array.isArray(m) &&
    m.t === MSG.HELLO &&
    typeof m.name === 'string' && m.name.length >= 1 && m.name.length <= 20 &&
    typeof m.room === 'string' && m.room.length >= 1 && m.room.length <= 32 &&
    (m.color === undefined || (typeof m.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.color))) &&
    (m.len === undefined || (num(m.len) && m.len >= 5 && m.len <= 3600)) &&
    (m.mode === undefined || m.mode === 'ffa' || m.mode === 'teams' || m.mode === 'survival') &&
    (m.team === undefined || m.team === 'red' || m.team === 'blue') &&
    optStr(m.htok, 64) && // token de dono via Hub (opcional)
    optStr(m.resume, 32) && // id anterior p/ reconexão 30s (opcional)
    optStr(m.resumeToken, 64) // token imprevisível de resume (opcional, nunca no snapshot)
  );
}

export function validLeave(m) {
  return !!m && typeof m === 'object' && m.t === MSG.LEAVE;
}

export function validInput(m) {
  return (
    !!m &&
    typeof m === 'object' && !Array.isArray(m) &&
    m.t === MSG.INPUT &&
    num(m.seq) &&
    bit(m.w) && bit(m.s) && bit(m.a) && bit(m.d) &&
    ang(m.yaw) && ang(m.pitch) &&
    bit(m.fire) &&
    optBit(m.boost) && // segura p/ boost
    optBit(m.w2) && // dispara míssil (arma 2)
    optBit(m.swap) && // edge: troca arma selecionada (recarga do míssil preservada)
    (m.roll === undefined || ang(m.roll)) && // mira absoluta (bank-to-turn do mouse)
    (m.thr === undefined || (num(m.thr) && m.thr >= -0.65 && m.thr <= 1.5)) && // manete analógica (modo WT)
    (m.dyaw === undefined || ang(m.dyaw)) && // desejo FP+TP (bolinha): nariz persegue com w_max
    (m.dpitch === undefined || ang(m.dpitch)) // (FP e TP enviam; sem desejo = cópia direta só p/ cliente legado)
  );
}

// host inicia a partida a partir do lobby
export function validStart(m) {
  return !!m && typeof m === 'object' && m.t === MSG.START;
}

// prontidão autoritativa (0|1)
export function validReady(m) {
  return !!m && typeof m === 'object' && m.t === MSG.READY && bit(m.v);
}

// redistribuição de equipes (só host, só lobby, só teams — checado no servidor)
export function validShuffle(m) {
  return !!m && typeof m === 'object' && m.t === MSG.SHUFFLE;
}
