// Áudio procedural via Web Audio API — sem arquivos.
// Criado somente após primeiro gesto do usuário (política de autoplay).

export type SfxName = 'dice' | 'thunk' | 'coins' | 'fanfare' | 'error' | 'chat' | 'place' | 'select';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.7;
let muted = false;
let noiseBuf: AudioBuffer | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Chamar no primeiro gesto do usuário. */
export function unlockAudio(): void {
  ensureCtx();
}

export function setAudioPrefs(next: { volume?: number; muted?: boolean }): void {
  if (next.volume !== undefined) volume = Math.max(0, Math.min(1, next.volume));
  if (next.muted !== undefined) muted = next.muted;
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
}

function getNoise(ac: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function envGain(ac: AudioContext, t0: number, peak: number, attack: number, decay: number): GainNode {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  g.connect(master!);
  return g;
}

function tone(ac: AudioContext, t0: number, freq: number, dur: number, type: OscillatorType, peak = 0.18) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  const g = envGain(ac, t0, peak, 0.008, dur);
  osc.connect(g);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function playSfx(name: SfxName): void {
  const ac = ensureCtx();
  if (!ac || !master || muted || volume <= 0) return;
  const t = ac.currentTime;
  switch (name) {
    case 'dice': {
      const src = ac.createBufferSource();
      src.buffer = getNoise(ac);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 0.8;
      const g = envGain(ac, t, 0.3, 0.01, 0.32);
      src.connect(bp).connect(g);
      src.start(t);
      src.stop(t + 0.4);
      // dados quicando
      [0.09, 0.17, 0.26].forEach((off, i) => {
        const s2 = ac.createBufferSource();
        s2.buffer = getNoise(ac);
        const g2 = envGain(ac, t + off, 0.12 - i * 0.03, 0.004, 0.06);
        s2.connect(g2);
        s2.start(t + off);
        s2.stop(t + off + 0.1);
      });
      break;
    }
    case 'thunk':
    case 'place': {
      const osc = ac.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(name === 'thunk' ? 120 : 180, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.18);
      const g = envGain(ac, t, 0.4, 0.005, 0.2);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + 0.3);
      break;
    }
    case 'coins': {
      [880, 1174, 1568, 2093].forEach((f, i) => tone(ac, t + i * 0.06, f, 0.16, 'sine', 0.14));
      break;
    }
    case 'fanfare': {
      const notes = [523, 659, 784, 1047, 784, 1047];
      notes.forEach((f, i) => tone(ac, t + i * 0.14, f, 0.3, 'triangle', 0.16));
      break;
    }
    case 'error': {
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.18);
      const g = envGain(ac, t, 0.14, 0.005, 0.2);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + 0.25);
      break;
    }
    case 'chat': {
      tone(ac, t, 740, 0.1, 'sine', 0.1);
      tone(ac, t + 0.07, 988, 0.12, 'sine', 0.08);
      break;
    }
    case 'select': {
      tone(ac, t, 520, 0.07, 'sine', 0.08);
      break;
    }
  }
}
