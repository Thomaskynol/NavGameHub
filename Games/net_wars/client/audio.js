// Áudio 100% local: WebAudio sintetizado, sem assets externos.
// Uso: const au = createAudio(settings); au.unlock(); au.laser(); ...
// Motor em loop único (sem duplicar); aba oculta silencia (suspend).
export function createAudio(getSettings) {
  let ctx = null;
  let master = null;
  let engine = null; // { osc, osc2, noise, gain, filter }
  let lastLaser = 0;
  let lastNoise = 0;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      applyVolume();
      document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend().catch(() => {});
        else if (!getSettings().mute) ctx.resume().catch(() => {});
      });
      return true;
    } catch { return false; }
  }

  function applyVolume() {
    if (!ctx || !master) return;
    const s = getSettings();
    master.gain.value = s.mute ? 0 : (s.volume ?? 0.6);
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  // envelope simples: osc -> gain -> master
  function tone({ f0 = 440, f1 = null, type = 'square', dur = 0.12, vol = 0.25, delay = 0 }) {
    if (!ensure()) return;
    if (getSettings().mute || getSettings().reduceFx && vol > 0.2) vol = 0.2;
    const t = now() + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise({ dur = 0.3, vol = 0.3, fc = 1200, q = 0.8, delay = 0, slideTo = null }) {
    if (!ensure()) return;
    if (getSettings().mute) return;
    const t = now() + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.setValueAtTime(fc, t); flt.Q.value = q;
    if (slideTo) flt.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  function engineStart() {
    if (!ensure() || engine) return;
    try {
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 110;
      const g = ctx.createGain(); g.gain.value = 0.0;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
      o1.start(); o2.start();
      engine = { o1, o2, g, f };
    } catch { engine = null; }
  }

  function engineUpdate(thrust, boost, alive) {
    if (!ctx || !engine) return;
    const t = now();
    const target = !alive ? 0 : 0.05 + thrust * 0.06 + (boost ? 0.08 : 0);
    engine.g.gain.setTargetAtTime(target, t, 0.08);
    engine.o1.frequency.setTargetAtTime(55 + thrust * 30 + (boost ? 45 : 0), t, 0.1);
    engine.f.frequency.setTargetAtTime(320 + thrust * 400 + (boost ? 900 : 0), t, 0.1);
  }

  function engineStop() {
    if (!ctx || !engine) { engine = null; return; }
    try {
      const e = engine; engine = null;
      e.g.gain.setTargetAtTime(0, now(), 0.05);
      setTimeout(() => { try { e.o1.stop(); e.o2.stop(); } catch {} }, 300);
    } catch { engine = null; }
  }

  return {
    // chama no primeiro clique (pointer-lock) — libera AudioContext
    unlock() {
      if (!ensure()) return;
      ctx.resume().catch(() => {});
      engineStart();
    },
    refresh() { applyVolume(); if (ctx && document.hidden) ctx.suspend().catch(() => {}); },
    engine: engineUpdate,
    shutdown() { engineStop(); },
    click() { tone({ f0: 660, f1: 440, type: 'sine', dur: 0.07, vol: 0.15 }); },
    hover() { tone({ f0: 880, type: 'sine', dur: 0.03, vol: 0.05 }); },
    laser() {
      const t = performance.now();
      if (t - lastLaser < 400) return; // casa com a cadência do servidor (0.5s)
      lastLaser = t;
      tone({ f0: 920, f1: 210, type: 'square', dur: 0.13, vol: 0.16 });
    },
    missile() { noise({ dur: 0.35, vol: 0.25, fc: 2500, slideTo: 300 }); tone({ f0: 140, f1: 60, type: 'sine', dur: 0.3, vol: 0.3 }); },
    lockStart() { tone({ f0: 1200, type: 'sine', dur: 0.08, vol: 0.18 }); },
    lockOn() { tone({ f0: 1200, type: 'sine', dur: 0.08, vol: 0.2 }); tone({ f0: 1600, type: 'sine', dur: 0.1, vol: 0.2, delay: 0.09 }); },
    lockAlert() { tone({ f0: 500, f1: 900, type: 'sawtooth', dur: 0.18, vol: 0.22 }); },
    hit() { tone({ f0: 1500, f1: 900, type: 'triangle', dur: 0.07, vol: 0.22 }); },
    hurt() { tone({ f0: 300, f1: 120, type: 'sawtooth', dur: 0.2, vol: 0.25 }); },
    shieldHit() { tone({ f0: 700, f1: 1400, type: 'sine', dur: 0.18, vol: 0.2 }); tone({ f0: 350, f1: 700, type: 'triangle', dur: 0.15, vol: 0.12 }); },
    collide() {
      const t = performance.now();
      if (t - lastNoise < 250) return;
      lastNoise = t;
      tone({ f0: 120, f1: 50, type: 'sine', dur: 0.22, vol: 0.3 });
    },
    explosion() { noise({ dur: 0.6, vol: 0.4, fc: 3000, slideTo: 120 }); tone({ f0: 100, f1: 35, type: 'sine', dur: 0.55, vol: 0.35 }); },
    pickup() { tone({ f0: 523, type: 'sine', dur: 0.09, vol: 0.2 }); tone({ f0: 659, type: 'sine', dur: 0.09, vol: 0.2, delay: 0.08 }); tone({ f0: 784, type: 'sine', dur: 0.14, vol: 0.22, delay: 0.16 }); },
    powerDown() { tone({ f0: 784, type: 'sine', dur: 0.1, vol: 0.18 }); tone({ f0: 523, type: 'sine', dur: 0.16, vol: 0.18, delay: 0.1 }); },
    count(n) { tone({ f0: n === 0 ? 880 : 440, type: 'sine', dur: n === 0 ? 0.35 : 0.12, vol: 0.25 }); },
    start() { tone({ f0: 392, type: 'sawtooth', dur: 0.15, vol: 0.15 }); tone({ f0: 523, type: 'sawtooth', dur: 0.2, vol: 0.15, delay: 0.12 }); },
    wave() { tone({ f0: 660, type: 'triangle', dur: 0.15, vol: 0.2 }); tone({ f0: 990, type: 'triangle', dur: 0.2, vol: 0.2, delay: 0.14 }); },
    gameOver(win) {
      if (win) { [523, 659, 784, 1046].forEach((f, i) => tone({ f0: f, type: 'triangle', dur: 0.2, vol: 0.22, delay: i * 0.14 })); }
      else { [400, 340, 280, 200].forEach((f, i) => tone({ f0: f, type: 'sawtooth', dur: 0.22, vol: 0.16, delay: i * 0.15 })); }
    },
  };
}
