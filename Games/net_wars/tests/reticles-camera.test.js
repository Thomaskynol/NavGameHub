// Lane R — retículos × câmera × projeção (TDD RED→GREEN).
// O que esta lane possui: client/camera.js (matemática pura), client/render.js
// (uso), shared/constants.js, docs. NÃO toca input/turn/main/room/protocol.
// - gunSolution: ◆ = raio do NARIZ (origem no nariz +3m, como o servidor
//   spawna o laser em room.js fireLaser/fireMissile) nos MESMOS colisores;
//   muito-perto (< AIM_MIN_DIST) vira indicador coerente (near) em vez de blob.
// - desiredSolution: ○ = mesmas regras de turn.js (vazio/oculto/muito-perto)
//   via ballWorld+rayHitObstacle+freeDist — sem divergir (mesmas funções).
// - clampAim: fora-da-tela/atrás (espelha X, ancora Y no meio, clamp na borda,
//   nunca some) — mesma semântica do HUD (main.js), agora partilhada/testada.
// - radarRel: E/D sem espelho (direita da tela = +x; frente = +z/abaixo,
//   convenção documentada); render.js não nega mais o x.
// - FP estável (rígido, sem giro espontâneo, sem auto-nivelar); TP paralela
//   (hold-under documentado, sem convergência com a distância).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STATION, ASTEROIDS, SHIP_RADIUS, TP_SHIP_DROP, AIM_EDGE_MARGIN,
} from '../shared/constants.js';
import { forward } from '../shared/orient.js';
import {
  fpFrame, tpFrame, createTpCam,
  gunSolution, desiredSolution, clampAim, radarRel, NOSE_FWD,
} from '../client/camera.js';
import { AIM_MAX_DIST, AIM_MIN_DIST } from '../shared/turn.js';

const COLLIDERS = [{ x: STATION.x, y: STATION.y, z: STATION.z, r: STATION.r },
  ...ASTEROIDS.map((a) => ({ x: a.x, y: a.y, z: a.z, r: a.r }))];
const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const angDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1,
  a.x * b.x + a.y * b.y + a.z * b.z))) * 180 / Math.PI;

describe('lane R: gunSolution (◆ = raio do nariz, colisores do servidor)', () => {
  it('vazio: ponto a AIM_MAX_DIST do NARIZ (+3m), blocked=false', () => {
    const g = gunSolution({ x: 0, y: 0, z: 0 }, Math.PI, 0, []);
    assert.equal(g.blocked, false);
    assert.equal(g.near, false);
    assert.equal(g.dist, AIM_MAX_DIST);
    // nariz = centro + fwd*3; ponto = nariz + fwd*150
    assert.ok(Math.abs(g.point.z - (3 + AIM_MAX_DIST)) < 1e-9, `z=${g.point.z}`);
    assert.ok(Math.abs(g.point.x) < 1e-9 && Math.abs(g.point.y) < 1e-9);
  });

  it('origem no nariz (+3m, igual ao spawn do laser no servidor)', () => {
    assert.equal(NOSE_FWD, 3);
    const g = gunSolution({ x: 10, y: -4, z: 7 }, 0, 0, []);
    // yaw=0 → fwd=(0,0,-1); nariz=(10,-4,4); ponto=(10,-4,4-150)
    assert.ok(Math.abs(g.point.x - 10) < 1e-9 && Math.abs(g.point.y + 4) < 1e-9);
    assert.ok(Math.abs(g.point.z - (4 - AIM_MAX_DIST)) < 1e-9, `z=${g.point.z}`);
  });

  it('oculto: impacto na superfície do obstáculo mais próximo', () => {
    const o = [{ x: 0, y: 0, z: -100, r: 10 }];
    const g = gunSolution({ x: 0, y: 0, z: 0 }, 0, 0, o);
    assert.equal(g.blocked, true);
    assert.equal(g.near, false);
    // nariz em z=-3; superfície em z=-90 → dist 87
    assert.ok(Math.abs(g.dist - 87) < 1e-6, `dist=${g.dist}`);
    assert.ok(Math.abs(g.point.z + 90) < 1e-6, `z=${g.point.z}`);
  });

  it('muito-perto (< 6m): indicador coerente em AIM_MIN_DIST, sem blob', () => {
    const o = [{ x: 0, y: 0, z: -14, r: 10 }]; // superfície a 1m do nariz (fora)
    const g = gunSolution({ x: 0, y: 0, z: 0 }, 0, 0, o);
    assert.equal(g.blocked, true);
    assert.equal(g.near, true);
    assert.equal(g.dist, AIM_MIN_DIST);
    for (const v of [g.point.x, g.point.y, g.point.z]) assert.ok(Number.isFinite(v));
    // ponto a 6m do NARIZ ao longo do raio (tamanho constante, sem blob)
    const nose = { x: 0, y: 0, z: -NOSE_FWD };
    const d = Math.hypot(g.point.x - nose.x, g.point.y - nose.y, g.point.z - nose.z);
    assert.ok(Math.abs(d - AIM_MIN_DIST) < 1e-9, `d=${d}`);
  });

  it('origem dentro da rocha: finito e coerente (fisicamente inalcançável)', () => {
    const o = [{ x: 0, y: 0, z: 0, r: 10 }];
    const g = gunSolution({ x: 0, y: 0, z: 0 }, 0.3, 0.1, o);
    assert.equal(g.blocked, true);
    assert.equal(g.near, true);
    assert.equal(g.dist, AIM_MIN_DIST);
    for (const v of [g.point.x, g.point.y, g.point.z]) assert.ok(Number.isFinite(v));
  });

  it('em curva segue o NARIZ (nunca o desejo): dir == forward(nose)', () => {
    const g = gunSolution({ x: 0, y: 0, z: 0 }, 0.5, -0.2, []);
    const f = norm(forward(0.5, -0.2));
    const d = norm({ x: g.point.x - 0, y: g.point.y - 0, z: g.point.z - 0 });
    assert.ok(angDeg(d, f) < 1e-6, '◆ ao longo do nariz mesmo com desejo longe');
  });
});

describe('lane R: desiredSolution (○, mesmas regras de turn.js)', () => {
  it('vazio: ponto a AIM_MAX_DIST, state=vazio', () => {
    const d = desiredSolution({ x: 0, y: 0, z: 0 }, 0, 0, []);
    assert.equal(d.state, 'vazio');
    assert.equal(d.dist, AIM_MAX_DIST);
    assert.ok(Math.abs(d.z + AIM_MAX_DIST) < 1e-9);
  });

  it('oculto: entrada do obstáculo, state=oculto', () => {
    const o = [{ x: 0, y: 0, z: -100, r: 10 }];
    const d = desiredSolution({ x: 0, y: 0, z: 0 }, 0, 0, o);
    assert.equal(d.state, 'oculto');
    assert.ok(Math.abs(d.dist - 90) < 0.1, `dist=${d.dist}`); // freeDist tira 0.05
    assert.ok(Math.abs(d.z + 90) < 0.1);
  });

  it('muito-perto: empurra p/ AIM_MIN_DIST, state=muito-perto', () => {
    const o = [{ x: 0, y: 0, z: -12, r: 10 }]; // livre ≈ 2m
    const d = desiredSolution({ x: 0, y: 0, z: 0 }, 0, 0, o);
    assert.equal(d.state, 'muito-perto');
    assert.equal(d.dist, AIM_MIN_DIST);
  });
});

describe('lane R: clampAim (fora-da-tela/atrás, nunca some)', () => {
  const W = 800, H = 600;
  it('na tela: passa direto, edge=false', () => {
    assert.deepEqual(clampAim(400, 300, false, W, H), { x: 400, y: 300, edge: false, behind: false });
  });
  it('fora à direita: prende na borda, edge=true', () => {
    const c = clampAim(900, 300, false, W, H);
    assert.equal(c.x, W - AIM_EDGE_MARGIN);
    assert.equal(c.y, 300);
    assert.equal(c.edge, true);
  });
  it('fora em cima: prende na borda', () => {
    const c = clampAim(400, -50, false, W, H);
    assert.equal(c.y, AIM_EDGE_MARGIN);
    assert.equal(c.edge, true);
  });
  it('atrás: espelha X, ancora Y no meio, nunca some', () => {
    const c = clampAim(100, 50, true, W, H);
    assert.equal(c.x, W - 100);
    assert.equal(c.y, H * 0.5);
    assert.equal(c.behind, true);
  });
  it('atrás mas centrado: visível na borda do meio, sem NaN', () => {
    const c = clampAim(400, 300, true, W, H);
    for (const v of [c.x, c.y]) assert.ok(Number.isFinite(v));
    assert.equal(c.edge, false);
  });
});

describe('lane R: radar E/D sem espelho (direita=direita)', () => {
  it('yaw=0 (rumo -Z): D(+X) → +x, E(−X) → −x, frente → +z (abaixo)', () => {
    assert.ok(radarRel(0, 50, 0).x > 0, 'contato à direita aparece à direita');
    assert.ok(radarRel(0, -50, 0).x < 0, 'contato à esquerda aparece à esquerda');
    const fwd = radarRel(0, 0, -50);
    assert.ok(Math.abs(fwd.x) < 1e-9 && fwd.z > 0, 'frente = +z (abaixo, convenção)');
    const back = radarRel(0, 0, 50);
    assert.ok(back.z < 0, 'atrás = −z (acima)');
  });
  it('yaw=π/2 (rumo −X): direita (−Z) → +x', () => {
    const r = radarRel(Math.PI / 2, 0, -50);
    assert.ok(r.x > 0, `x=${r.x}`);
    assert.ok(Math.abs(r.z) < 1e-9, `z=${r.z}`);
  });
  it('qualquer yaw: contato no corpo à direita → +x; à esquerda → −x', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, Math.PI, -2.1]) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const r = radarRel(yaw, 40 * c, -40 * s); // corpo à direita (body-right)
      assert.ok(Math.abs(r.x - 40) < 1e-9 && Math.abs(r.z) < 1e-9, `yaw=${yaw}: x=${r.x} z=${r.z}`);
      const l = radarRel(yaw, -40 * c, 40 * s); // corpo à esquerda
      assert.ok(Math.abs(l.x + 40) < 1e-9 && Math.abs(l.z) < 1e-9, `yaw=${yaw}: x=${l.x} z=${l.z}`);
    }
  });
});

describe('lane R: FP estável (rígida, sem giro espontâneo, sem auto-nivelar)', () => {
  const ship = { x: 10, y: -20, z: 30 };
  it('mesmo input → mesmo frame (nada gira sozinho)', () => {
    const a = fpFrame(ship, 0.5, -0.2, 0.3, COLLIDERS);
    const b = fpFrame(ship, 0.5, -0.2, 0.3, COLLIDERS);
    assert.deepEqual(a, b);
  });
  it('polos ±90°: finito, mira ∥ nariz (sem flip/NaN)', () => {
    for (const p of [1.55, -1.55]) {
      const f = fpFrame(ship, 0.4, p, 0.2, COLLIDERS);
      for (const v of [f.cam, f.up, f.look]) assert.ok(Number.isFinite(v.x + v.y + v.z));
      const dir = norm({ x: f.look.x - f.cam.x, y: f.look.y - f.cam.y, z: f.look.z - f.cam.z });
      assert.ok(angDeg(dir, norm(forward(0.4, p))) < 1e-6, `pitch=${p}`);
    }
  });
  it('bank inclina o up (cockpit ship-locked, sem auto-nivelar)', () => {
    const f = fpFrame(ship, 0, 0, 1.0, COLLIDERS);
    assert.ok(Math.abs(f.up.y) < 0.99, `up banca junto: y=${f.up.y}`);
    const dir = norm({ x: f.look.x - f.cam.x, y: f.look.y - f.cam.y, z: f.look.z - f.cam.z });
    assert.ok(angDeg(dir, norm(forward(0, 0))) < 1e-6, 'mira continua ∥ nariz');
  });
});

describe('lane R: TP paralela (hold-under, sem convergência)', () => {
  it('direção do olhar independe de obstáculo/distância (paralela documentada)', () => {
    const ship = { x: 0, y: 0, z: 0 };
    const far = [{ x: 0, y: 0, z: -500, r: 10 }];
    const near = [{ x: 0, y: 0, z: -30, r: 5 }];
    const dirOf = (coll) => {
      const st = createTpCam();
      let f;
      for (let i = 0; i < 200; i++) f = tpFrame(ship, 0.3, -0.1, 0.2, 1 / 60, st, coll, 350);
      return norm({ x: f.look.x - f.cam.x, y: f.look.y - f.cam.y, z: f.look.z - f.cam.z });
    };
    const a = dirOf(far), b = dirOf(near);
    assert.ok(angDeg(a, b) < 1e-6, 'câmera não converge com a distância (hold-under)');
    assert.ok(angDeg(a, norm(forward(0.3, -0.1))) < 0.5, 'olhar ∥ nariz');
  });
});

describe('lane R: TP_SHIP_DROP coerente (só-visual, não mascara hitbox)', () => {
  it('DROP ≤ SHIP_RADIUS (mesh deslocada ainda cruza a hitbox real)', () => {
    assert.ok(TP_SHIP_DROP > 0 && TP_SHIP_DROP <= SHIP_RADIUS,
      `DROP=${TP_SHIP_DROP} ≤ hitbox r=${SHIP_RADIUS}`);
  });
  it('AIM_EDGE_MARGIN partilhado (>0, igual ao clamp do HUD)', () => {
    assert.equal(AIM_EDGE_MARGIN, 20);
  });
});

describe('lane R: fiação render.js (sem tocar main/input)', () => {
  const src = readFileSync(new URL('../client/render.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  it('◆ usa gunSolution com o NARIZ local (nunca dyaw/dpitch)', () => {
    assert.ok(code.includes('gunSolution('), 'render.js chama gunSolution');
    const calls = code.split('\n').filter((l) => l.includes('gunSolution(') && !l.trim().startsWith('import') && !l.includes('function gunSolution'));
    assert.ok(calls.length >= 1, 'achou chamada de gunSolution');
    for (const c of calls) {
      assert.ok(c.includes('local.yaw') && c.includes('local.pitch'), `chamada leva o nariz local: ${c.trim()}`);
      assert.ok(!c.includes('dyaw') && !c.includes('dpitch'), `sem desejo na chamada ◆: ${c.trim()}`);
    }
    // runtime: ◆ ao longo do nariz — dir == forward(nariz)
    const g = gunSolution({ x: 0, y: 0, z: 0 }, 0.5, -0.2, []);
    const f = norm(forward(0.5, -0.2));
    const d = norm({ x: g.point.x - 0, y: g.point.y - 0, z: g.point.z - 0 });
    assert.ok(angDeg(d, f) < 1e-6, '◆ runtime ao longo do nariz');
  });
  it('radar sem espelho (sem -rx)', () => {
    assert.ok(!/-rx/.test(code), 'x=-rx removido');
    assert.ok(code.includes('radarRel('), 'render.js usa radarRel');
  });
  it('desejo ○ usa desiredSolution (regras turn.js, sem reimplementar)', () => {
    assert.ok(code.includes('desiredSolution('), 'render.js usa desiredSolution p/ o stash ○');
  });
});
