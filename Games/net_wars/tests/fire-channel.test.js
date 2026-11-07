// Regressões P0-3/P0-5 (lane B: fire channel + lock audit).
// P0-3: feedback (onFired/audio) NUNCA pode engolir o pacote: ws.send roda em
// try próprio ANTES do feedback, e feedback roda em try próprio.
// P0-5 (lado testável neste lane): contrato do canal p/ lock — primeiro sample
// pós-captura sem fire acidental passa limpo; fire/w2/swap seguintes chegam ao
// servidor por canal WS real. Paths de input.js (mousedown/Escape/reentry) são
// auditados em .planning/.../progress.md (outro lane é dono do arquivo).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

// ---------- harness p/ client/net.js (browser globals stubados) ----------
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const realWebSocket = globalThis.WebSocket;
const realLocation = globalThis.location;
let timers;
let sent;
function stubNet() {
  timers = [];
  sent = [];
  globalThis.setInterval = (fn) => { timers.push(fn); return timers.length; };
  globalThis.clearInterval = () => {};
  globalThis.location = { protocol: 'http:', host: 'x' };
  globalThis.WebSocket = makeCaptureWS();
}
function makeCaptureWS() {
  return class {
    constructor() { this.readyState = 1; }
    send(s) { sent.push(JSON.parse(s)); }
    close() {}
  };
}
function unstubNet() {
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
  globalThis.WebSocket = realWebSocket;
  if (realLocation === undefined) delete globalThis.location;
  else globalThis.location = realLocation;
}
const { connect } = await import('../client/net.js');
// cada connect() arma 2 timers (input + ping); tickFresh roda o input do último
const tickFresh = () => timers[timers.length - 2]();

describe('P0-3 canal de tiro sobrevive a feedback (net.js real)', () => {
  before(stubNet);
  after(unstubNet);

  it('feedback que LANÇA exceção ainda assim envia laser/míssil/switch', () => {
    sent.length = 0;
    const mk = (seq, over = {}) => ({ t: 'input', seq, w: 0, s: 0, a: 0, d: 0, yaw: 0, pitch: 0, fire: 0, ...over });
    const queue = [mk(1, { fire: 1 }), mk(2, { w2: 1 }), mk(3, { swap: 1 })];
    connect('ws://x', () => queue.shift() ?? mk(99), {
      hello: {},
      onFired() { throw new Error('audio quebrou (simulado)'); },
    });
    tickFresh(); tickFresh(); tickFresh();
    const inputs = sent.filter((m) => m.t === 'input');
    assert.equal(inputs.length, 3, '3 ticks com feedback lançando -> 3 pacotes enviados');
    assert.equal(inputs[0].fire, 1);
    assert.equal(inputs[1].w2, 1, 'one-shot míssil chega mesmo com feedback morto');
    assert.equal(inputs[2].swap, 1, 'one-shot switch chega mesmo com feedback morto');
  });

  it('ws.send que lança não derruba o timer e não cala o feedback seguinte', () => {
    sent.length = 0;
    let feedback = 0;
    let calls = 0;
    const prevWS = globalThis.WebSocket;
    globalThis.WebSocket = class {
      constructor() { this.readyState = 1; }
      send() { if (++calls === 1) throw new Error('socket morto'); }
      close() {}
    };
    try {
      connect('ws://x', () => ({ t: 'input', seq: 1, fire: 1 }), {
        hello: {}, onFired() { feedback++; },
      });
      assert.doesNotThrow(tickFresh, 'timer nunca propaga exceção');
      assert.equal(feedback, 1, 'feedback do tick seguinte roda mesmo após falha de send');
    } finally {
      globalThis.WebSocket = prevWS;
    }
  });

  it('gate de feedback cobre fire, míssil e switch; ignora pacote vazio', () => {
    sent.length = 0;
    const seen = [];
    const mk = (over = {}) => ({ t: 'input', seq: 1, fire: 0, ...over });
    const queue = [mk({ fire: 1 }), mk({ w2: 1 }), mk({ swap: 1 }), mk()];
    connect('ws://x', () => queue.shift() ?? mk(), {
      hello: {}, onFired(m) { seen.push({ fire: !!m.fire, w2: !!m.w2, swap: !!m.swap }); },
    });
    tickFresh(); tickFresh(); tickFresh(); tickFresh();
    assert.equal(sent.filter((m) => m.t === 'input').length, 4, 'tudo é enviado, com ou sem tiro');
    assert.deepEqual(seen, [{ fire: true, w2: false, swap: false }, { fire: false, w2: true, swap: false }, { fire: false, w2: false, swap: true }],
      'feedback dispara p/ fire, w2 e swap isolados');
  });
});

describe('P0-3 main.js: gate de áudio usa variável declarada', () => {
  it('sem identificador não-declarado onFired._laser (era ReferenceError)', () => {
    const src = readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');
    // ignora comentários: o que importa é não haver USO em código
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!code.includes('onFired._laser'), 'padrão que lançava ReferenceError removido');
    assert.ok(/let lastLaserAt\s*=\s*0/.test(src), 'estado de áudio declarado (lastLaserAt)');
  });
});

// ---------- canal real: hold laser + míssil + switch contra servidor vivo ----------
// Porta única neste diretório (integration-extras usa 18111–18113): colisão
// faz o ready() enxergar o servidor vizinho e o teste validar o alvo errado.
const PORT = 18114;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function startServer(port) {
  const child = spawn('node', ['server/main.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}
async function ready(port, child) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/__hub/state`);
      if (r.ok) return;
    } catch { /* subindo */ }
    if (child.exitCode != null) throw new Error('server morreu ao subir');
    await wait(100);
  }
  throw new Error('server não subiu');
}
function liveConnect(port, room, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    const snaps = [];
    const timer = setTimeout(() => reject(new Error('timeout welcome')), 5000);
    ws.on('message', (buf) => {
      try {
        const m = JSON.parse(String(buf));
        if (m.t === 'welcome') { clearTimeout(timer); resolve({ ws, snaps, welcome: m }); }
        else if (m.t === 'snapshot') snaps.push(m);
      } catch { /* ignora */ }
    });
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, room })));
  });
}
const sendInput = (ws, seq, over = {}) => ws.send(JSON.stringify({
  t: 'input', seq, w: 0, s: 0, a: 0, d: 0, yaw: 0, pitch: 0, fire: 0, ...over,
}));

describe('P0-3/P0-5 canal real: hold-laser/míssil/switch chegam ao servidor', () => {
  it('rajada segurada gera ≥2 lasers; w2 gera míssil; swap troca arma', async () => {
    const srv = startServer(PORT);
    try {
      await ready(PORT, srv);
      const c = await liveConnect(PORT, 'fire1', 'shooter');
      c.ws.send(JSON.stringify({ t: 'start' })); // host inicia (lobby -> playing)
      // espera playing
      let playing = false;
      for (let i = 0; i < 40 && !playing; i++) {
        await wait(100);
        playing = c.snaps.some((s) => s.state === 'playing');
      }
      assert.ok(playing, 'sala entrou em playing após START do host');
      // HOLD laser: 20 inputs fire:1 a cada 60ms (~1.2s; cadência 0.5s -> ≥2 tiros)
      for (let i = 1; i <= 20; i++) { sendInput(c.ws, i, { fire: 1 }); await wait(60); }
      await wait(400);
      const laserIds = new Set();
      for (const s of c.snaps) for (const l of s.lasers || []) laserIds.add(l.id);
      assert.ok(laserIds.size >= 2, `hold gerou ≥2 lasers distintos (viu ${laserIds.size})`);
      // MÍSSIL one-shot
      c.snaps.length = 0;
      sendInput(c.ws, 101, { w2: 1 });
      let sawMissile = false;
      for (let i = 0; i < 20 && !sawMissile; i++) {
        await wait(100);
        sawMissile = c.snaps.some((s) => (s.missiles || []).length >= 1);
      }
      assert.ok(sawMissile, 'w2 one-shot virou míssil no snapshot');
      // SWITCH one-shot
      const before = c.snaps.at(-1)?.ships?.find((s) => s.id === c.welcome.id)?.weapon;
      sendInput(c.ws, 201, { swap: 1 });
      let after = before;
      for (let i = 0; i < 20 && after === before; i++) {
        await wait(100);
        after = c.snaps.at(-1)?.ships?.find((s) => s.id === c.welcome.id)?.weapon;
      }
      assert.notEqual(after, before, `swap trocou a arma (${before} -> ${after})`);
      c.ws.close();
    } finally {
      srv.kill();
      await wait(300);
    }
  });
});
