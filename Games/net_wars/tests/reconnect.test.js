// Follow-up Lane B: retry só pós-WELCOME (a), reconnect lobby/fim via wantConn (b),
// denied DUP/explícito + resume expirado (c), blur→neutral sem flag de protocolo (d),
// cadência de envio < INPUT_STALE_MS (e).
// net.js é testado de verdade (importável com stubs); main.js (não importável em
// Node: boot DOM + three.js) tem a fiação travada por padrão de código + contratos
// ao vivo contra servidor real (porta efêmera).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { INPUT_STALE_MS } from '../shared/constants.js';
import { connect, createRetryPolicy, isExplicitClose } from '../client/net.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mainCode = () => {
  const src = readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
};

// ---------- globals save/restore (cada describe isola o seu stub) ----------
function snapGlobals() {
  return {
    si: globalThis.setInterval, ci: globalThis.clearInterval,
    st: globalThis.setTimeout, ct: globalThis.clearTimeout,
    ws: globalThis.WebSocket, loc: globalThis.location,
    doc: globalThis.document, al: globalThis.addEventListener,
  };
}
function restoreGlobals(g) {
  globalThis.setInterval = g.si; globalThis.clearInterval = g.ci;
  globalThis.setTimeout = g.st; globalThis.clearTimeout = g.ct;
  globalThis.WebSocket = g.ws;
  if (g.loc === undefined) delete globalThis.location; else globalThis.location = g.loc;
  if (g.doc === undefined) delete globalThis.document; else globalThis.document = g.doc;
  if (g.al === undefined) delete globalThis.addEventListener; else globalThis.addEventListener = g.al;
}

describe('retry policy (a): pre-WELCOME close conta, sucesso pós-WELCOME zera', () => {
  it('3 closes pré-WELCOME armam retry com backoff 1s/2s/4s; 4º não arma', async () => {
    const pol = createRetryPolicy(3, 20); // base curta p/ teste rápido (proporção 1x/2x/4x)
    const fired = [];
    // sequência real: cada close arma, o timer dispara (conta), próximo close arma…
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      assert.ok(pol.arm(() => fired.push([i, Date.now() - t0])), `tentativa ${i + 1} arma`);
      await wait(20 * (2 ** i) + 25);
    }
    assert.deepEqual(fired.map(([i]) => i), [0, 1, 2], 'os 3 retries disparam');
    for (const [i, el] of fired) {
      const want = 20 * (2 ** i);
      assert.ok(el >= want && el < want + 25, `backoff ${i + 1} ≈ ${want}ms (veio ${el}ms)`);
    }
    assert.ok(pol.exhausted(), 'após 3 closes pré-WELCOME, esgotado');
    assert.ok(!pol.arm(() => fired.push([99, 0])), '4ª tentativa não arma');
    await wait(120);
    assert.equal(fired.length, 3, 'nenhum retry a mais');
  });

  it('reset() pós-WELCOME zera a conta (bug era zerar no onOpen)', async () => {
    const pol = createRetryPolicy(3, 10);
    for (let i = 0; i < 2; i++) { pol.arm(() => {}); await wait(10 * (2 ** i) + 25); }
    assert.equal(pol.tries, 2, '2 closes pré-WELCOME contados');
    pol.reset(); // ← onWelcome faz isso; onOpen NÃO (fix a)
    assert.equal(pol.tries, 0, 'sucesso pós-WELCOME zera');
    assert.ok(!pol.exhausted());
    assert.ok(pol.arm(() => {}), 'ciclo novo permite 3 de novo');
    await wait(35);
  });

  it('reset()/cancel() desarmam timer pendente (um timer por vez)', async () => {
    const pol = createRetryPolicy(3, 15);
    let n = 0;
    assert.ok(pol.arm(() => n++));
    pol.reset();
    await wait(50);
    assert.equal(n, 0, 'timer pendente cancelado pelo reset');
  });
});

describe('explicit close (a)(c): sem retry p/ 1008/1013/hub-close', () => {
  it('isExplicitClose classifica 1008, 1013 e hub-close; resto repete', () => {
    assert.ok(isExplicitClose(1008, 'bad hello'));
    assert.ok(isExplicitClose(1013, 'DUP'));
    assert.ok(isExplicitClose(1000, 'hub close'));
    assert.ok(!isExplicitClose(1000, ''));
    assert.ok(!isExplicitClose(1000, undefined));
    assert.ok(!isExplicitClose(1006, 'abnormal'));
    assert.ok(!isExplicitClose(undefined, undefined));
    assert.ok(!isExplicitClose(1011, 'internal error'));
  });

  it('net.js repassa code/reason do close ao onClose', () => {
    const g = snapGlobals();
    try {
      let timerFn;
      globalThis.setInterval = (fn) => { timerFn = fn; return 1; };
      globalThis.clearInterval = () => {};
      globalThis.location = { protocol: 'http:', host: 'x' };
      let onclose;
      globalThis.WebSocket = class {
        constructor() { this.readyState = 1; this.onclose = null; }
        send() {}
        close() {}
      };
      let seen = null;
      const c = connect('ws://x', () => ({ t: 'input', seq: 1, fire: 0 }), {
        hello: {}, onClose: (code, reason) => { seen = [code, reason]; },
      });
      // captura o handler registrado no fake socket: re-conecta com espião
      let sock;
      globalThis.WebSocket = class {
        constructor() { this.readyState = 1; sock = this; }
        send() {}
        close() {}
      };
      const c2 = connect('ws://x', () => ({ t: 'input', seq: 1, fire: 0 }), {
        hello: {}, onClose: (code, reason) => { seen = [code, reason]; },
      });
      sock.onclose({ code: 1008, reason: 'bad hello' });
      assert.deepEqual(seen, [1008, 'bad hello'], 'onClose recebe (code, reason)');
      c.close(); c2.close();
    } finally {
      restoreGlobals(g);
    }
  });
});

describe('blur→neutral (d): aba oculta zera atuação, preserva atitude/seq', () => {
  let g, timers, sent, listeners, docStub;
  before(() => {
    g = snapGlobals();
    timers = []; sent = []; listeners = {};
    globalThis.setInterval = (fn) => { timers.push(fn); return timers.length; };
    globalThis.clearInterval = () => {};
    globalThis.location = { protocol: 'http:', host: 'x' };
    globalThis.WebSocket = class {
      constructor() { this.readyState = 1; }
      send(s) { sent.push(JSON.parse(s)); }
      close() {}
    };
    docStub = {
      hidden: false,
      addEventListener: (ev, fn) => { (listeners[ev] ??= []).push(fn); },
    };
    globalThis.document = docStub;
    globalThis.addEventListener = (ev, fn) => { (listeners[ev] ??= []).push(fn); };
  });
  after(() => restoreGlobals(g));
  const tickFresh = () => timers[timers.length - 2]();
  const fireVis = (hidden) => {
    docStub.hidden = hidden;
    for (const fn of listeners.visibilitychange || []) fn();
  };

  it('oculta: fire/w2/swap/boost/w/s/thr zerados; yaw/pitch/seq intactos', () => {
    sent.length = 0;
    connect('ws://x', () => ({ t: 'input', seq: 7, w: 1, s: 0, a: 0, d: 0, yaw: 0.5, pitch: -0.2, roll: 0.1, thr: 0.65, fire: 1, boost: 1, w2: 1, swap: 1 }), { hello: {} });
    fireVis(true);
    tickFresh();
    const m = sent.at(-1);
    assert.equal(m.fire, 0); assert.equal(m.w2, 0); assert.equal(m.swap, 0);
    assert.equal(m.boost, 0); assert.equal(m.w, 0); assert.equal(m.s, 0); assert.equal(m.thr, 0);
    assert.equal(m.yaw, 0.5); assert.equal(m.pitch, -0.2); assert.equal(m.seq, 7);
    fireVis(false); // devolve p/ não vazar estado entre testes
  });

  it('visível de novo: passa limpo; pagehide também neutraliza', () => {
    sent.length = 0;
    tickFresh();
    assert.equal(sent.at(-1).fire, 1, 'visível transmite atuação');
    for (const fn of listeners.pagehide || []) fn();
    tickFresh();
    assert.equal(sent.at(-1).fire, 0, 'pagehide neutraliza');
    fireVis(false);
    tickFresh();
    assert.equal(sent.at(-1).fire, 1, 'visibilitychange visível restaura');
  });
});

describe('cadência de envio (e): 20Hz << INPUT_STALE_MS', () => {
  it(`gaps reais < ${INPUT_STALE_MS}ms e contagem ~20Hz`, async () => {
    const g = snapGlobals();
    try {
      const ts = [];
      globalThis.location = { protocol: 'http:', host: 'x' };
      globalThis.WebSocket = class {
        constructor() { this.readyState = 1; }
        send() { ts.push(performance.now()); }
        close() {}
      };
      const c = connect('ws://x', () => ({ t: 'input', seq: 1, fire: 0 }), { hello: {} });
      await wait(350);
      c.close();
      assert.ok(ts.length >= 4, `~20Hz em 350ms (viu ${ts.length})`);
      const gaps = ts.slice(1).map((t, i) => t - ts[i]);
      assert.ok(Math.max(...gaps) < INPUT_STALE_MS, `maior gap ${Math.max(...gaps).toFixed(0)}ms < ${INPUT_STALE_MS}ms`);
    } finally {
      restoreGlobals(g);
    }
  });
});

describe('main.js fiação (padrão travado; sem browser não executa)', () => {
  it('(a) reset de retry SÓ no onWelcome, nunca no onOpen', () => {
    const code = mainCode();
    assert.ok(!code.includes('reconnTries') && !code.includes('reconnTimer'), 'contador antigo removido');
    assert.ok(code.includes('backoff.reset()'), 'policy usada');
    assert.ok(/onWelcome\(m\)[\s\S]{0,400}?backoff\.reset\(\)/.test(code), 'onWelcome zera pós-WELCOME');
    assert.ok(!/onOpen\(\)\s*\{[^}]*backoff/.test(code), 'onOpen não toca retry');
  });

  it('(b) reconnect vale p/ lobby/fim (wantConn), cancela em saída explícita', () => {
    const code = mainCode();
    assert.ok(code.includes('let wantConn = false'), 'intenção de sessão declarada');
    const sched = code.slice(code.indexOf('function scheduleReconnect'));
    const schedBody = sched.slice(0, 400);
    assert.ok(schedBody.includes('if (!wantConn) return'), 'scheduleReconnect respeita wantConn');
    assert.ok(!schedBody.includes('inMatch'), 'gate antigo só-inMatch removido do retry');
    assert.ok(code.includes('if (wantConn)'), 'onClose respeita wantConn');
  });

  it('(c) denied DUP + razão explícita + resume expirado surfados', () => {
    const code = mainCode();
    assert.ok(code.includes("'DUP'"), 'DUP tem mensagem própria');
    assert.ok(code.includes('ev.reason ?'), 'razão desconhecida é surfada, não engolida');
    assert.ok(code.includes('wantConn = false'), 'denied cancela retry');
    assert.ok(code.includes('sessão anterior expirou'), 'resume expirado avisa');
  });

  it('(a)(c) close explícito derruba p/ menu sem retry', () => {
    const code = mainCode();
    assert.ok(code.includes('isExplicitClose(code, reason)'), 'onClose classifica');
    assert.ok(code.includes("from './net.js'") || code.includes('from "./net.js"'), 'import existe');
  });
});

// ---------- servidor real, porta efêmera: contratos que o cliente pressupõe ----------
function startEphemeral() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['server/main.js'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const to = setTimeout(() => reject(new Error('server não subiu (timeout)')), 10000);
    child.stdout.on('data', (d) => {
      out += String(d);
      const m = out.match(/:(\d+) \(MATCH/);
      if (m) { clearTimeout(to); resolve({ child, port: Number(m[1]) }); }
    });
    child.on('exit', () => { clearTimeout(to); reject(new Error('server morreu ao subir')); });
  });
}
function rawHello(port, hello, collect = 4000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    const got = { welcome: null, denied: null, code: null, reason: null, snaps: [], over: null };
    ws.on('message', (buf) => {
      try {
        const m = JSON.parse(String(buf));
        if (m.t === 'welcome') got.welcome = m;
        else if (m.kind === 'denied') got.denied = m.reason;
        else if (m.t === 'snapshot') got.snaps.push(m);
        else if (m.kind === 'over') got.over = m;
      } catch {}
    });
    ws.on('close', (code, reason) => { got.code = code; got.reason = String(reason); resolve({ ws, got }); });
    ws.on('error', () => {});
    ws.on('open', () => ws.send(JSON.stringify(hello)));
    setTimeout(() => resolve({ ws, got, timeout: true }), collect);
  });
}

describe('contratos ao vivo (servidor real, porta efêmera)', () => {
  let srv;
  before(async () => { srv = await startEphemeral(); });
  after(async () => { srv.child.kill(); await wait(300); });

  it('(a) hello inválido fecha pré-WELCOME (cenário do retry limitado)', async () => {
    const { ws, got } = await rawHello(srv.port, { t: 'hello', name: '', room: 'x' });
    ws.close();
    assert.equal(got.welcome, null, 'sem WELCOME');
    assert.equal(got.code, 1008, 'close 1008 pré-auth');
  });

  it('(b) lobby: queda e resume com token retomam (resumed)', async () => {
    const a = await rawHello(srv.port, { t: 'hello', name: 'lob', room: 'rz-lobby' });
    assert.ok(a.got.welcome, 'welcome inicial');
    const { id, resumeToken } = a.got.welcome;
    a.ws.terminate(); // queda sem LEAVE → fantasma 30s
    await wait(300);
    const b = await rawHello(srv.port, { t: 'hello', name: 'lob', room: 'rz-lobby', resume: id, resumeToken });
    b.ws.close();
    assert.ok(b.got.welcome?.resumed, 'resume no lobby retoma sessão');
  });

  it('(b) fim de jogo: queda pós-over e resume retomam', async () => {
    const a = await rawHello(srv.port, { t: 'hello', name: 'fim', room: 'rz-over', len: 5 });
    assert.ok(a.got.welcome, 'welcome inicial');
    a.ws.send(JSON.stringify({ t: 'start' }));
    let over = null;
    for (let i = 0; i < 100 && !over; i++) { await wait(100); over = a.got.over; }
    assert.ok(over, 'over chegou (len=5)');
    const { id, resumeToken } = a.got.welcome;
    a.ws.terminate();
    await wait(300);
    const b = await rawHello(srv.port, { t: 'hello', name: 'fim', room: 'rz-over', resume: id, resumeToken });
    b.ws.close();
    assert.ok(b.got.welcome?.resumed, 'resume pós-over retoma');
  });

  it('(c) DUP real: resume de id viva sem token nega com 1013', async () => {
    const a = await rawHello(srv.port, { t: 'hello', name: 'dono', room: 'rz-dup' });
    const b = await rawHello(srv.port, { t: 'hello', name: 'clone', room: 'rz-dup', resume: a.got.welcome.id });
    a.ws.close(); b.ws.close();
    assert.equal(b.got.denied, 'DUP', 'denied DUP entregue');
    assert.equal(b.got.code, 1013, 'close 1013');
  });

  it('(c) resume expirado vira welcome fresco sem resumed (cliente deve surfar)', async () => {
    const { ws, got } = await rawHello(srv.port, { t: 'hello', name: 'novo', room: 'rz-exp', resume: 'p4242', resumeToken: 'tok-invalido' });
    ws.close();
    assert.ok(got.welcome, 'welcome chega');
    assert.ok(!got.welcome.resumed, 'sem resumed = expirou/não existe');
  });
});
