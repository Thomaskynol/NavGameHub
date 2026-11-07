// Lane N — autoridade/rede/latência (TDD: RED primeiro, GREEN depois).
// Itens §§5,6.8,6.9 + pontos 3-4 do Lane D:
//  1. l-start com latest==null trava até o 1º snapshot (cheque estático do
//     handler em client/main.js — main.js não é importável em node/DOM-less).
//     ESTÁTICO-INTENCIONAL: main.js exige DOM/browser; o comportamento real é
//     provado em E2E (HUD após start em run.mjs --flow=lobby/full).
//  2. contrato __nw.aim lado main.js (pontos ○/raio do nariz p/ FP, como
//     Lane T fez p/ TP) — cheque estático até E2E browser provar ao vivo.
//     ESTÁTICO-INTENCIONAL pelo mesmo motivo; §8b do run.mjs agora prova
//     __nw.aim finito em TP+FP em browser (runtime).
//  3. autoridade sob latência/FPS variável: nariz servidor × predição
//     convergem, mira local não desalinha, tiro real corresponde (dano/
//     estado no SERVIDOR — retículo sozinho não prova impacto). RUNTIME abaixo.
//  4. quantificação do erro lateral sob lag (referência Lane D: 13.5u@50u/150ms).
//     RUNTIME (matemática pura, sem DOM).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from '../server/room.js';
import { stepNose, angDelta } from '../shared/turn.js';
import { TP_YAW_RATE, TP_PITCH_RATE } from '../shared/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainSrc = () => readFileSync(join(ROOT, 'client', 'main.js'), 'utf8');
const lstartBlock = () => {
  const src = mainSrc();
  const i = src.indexOf("$('l-start').onclick");
  assert.ok(i >= 0, 'handler l-start existe');
  return src.slice(i, src.indexOf('};', i) + 2);
};

describe('l-start trava sem snapshot (latest==null)', () => {
  it('host clicando <200ms após abrir o lobby não entra em playing local', () => {
    const block = lstartBlock();
    assert.ok(/if\s*\(\s*!latest\s*\)/.test(block), 'trava até o 1º snapshot (latest==null)');
    assert.ok(/toast/.test(block), 'avisa com toast em vez de pular silencioso');
    assert.ok(block.indexOf('!latest') < block.indexOf('enterMatch()'), 'trava ANTES de entrar');
  });
});

describe('contrato __nw.aim (lado main.js p/ Lane R)', () => {
  it('expõe modo + nariz + pontos ○/raio p/ verificação E2E', () => {
    const src = mainSrc();
    assert.ok(/get aim\(\)/.test(src), '__nw expõe get aim()');
    const i = src.indexOf('// __nw.aim (contrato Lane N→R)');
    assert.ok(i >= 0, 'contrato __nw.aim documentado no gancho');
    const contract = src.slice(i, i + 600);
    for (const f of ['mode', 'nose', 'ball', 'cursor', 'reticle'])
      assert.ok(contract.includes(f), `contrato __nw.aim tem ${f}`);
    // o objeto é populado de verdade (não só documentado): 3 ramos do HUD
    const assigns = src.match(/aimDbg = \{[^;]+/g) || [];
    assert.ok(assigns.length >= 3, `aimDbg populado nos ramos do HUD (${assigns.length})`);
    assert.ok(assigns.some((a) => a.includes('ball: { x: b.x')), 'TP vivo expõe ○ no mundo');
    // sem literal de margem: usa AIM_EDGE_MARGIN importado (mesmo do clampAim)
    assert.ok(/import[\s\S]*?AIM_EDGE_MARGIN[\s\S]*?from/.test(src), 'main.js importa AIM_EDGE_MARGIN');
    assert.ok(!/clampNum\(X, 20,/.test(src), 'sem literal 20 no clamp do ○');
  });
});

describe('autoridade TP: servidor ignora yaw instantâneo com dyaw presente', () => {
  it('nariz persegue o DESEJO (dyaw), nunca teleporta p/ yaw enviado', () => {
    const r = new Room('t', 300);
    r.join('shooter', 's', '#ffffff');
    r.join('victim', 'v', '#ffffff');
    r.start();
    const s = r.ships.get('shooter');
    Object.assign(s, { x: 0, y: 0, z: 0, yaw: 0.5, pitch: 0 });
    // input malicioso/desalinhado: yaw aponta p/ trás, desejo aponta p/ frente
    r.inputs.set('shooter', {
      t: 'input', seq: 1, w: 0, s: 0, a: 0, d: 0,
      yaw: Math.PI, pitch: 0, dyaw: 0, dpitch: 0, fire: 0,
    });
    r.tick(0.05, Date.now());
    const want = 0.5 - TP_YAW_RATE * 0.05; // um passo rumo ao desejo
    assert.ok(Math.abs(s.yaw - want) < 1e-9, `nariz deu um passo ao desejo (yaw=${s.yaw})`);
    assert.ok(Math.abs(s.yaw - Math.PI) > 1, 'yaw instantâneo enviado foi IGNORADO');
  });
});

describe('tiro real corresponde ao nariz (estado do servidor)', () => {
  it('rajada ao longo do nariz causa dano e mata (kill + placar)', () => {
    const r = new Room('t', 300);
    r.join('shooter', 's', '#ffffff');
    r.join('victim', 'v', '#ffffff');
    r.start();
    const a = r.ships.get('shooter'), b = r.ships.get('victim');
    Object.assign(a, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
    Object.assign(b, { x: 0, y: 0, z: -20, protectUntil: 0 });
    const t0 = Date.now();
    let t = t0, damagedAt = -1;
    for (let i = 0; i < 200 && b.alive; i++) {
      r.inputs.set('shooter', {
        t: 'input', seq: i + 1, w: 0, s: 0, a: 0, d: 0,
        yaw: 0, pitch: 0, fire: 1,
      });
      const evs = r.tick(0.05, t); t += 50;
      if (damagedAt < 0 && b.hp < 100) damagedAt = i;
      void evs;
    }
    assert.ok(damagedAt >= 0 && damagedAt < 20, `dano no servidor em poucos ticks (tick=${damagedAt})`);
    assert.ok(!b.alive, 'vítima morreu de tiro real (não só retículo)');
    assert.equal(a.kills, 1, 'placar autoritativo conta o abate');
  });
});

describe('convergência sob dt irregular (FPS variável)', () => {
  it('mouse parado ⇒ nariz converge e PARA no desejo (dt 8ms..100ms)', () => {
    let yaw = 0.3, pitch = 0.2, peak = Math.hypot(yaw, pitch);
    for (const dt of [0.016, 0.05, 0.1, 0.008, 0.033, 0.1, 0.016]) {
      const n = stepNose(yaw, pitch, 0, 0, dt, TP_YAW_RATE, TP_PITCH_RATE);
      const e = Math.hypot(angDelta(0, n.yaw), angDelta(0, n.dpitch ?? n.pitch));
      assert.ok(e <= peak + 1e-12, 'erro nunca cresce (sem oscilação)');
      peak = e;
      yaw = n.yaw; pitch = n.pitch;
    }
    assert.equal(yaw, 0, 'yaw ancora exato no desejo');
    assert.equal(pitch, 0, 'pitch ancora exato no desejo');
    const n = stepNose(yaw, pitch, 0, 0, 0.05, TP_YAW_RATE, TP_PITCH_RATE);
    assert.equal(n.yaw, 0, 'convergido fica parado (nada gira sozinho)');
  });

  it('orçamento de curva independe do fatiamento do dt', () => {
    const run = (dts) => {
      let y = 0.8, p = -0.5;
      for (const dt of dts) {
        const n = stepNose(y, p, 0, 0, dt, TP_YAW_RATE, TP_PITCH_RATE);
        y = n.yaw; p = n.pitch;
      }
      return [y, p];
    };
    const a = run([0.15]), b = run([0.05, 0.05, 0.05]), c = run([0.1, 0.03, 0.02]);
    for (const [x, y] of [[a, b], [a, c]])
      assert.ok(Math.abs(x[0] - y[0]) < 1e-9 && Math.abs(x[1] - y[1]) < 1e-9,
        'mesmo orçamento total ⇒ mesmo nariz (predição cliente ≡ servidor)');
  });
});

describe('harness E2E §8/§9 (2 sessões + blur/câmera)', () => {
  it('run.mjs prova observador coerente (tiros/nave/orientação do outro)', () => {
    const src = readFileSync(join(ROOT, 'tests', 'e2e', 'run.mjs'), 'utf8');
    assert.ok(src.includes('aLasersSeenByB'), '§8: B vê tiros de A no snapshot');
    assert.ok(src.includes('lock simulado EXPLÍCITO'), '§8 marca lock simulado como EXPLÍCITO');
    assert.ok(src.includes('Δpos='), '§8 quantifica Δpos/Δyaw entre observadores');
    // §8b (FIX): prova ○+✛ em browser nos dois modos (runtime E2E, não só snapshot)
    assert.ok(src.includes('__nw.aim finito'), '§8b: __nw.aim finito em TP+FP (○+✛ em browser)');
  });
  it('run.mjs prova blur + troca de câmera ida-e-volta em partida', () => {
    const src = readFileSync(join(ROOT, 'tests', 'e2e', 'run.mjs'), 'utf8');
    assert.ok(src.includes('recentered'), '§9: blur simulado recentra desejo');
    assert.ok(src.includes('voltou FP→TP'), '§9: câmera volta FP→TP em partida');
  });
});
describe('erro lateral sob lag (referência Lane D)', () => {
  it('150ms em curva máxima erra ~13.5u a 50u — e converge a zero depois', () => {
    const lag = 0.15, dist = 50;
    const err = TP_YAW_RATE * lag * dist; // ângulo pequeno: arco ≈ raio·ângulo
    assert.ok(err > 12 && err < 15, `erro lateral ≈13.5u (veio ${err.toFixed(2)}u)`);
    // após o lag, o nariz fecha o erro (passo autoritativo, sem teleporte)
    let yaw = TP_YAW_RATE * lag, pitch = 0;
    for (let i = 0; i < 60; i++) {
      const n = stepNose(yaw, pitch, 0, 0, 1 / 60, TP_YAW_RATE, TP_PITCH_RATE);
      yaw = n.yaw; pitch = n.pitch;
    }
    assert.equal(yaw, 0, 'erro de lag converge a zero (sem resíduo)');
  });
});
