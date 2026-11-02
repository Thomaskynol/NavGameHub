// public/js/audio.js — fachada de áudio (ARCHITECTURE.md §6, SPEC.md §16)
// Tudo sintetizado com WebAudio API. Sem assets externos, sem imports do projeto.
// Robustez: no-op seguro sem AudioContext/inicialização; nenhum throw em browser.

'use strict';

const CLIP = 0.0001;   // floor p/ ramps exponenciais (nunca 0)
const HEADROOM = 0.6;  // espaço no master p/ som dinâmico sem clipping

let ctx = null;
let master = null;
let noiseBuf = null;   // NoiseBuffer criado 1x e reusado

let vol01 = 0.8;
let isMuted = false;
let duckExt = false;     // duck(bool) externo
let duckHidden = false;  // visibilitychange automático

let gestureBound = false;
let visibilityBound = false;

// ---------------------------------------------------------------- utilidades

function clamp01(v) {
  v = +v;
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function safe(fn) {
  try { fn(); } catch (_) { /* áudio nunca derruba o jogo */ }
}

function masterTarget() {
  return (isMuted || duckExt || duckHidden) ? 0 : clamp01(vol01) * HEADROOM;
}

function applyMaster(rampS) {
  if (!ctx || !master) return;
  const g = master.gain;
  const t = ctx.currentTime;
  const target = masterTarget();
  const dur = Math.max(0, rampS || 0);
  try {
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    if (dur > 0) g.linearRampToValueAtTime(target, t + dur);
    else g.setValueAtTime(target, t);
  } catch (_) {}
}

function tryResume() {
  if (!ctx || ctx.state !== 'suspended') return;
  const p = ctx.resume();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

function bindGestures() {
  if (gestureBound) return;
  if (typeof window === 'undefined' || !window.addEventListener) return;
  gestureBound = true;
  const kick = () => safe(tryResume);
  try {
    window.addEventListener('pointerdown', kick, { passive: true });
    window.addEventListener('keydown', kick, { passive: true });
  } catch (_) { gestureBound = false; }
}

function bindVisibility() {
  if (visibilityBound) return;
  if (typeof document === 'undefined' || !document.addEventListener) return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    duckHidden = !!document.hidden;
    safe(() => applyMaster(duckHidden ? 0.1 : 0.15));
    if (!duckHidden) safe(tryResume); // aba visível: garante contexto rodando
  });
}

function ensureCtx() {
  if (ctx) return ctx;
  const AC = (typeof window !== 'undefined')
    ? (window.AudioContext || window.webkitAudioContext)
    : null;
  if (!AC) return null;
  let c = null;
  let g = null;
  try {
    c = new AC();
    g = c.createGain();
    g.connect(c.destination);
  } catch (_) {
    try { if (c && c.close) c.close(); } catch (__) {}
    return null;
  }
  ctx = c;
  master = g;
  applyMaster(0);          // volume/mute/duck já configurados valem desde o 1º ctx
  bindGestures();
  bindVisibility();
  safe(tryResume);         // se já houve gesto, pode retomar já
  return ctx;
}

function getNoise() {
  if (!ctx) return null;
  if (noiseBuf) return noiseBuf;
  try {
    const len = Math.max(1, Math.floor(ctx.sampleRate * 2));
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = b;
  } catch (_) { return null; }
  return noiseBuf;
}

/** Fade de ganho + para fontes + desconecta tudo (sem nós órfãos). */
function fadeCleanup(g, sources, all, fadeS) {
  if (!ctx || !g) return;
  const t = ctx.currentTime;
  try {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + fadeS);
  } catch (_) {}
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const n of all) { if (n) { try { n.disconnect(); } catch (_) {} } }
  };
  let started = false;
  for (const s of sources) {
    if (!s) continue;
    try { s.stop(t + fadeS + 0.05); started = true; } catch (_) {}
    try { s.onended = cleanup; } catch (_) {}
  }
  if (!started) cleanup();
}

// ---------------------------------------------------------------- primitivas

function tone(o) {
  if (!ctx || !master) return;
  try {
    const t0 = ctx.currentTime + (o.at || 0);
    const dur = Math.max(0.02, o.dur || 0.12);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'square';
    const f0 = Math.max(20, o.f0 || 440);
    osc.frequency.setValueAtTime(f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + dur);

    const g = ctx.createGain();
    const peak = Math.max(CLIP, o.vol || 0.2);
    const atk = Math.min(Math.max(0.003, o.attack || 0.008), dur * 0.5);
    g.gain.setValueAtTime(CLIP, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(CLIP, t0 + dur);

    let tail = osc;
    const extra = [];
    if (o.lp) { // opcional: suaviza serrilhado p/ timbre menos "robô"
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      f.Q.value = o.q || 0.8;
      osc.connect(f);
      tail = f;
      extra.push(f);
    }
    tail.connect(g);
    g.connect(o.dest || master);

    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    osc.onended = () => {
      for (const n of [osc, ...extra, g]) { try { n.disconnect(); } catch (_) {} }
      osc.onended = null;
    };
  } catch (_) {}
}

function noise(o) {
  if (!ctx || !master) return;
  const buf = getNoise();
  if (!buf) return;
  try {
    const t0 = ctx.currentTime + (o.at || 0);
    const dur = Math.max(0.03, o.dur || 0.2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true; // buffer reusado; stop() encerra antes do fim
    if (o.rate) src.playbackRate.value = o.rate;

    const bp = ctx.createBiquadFilter();
    bp.type = o.type || 'bandpass';
    bp.Q.value = o.q != null ? o.q : 1;
    const f0 = Math.max(20, o.f0 || 1000);
    bp.frequency.setValueAtTime(f0, t0);
    if (o.f1) bp.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + dur);

    const g = ctx.createGain();
    const peak = Math.max(CLIP, o.vol || 0.3);
    const atk = Math.min(Math.max(0.003, o.attack || 0.012), dur * 0.5);
    g.gain.setValueAtTime(CLIP, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(CLIP, t0 + dur);

    src.connect(bp);
    bp.connect(g);
    g.connect(o.dest || master);

    src.start(t0);
    src.stop(t0 + dur + 0.03);
    src.onended = () => {
      for (const n of [src, bp, g]) { try { n.disconnect(); } catch (_) {} }
      src.onended = null;
    };
  } catch (_) {}
}

// ---------------------------------------------------------------- sfx

function playSfx(name) {
  if (!ctx || !master) return;
  switch (name) {
    case 'click': // blip curto discreto
      tone({ f0: 1500, f1: 950, dur: 0.05, vol: 0.14, type: 'square', attack: 0.004 });
      break;
    case 'menu_open': // blip curto, tom mais "macio" que o click
      tone({ f0: 700, f1: 1150, dur: 0.09, vol: 0.16, type: 'triangle', attack: 0.006 });
      break;
    case 'join': // blip positivo: duas notas ascendentes
      tone({ f0: 660, dur: 0.07, vol: 0.2, type: 'square', attack: 0.005 });
      tone({ f0: 990, dur: 0.11, vol: 0.2, type: 'square', at: 0.07, attack: 0.005 });
      break;
    case 'countdown': // beep curto 440 Hz + brilho suave
      tone({ f0: 440, dur: 0.13, vol: 0.26, type: 'square', attack: 0.006 });
      tone({ f0: 880, dur: 0.13, vol: 0.07, type: 'square', attack: 0.006 });
      break;
    case 'go': // beep agudo com sweep p/ cima + sub + ruído de largada
      tone({ f0: 880, f1: 1760, dur: 0.42, vol: 0.3, type: 'square', attack: 0.006 });
      tone({ f0: 220, f1: 440, dur: 0.42, vol: 0.16, type: 'sawtooth', attack: 0.006 });
      noise({ dur: 0.3, vol: 0.1, f0: 900, f1: 4000, type: 'bandpass', q: 0.8 });
      break;
    case 'lap': // duas notas (dó → sol)
      tone({ f0: 523, dur: 0.1, vol: 0.24, type: 'triangle', attack: 0.005 });
      tone({ f0: 784, dur: 0.16, vol: 0.24, type: 'triangle', at: 0.1, attack: 0.005 });
      break;
    case 'finish': // arpejo curto alegre (dó-mi-sol-dó)
      tone({ f0: 523, dur: 0.1, vol: 0.22, type: 'square', attack: 0.005 });
      tone({ f0: 659, dur: 0.1, vol: 0.22, type: 'square', at: 0.09, attack: 0.005 });
      tone({ f0: 784, dur: 0.1, vol: 0.22, type: 'square', at: 0.18, attack: 0.005 });
      tone({ f0: 1047, dur: 0.3, vol: 0.24, type: 'square', at: 0.27, attack: 0.005 });
      break;
    case 'collide': // thump grave + estouro de ruído + click
      tone({ f0: 150, f1: 55, dur: 0.22, vol: 0.5, type: 'sine', attack: 0.003 });
      noise({ dur: 0.16, vol: 0.3, f0: 1400, f1: 350, type: 'lowpass', q: 0.9 });
      noise({ dur: 0.03, vol: 0.18, f0: 3500, type: 'highpass', q: 0.7, attack: 0.003 });
      break;
    case 'wall': // thud mais grave que o collide
      tone({ f0: 95, f1: 42, dur: 0.3, vol: 0.5, type: 'sine', attack: 0.004 });
      noise({ dur: 0.2, vol: 0.22, f0: 500, f1: 160, type: 'lowpass', q: 1.1 });
      break;
    case 'wrongway': // buzzer duplo grave (dois buzzes com pausa)
      tone({ f0: 140, dur: 0.14, vol: 0.3, type: 'sawtooth', attack: 0.004, lp: 900 });
      tone({ f0: 133, dur: 0.2, vol: 0.3, type: 'sawtooth', at: 0.19, attack: 0.004, lp: 900 });
      break;
    case 'error': // buzz grave curto, tom caindo
      tone({ f0: 130, f1: 100, dur: 0.18, vol: 0.28, type: 'sawtooth', attack: 0.004, lp: 700 });
      break;
    case 'recover': // swoosh: varredura de bandpass p/ cima + tom de apoio
      noise({ dur: 0.35, vol: 0.3, f0: 350, f1: 3200, type: 'bandpass', q: 1.4 });
      tone({ f0: 240, f1: 720, dur: 0.32, vol: 0.12, type: 'triangle', attack: 0.02 });
      break;
    case 'nitro': // blip especial: sweep agudo + hiss
      tone({ f0: 320, f1: 1500, dur: 0.22, vol: 0.3, type: 'sawtooth', attack: 0.005, lp: 4000 });
      noise({ dur: 0.22, vol: 0.14, f0: 1200, f1: 5000, type: 'highpass', q: 0.8 });
      break;
    default:
      break; // nome desconhecido: no-op
  }
}

// ---------------------------------------------------------------- motor

const eng = { on: false, o1: null, o2: null, lp: null, h: null, g: null };

function engineUpdate(rpm01, load01, moving) {
  if (!ctx || !eng.on || !eng.g) return;
  const r = clamp01(rpm01);
  const l = clamp01(load01);
  const mv = !!moving;
  const t = ctx.currentTime;
  const f = 50 + r * 110; // 50–160 Hz conforme rpm
  // setTargetAtTime = suavização por chamada; call isolada não zapa
  eng.o1.frequency.setTargetAtTime(f, t, 0.06);
  eng.o2.frequency.setTargetAtTime(f * 2, t, 0.06); // harmônico (2x, levemente desafinado)
  eng.lp.frequency.setTargetAtTime(260 + r * 2400 + l * 500, t, 0.09);
  const target = mv ? 0.05 + l * 0.16 : 0.006; // parado ≈ inaudível; andando alto
  eng.g.gain.setTargetAtTime(target, t, 0.12);
}

function engineStart() {
  safe(() => {
    const c = ensureCtx();
    if (!c || eng.on) return;
    const o1 = c.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 55;
    const o2 = c.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = 110;
    o2.detune.value = 9; // batimento p/ growl, não robô
    const h = c.createGain();
    h.gain.value = 0.4;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    lp.Q.value = 3;
    const g = c.createGain();
    g.gain.value = CLIP;
    o1.connect(lp);
    o2.connect(h);
    h.connect(lp);
    lp.connect(g);
    g.connect(master);
    o1.start();
    o2.start();
    eng.o1 = o1; eng.o2 = o2; eng.lp = lp; eng.h = h; eng.g = g;
    eng.on = true;
    g.gain.setTargetAtTime(0.006, c.currentTime, 0.06); // espera update()
  });
}

function engineStop() {
  safe(() => {
    if (!eng.on) return;
    eng.on = false;
    const nodes = [eng.o1, eng.o2, eng.lp, eng.h, eng.g];
    eng.o1 = eng.o2 = eng.lp = eng.h = eng.g = null;
    if (!ctx) return;
    fadeCleanup(nodes[4], [nodes[0], nodes[1]], nodes, 0.12);
  });
}

// ---------------------------------------------------------------- nitro contínuo

const nit = { on: false, src: null, bp: null, o1: null, o2: null, hg: null, g: null };

function nitroStart() {
  const buf = getNoise();
  if (!ctx || !buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1400;
  bp.Q.value = 0.9;
  const o1 = ctx.createOscillator();
  o1.type = 'sawtooth';
  o1.frequency.value = 170;
  o1.detune.value = -9; // tom desafinado (par batendo)
  const o2 = ctx.createOscillator();
  o2.type = 'sawtooth';
  o2.frequency.value = 170;
  o2.detune.value = 10;
  const hg = ctx.createGain();
  hg.gain.value = 0.35;
  const g = ctx.createGain();
  g.gain.value = CLIP;
  src.connect(bp); bp.connect(g);
  o1.connect(hg); o2.connect(hg); hg.connect(g);
  g.connect(master);
  src.start(); o1.start(); o2.start();
  nit.src = src; nit.bp = bp; nit.o1 = o1; nit.o2 = o2; nit.hg = hg; nit.g = g;
  nit.on = true;
  g.gain.setTargetAtTime(0.16, ctx.currentTime, 0.06);
}

function nitroStop() {
  const nodes = [nit.src, nit.bp, nit.o1, nit.o2, nit.hg, nit.g];
  nit.src = nit.bp = nit.o1 = nit.o2 = nit.hg = nit.g = null;
  if (!ctx) return;
  fadeCleanup(nodes[5], [nodes[0], nodes[2], nodes[3]], nodes, 0.15);
}

// ---------------------------------------------------------------- derrapagem

const skd = { on: false, src: null, bp: null, g: null };

function skidStart() {
  const buf = getNoise();
  if (!ctx || !buf) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 800;
  bp.Q.value = 1.1;
  const g = ctx.createGain();
  g.gain.value = CLIP;
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start();
  skd.src = src; skd.bp = bp; skd.g = g;
  skd.on = true;
  return true;
}

function skidStop() {
  const nodes = [skd.src, skd.bp, skd.g];
  skd.src = skd.bp = skd.g = null;
  if (!ctx) return;
  fadeCleanup(nodes[2], [nodes[0]], nodes, 0.08);
}

// ---------------------------------------------------------------- fachada

export function initAudio() {
  safe(() => {
    ensureCtx();   // cria AudioContext (fica suspended até gesto)
    tryResume();   // idempotente: só age se suspended
  });
}

export function setAudioVolume(v01, muted) {
  safe(() => {
    const v = +v01;
    if (Number.isFinite(v)) vol01 = clamp01(v);
    isMuted = !!muted;
    applyMaster(0.05);
  });
}

export function sfx(name) {
  safe(() => playSfx(name));
}

export const engine = {
  start() { engineStart(); },
  stop() { engineStop(); },
  update(rpm01, load01, moving) { safe(() => engineUpdate(rpm01, load01, moving)); },
};

export function nitroSfx(active) {
  safe(() => {
    if (!ctx || !master) return;
    const want = !!active;
    if (want === nit.on) return; // idempotente
    if (want) nitroStart();
    else nitroStop();
  });
}

export function skidSfx(level01) {
  safe(() => {
    if (!ctx || !master) return;
    const lvl = clamp01(level01);
    if (lvl <= 0.01) {
      if (skd.on) { skd.on = false; skidStop(); }
      return;
    }
    if (!skd.on && !skidStart()) return;
    const t = ctx.currentTime;
    skd.g.gain.setTargetAtTime(lvl * 0.25, t, 0.05);
    skd.bp.frequency.setTargetAtTime(800 + lvl * 1200, t, 0.08); // 800–2000 Hz
  });
}

export function duck(bool) {
  safe(() => {
    duckExt = !!bool;
    applyMaster(duckExt ? 0.1 : 0.15);
  });
}
