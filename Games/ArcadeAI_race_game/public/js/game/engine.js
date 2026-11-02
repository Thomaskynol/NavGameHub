/**
 * public/js/game/engine.js — motor 3D de "Asfalto Vivo" (lane gfx).
 * Fachada exata (ARCHITECTURE.md §6 + extensões usadas por main.js):
 *
 *   createEngine({ mount, getSettings }) => {
 *     async load(trackId, { grid, roster, you, laps }),
 *     start({ startAtServerTime|null, now, mode:'mp'|'tt' }),
 *     pause(bool), applySnapshot(snap), applyCorrection({x,z,hd,v}),
 *     getLocalState() => st|null, getHudPayload(), recover(),
 *     on(event, cb), getCarPositions(), dispose()
 *   }
 *
 * Física: passo fixo 1/120 s (máx 5 passos/frame) delegado a carPhysics.js;
 * ctx = { sampler, steerSensitivity } lido de getSettings() por frame. Remotos
 * com buffer de interpolação de ~120 ms (REMOTE_INTERP_DELAY_MS) no relógio do
 * servidor (nowFn = net.serverNow em mp; performance.now em tt). Em tt,
 * recuperação invalida a próxima volta ('lap' valid:false + 'invalid_lap');
 * em mp a autoridade é o servidor (main ignora eventos 'lap' locais).
 *
 * Eventos: 'notice' {text,kind} · 'lap' {timeMs,valid} · 'finish' · 'wrongway'
 * bool · 'countdownEnd' · 'nitro' bool · 'wall' · 'recover' · 'invalid_lap'.
 * ('collision' fica reservado carro-carro — autoridade do servidor via msg
 * 'collide'; main.js só o escuta defensivamente.)
 */
import * as THREE from '/vendor/three.module.js';
import { TRACKS } from '/shared/tracks.js';
import { createSampler } from '/shared/trackMath.js';
import { PHYSICS, NITRO, REMOTE_INTERP_DELAY_MS } from '/shared/constants.js';
import { createCar, stepCar, recover as recoverCar } from './carPhysics.js';
import { buildCarMesh, buildNameTag } from './carMesh.js';
import { getInput } from './input.js';

// ------------------------------------------------------------------ constantes

const STEP = 1 / 120;         // passo fixo da simulação (s)
const MAX_STEPS = 5;          // teto de passos por frame (anti death-spiral)
const CAM_DIST = 7.5;         // câmera de perseguição (m)
const CAM_H = 3.4;
const CAM_LERP = 8;           // 1/s de suavização
const SKID_MAX = 256;         // ring-buffer de marcas de derrapagem
const SMOKE_MAX = 40;         // pool de fumaça
const BUF_MAX = 40;           // amostras por remoto (~2.7 s a 15 Hz)
const REMOTE_EXTRAP_CAP_MS = 200; // teto de dead-reckoning além da última amostra
const TAU = Math.PI * 2;

const ZERO_INPUT = Object.freeze({
  throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, recoverPress: false,
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
function wrapAngle(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

// ------------------------------------------------------------------ fábrica

export function createEngine({ mount, getSettings }) {
  // ---------------------------------------------------------------- estado
  let renderer = null;
  let scene = null;
  let camera = null;
  let sun = null;
  let ambient = null;
  let baseAmbientI = 1;

  let trackId = null;
  let sampler = null;
  let lapsOpt = null;
  let you = null;
  let roster = new Map();          // id → {dname, color}
  let quality = 'medium';
  let fxI = 1;

  let localCar = null;             // estado físico (carPhysics)
  let localMesh = null;            // {group, setSteer, setWheelSpin, setTilt}
  let flame = null;
  let flameLight = null;
  const remotes = new Map();       // id → {mesh, buf, cur:{x,z,hd,v,steer}}

  let mode = 'mp';
  let nowFn = () => performance.now();
  let startAtSrv = null;
  let started = false;             // start() chamado
  let running = false;             // gate abriu (física liberada)
  let paused = false;
  let pauseAt = 0;
  let acc = 0;
  let lastTs = 0;
  let raf = 0;

  let lapStart = 0;
  const lapTimes = [];
  let ttInvalid = false;

  let shake = 0;                   // amplitude de câmera (parede)
  let flash = 0;                   // flash do ambiente (parede)
  const camPos = new THREE.Vector3();
  let lastInput = ZERO_INPUT;
  let prevV = 0;
  let tiltRoll = 0;
  let tiltPitch = 0;

  let skidPool = null;
  let skidIdx = 0;
  let skidNext = 0;
  let smokePool = null;
  let smokeIdx = 0;
  let smokeNext = 0;
  let speedLines = null;

  const handlers = new Map();

  // ---------------------------------------------------------------- events

  function emit(ev, payload) {
    const set = handlers.get(ev);
    if (!set) return;
    for (const cb of [...set]) {
      try { cb(payload); } catch (err) { console.error(`engine[${ev}]`, err); }
    }
  }

  function on(ev, cb) {
    if (typeof cb !== 'function') return () => {};
    let set = handlers.get(ev);
    if (!set) handlers.set(ev, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
  }

  // ---------------------------------------------------------------- load

  async function load(id, { grid = null, roster: r = null, you: me = null, laps = null } = {}) {
    if (renderer) throw new Error('engine: load já chamado (use um engine novo por corrida)');
    const track = TRACKS[id];
    if (!track) throw new Error(`engine: pista desconhecida: ${id}`);
    trackId = id;
    sampler = createSampler(track);
    lapsOpt = laps;
    you = me;
    roster = new Map((Array.isArray(r) ? r : []).map((p) => [p.id, p]));
    const s = getSettings() || {};
    quality = s.quality || 'medium';
    fxI = typeof s.fxIntensity === 'number' ? clamp(s.fxIntensity, 0, 1) : 1;

    buildScene(track);

    // carro local: slot do grid do servidor (por id) ou slot 0 (TT)
    const slots = Array.isArray(grid) && grid.length ? grid : null;
    const slot = (slots && (slots.find((g) => g && g.id === you) || slots[0])) || gridSlotFallback();
    localCar = createCar(slot.x, slot.z, slot.heading, 0);
    const color = (roster.get(you) && roster.get(you).color) || s.color || '#e5484d';
    localMesh = buildCarMesh(color);
    localMesh.group.position.set(slot.x, 0, slot.z);
    localMesh.group.rotation.y = slot.heading;
    scene.add(localMesh.group);
    buildFlame(localMesh.group);

    // remotos (mp): posição inicial do grid, atualizada por snapshots
    for (const [rid, p] of roster) {
      if (rid === you) continue;
      const g = (slots && (slots.find((x) => x && x.id === rid) || slot)) || slot;
      addRemote(rid, p, g);
    }

    camPos.set(
      slot.x - Math.sin(slot.heading) * CAM_DIST,
      CAM_H,
      slot.z - Math.cos(slot.heading) * CAM_DIST,
    );
    camera.position.copy(camPos);
    camera.lookAt(slot.x, 1.2, slot.z);
    onResize();
    raf = requestAnimationFrame(frame);
  }

  function gridSlotFallback() {
    const g = sampler.grid(1)[0];
    return { x: g.x, z: g.z, heading: g.heading };
  }

  function addRemote(id, p, slot) {
    const color = p.color || '#888888';
    const mesh = buildCarMesh(color);
    mesh.group.position.set(slot.x, 0, slot.z);
    mesh.group.rotation.y = slot.heading;
    const tag = buildNameTag(String(p.dname || '???').slice(0, 12), color);
    tag.position.y = 2.4; // acima do carro (§2)
    mesh.group.add(tag);
    scene.add(mesh.group);
    remotes.set(id, {
      mesh,
      buf: [],
      cur: { x: slot.x, z: slot.z, hd: slot.heading, v: 0, steer: 0 },
    });
  }

  // ---------------------------------------------------------------- cena

  function buildScene(track) {
    const env = track.env || {};
    scene = new THREE.Scene();
    scene.background = new THREE.Color(env.sky || '#88c8e8');
    if (env.fog) {
      scene.fog = new THREE.Fog(
        new THREE.Color(env.fog),
        env.fogNear != null ? env.fogNear : 120,
        env.fogFar != null ? env.fogFar : 900,
      );
    }

    camera = new THREE.PerspectiveCamera(60, 1, 0.5, 3000);
    scene.add(camera); // speed-lines são filhas da câmera

    ambient = new THREE.AmbientLight(new THREE.Color(env.ambient || '#8090a0'), 0.9);
    baseAmbientI = ambient.intensity;
    scene.add(ambient);

    sun = new THREE.DirectionalLight(new THREE.Color(env.sun || '#ffffff'), 1.35);
    sun.position.set(80, 140, 50);
    scene.add(sun);
    scene.add(sun.target);
    if (quality === 'high') {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const d = 120;
      sun.shadow.camera.left = -d;
      sun.shadow.camera.right = d;
      sun.shadow.camera.top = d;
      sun.shadow.camera.bottom = -d;
      sun.shadow.camera.near = 20;
      sun.shadow.camera.far = 420;
      sun.shadow.bias = -0.0004;
    }

    // solo: placa próxima (grama/concreto) + placa distante (areia/asfalto)
    const groundFar = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshStandardMaterial({ color: env.groundFar || env.ground || '#6a7a5a', roughness: 1 }),
    );
    groundFar.rotation.x = -Math.PI / 2;
    groundFar.position.y = -0.08;
    const groundNear = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 1800),
      new THREE.MeshStandardMaterial({ color: env.ground || '#6a7a5a', roughness: 1 }),
    );
    groundNear.rotation.x = -Math.PI / 2;
    if (quality === 'high') groundNear.receiveShadow = true;
    scene.add(groundFar, groundNear);

    const samples = roadSamples();
    buildRoad(samples);
    buildStartLine();
    buildBarriers(samples);
    buildDecor(track);

    buildSkidPool();
    buildSmokePool();
    if (quality === 'high') buildSpeedLines();

    // renderer por último (já com a cena pronta)
    renderer = new THREE.WebGLRenderer({
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
    });
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(quality === 'low' ? 0.75 : quality === 'high' ? Math.min(dpr, 2) : Math.min(dpr, 1.5));
    if (quality === 'high') {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    renderer.setSize(mount.clientWidth || window.innerWidth, mount.clientHeight || window.innerHeight);
    mount.appendChild(renderer.domElement);
    window.addEventListener('resize', onResize);
  }

  function onResize() {
    if (!renderer || !camera) return;
    const w = mount.clientWidth || window.innerWidth;
    const h = mount.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  /** Amostras ~3 m: ponto + largura (project 1×/amostra; one-shot no load). */
  function roadSamples() {
    const n = Math.max(180, Math.min(800, Math.round(sampler.length / 3)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = (i * sampler.length) / n;
      const p = sampler.pointAt(s);
      const pr = sampler.project(p.x, p.z);
      out.push({ x: p.x, z: p.z, h: p.heading, w: pr.width });
    }
    return out;
  }

  /** Faixa contínua (estrada/linha): halfAt(devolve {cLat, half} ou null). */
  function ribbonGeometry(samples, halfAt, y) {
    const pos = [];
    const n = samples.length;
    for (let i = 0; i < n; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % n];
      const ra = halfAt(a);
      const rb = halfAt(b);
      if (!ra || !rb) continue;
      const nax = Math.cos(a.h);
      const naz = -Math.sin(a.h); // normal esquerda
      const nbx = Math.cos(b.h);
      const nbz = -Math.sin(b.h);
      const aLx = a.x + nax * (ra.cLat + ra.half);
      const aLz = a.z + naz * (ra.cLat + ra.half);
      const aRx = a.x + nax * (ra.cLat - ra.half);
      const aRz = a.z + naz * (ra.cLat - ra.half);
      const bLx = b.x + nbx * (rb.cLat + rb.half);
      const bLz = b.z + nbz * (rb.cLat + rb.half);
      const bRx = b.x + nbx * (rb.cLat - rb.half);
      const bRz = b.z + nbz * (rb.cLat - rb.half);
      pos.push(aLx, y, aLz, aRx, y, aRz, bLx, y, bLz);
      pos.push(aRx, y, aRz, bRx, y, bRz, bLx, y, bLz);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  function buildRoad(samples) {
    const asphalt = new THREE.Mesh(
      ribbonGeometry(samples, (s) => ({ cLat: 0, half: s.w * 0.5 }), 0.02),
      new THREE.MeshStandardMaterial({ color: '#3E434C', roughness: 0.95, flatShading: true }),
    );
    scene.add(asphalt);
    // linhas de borda brancas
    const edgeMat = new THREE.MeshBasicMaterial({ color: '#E8E8EC' });
    for (const side of [1, -1]) {
      scene.add(new THREE.Mesh(
        ribbonGeometry(samples, (s) => ({ cLat: side * (s.w * 0.5 - 0.55), half: 0.12 }), 0.03),
        edgeMat,
      ));
    }
  }

  function buildStartLine() {
    const p = sampler.pointAt(0);
    const pr = sampler.project(p.x, p.z);
    const w = pr.width;
    const cols = Math.max(4, Math.round(w / 1.6));
    const cellW = w / cols;
    const cellL = 0.8;
    const geo = new THREE.PlaneGeometry(cellW * 0.96, cellL);
    geo.rotateX(-Math.PI / 2);
    const white = new THREE.MeshBasicMaterial({ color: '#F2F2F4' });
    const black = new THREE.MeshBasicMaterial({ color: '#1A1C22' });
    const nx = Math.cos(p.heading);
    const nz = -Math.sin(p.heading);
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    for (let row = 0; row < 2; row++) {
      for (let c = 0; c < cols; c++) {
        const off = (c - cols / 2 + 0.5) * cellW;
        const foff = (row - 0.5) * cellL;
        const m = new THREE.Mesh(geo, (row + c) % 2 === 0 ? white : black);
        m.position.set(p.x + nx * off + fx * foff, 0.035, p.z + nz * off + fz * foff);
        m.rotation.y = p.heading;
        scene.add(m);
      }
    }
  }

  function buildBarriers(samples) {
    const step = Math.max(8, Math.round(sampler.length / 70));
    const n = Math.floor(sampler.length / step);
    const count = n * 2;
    const geo = new THREE.BoxGeometry(0.22, 0.85, 0.22);
    const mat = new THREE.MeshStandardMaterial({ color: '#D8DCE2', roughness: 0.7, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const dummy = new THREE.Object3D();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const smp = sampler.pointAt(i * step);
      const pr = sampler.project(smp.x, smp.z);
      const lat = pr.width * 0.5 + PHYSICS.wallMargin + 1.2;
      const nx = Math.cos(smp.heading);
      const nz = -Math.sin(smp.heading);
      for (const side of [1, -1]) {
        dummy.position.set(smp.x + nx * lat * side, 0.42, smp.z + nz * lat * side);
        dummy.rotation.set(0, smp.heading, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(k++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (quality === 'high') mesh.castShadow = true;
    scene.add(mesh);
  }

  // --- decor: primitivas low-poly em InstancedMesh por (kind, parte)

  const GEOS = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
    cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    cone6: new THREE.ConeGeometry(0.5, 1, 6),
    cone8: new THREE.ConeGeometry(0.5, 1, 8),
    sphere: new THREE.SphereGeometry(0.5, 8, 6),
  };

  // parte: { g: geo, c: '#hex'|null(tint), p: [x,y,z], s: [sx,sy,sz], rot?: [rx,ry,rz], tint?: bool }
  const DECOR = {
    dune: { parts: [{ g: 'sphere', c: '#CBB37A', p: [0, -0.35, 0], s: [9, 2.6, 7] }] },
    palm: { parts: [
      { g: 'cyl6', c: '#8A6A44', p: [0, 2, 0], s: [0.34, 4, 0.34] },
      { g: 'cone8', c: '#3E8E4C', p: [0, 4.4, 0], s: [3.0, 1.5, 3.0] },
      { g: 'cone8', c: '#4FA05C', p: [0, 5.1, 0], s: [1.7, 1.2, 1.7] },
    ] },
    tree: { parts: [
      { g: 'cyl6', c: '#7A5B3A', p: [0, 1.1, 0], s: [0.4, 2.2, 0.4] },
      { g: 'sphere', c: '#3B7F47', p: [0, 3.0, 0], s: [2.6, 2.2, 2.6] },
      { g: 'sphere', c: '#469154', p: [0.7, 2.2, 0.3], s: [1.6, 1.4, 1.6] },
    ] },
    rock: { parts: [{ g: 'sphere', c: '#8A8F98', p: [0, 0.3, 0], s: [2.6, 1.7, 2.2], rot: [0.4, 0.3, 0.15] }] },
    parasol: { parts: [
      { g: 'cyl6', c: '#E8E4DA', p: [0, 1.2, 0], s: [0.12, 2.4, 0.12] },
      { g: 'cone8', c: null, p: [0, 2.6, 0], s: [2.6, 0.9, 2.6], tint: true },
    ] },
    hut: { parts: [
      { g: 'box', c: '#D9C69A', p: [0, 1.1, 0], s: [4, 2.2, 3.4] },
      { g: 'cone6', c: '#7A5B3A', p: [0, 2.9, 0], s: [5.2, 1.6, 4.6] },
    ] },
    boat: { parts: [
      { g: 'box', c: '#3A5A78', p: [0, 0.35, 0], s: [2.2, 0.7, 6] },
      { g: 'box', c: '#E8E4DA', p: [0, 1.0, -0.6], s: [1.6, 0.8, 2] },
    ] },
    lighthouse: { parts: [
      { g: 'cyl8', c: '#E8E4DA', p: [0, 4, 0], s: [1.6, 8, 1.6] },
      { g: 'cyl8', c: '#D84C4C', p: [0, 6.2, 0], s: [1.68, 1.4, 1.68] },
      { g: 'box', c: '#3A3F4B', p: [0, 8.4, 0], s: [1.9, 0.8, 1.9] },
      { g: 'cone8', c: '#D84C4C', p: [0, 9.2, 0], s: [1.6, 1, 1.6] },
    ] },
    buoy: { parts: [
      { g: 'cyl8', c: '#E07830', p: [0, 0.5, 0], s: [1.0, 1.0, 1.0] },
      { g: 'cone8', c: '#D84C4C', p: [0, 1.5, 0], s: [0.9, 1.2, 0.9] },
    ] },
    stand: { parts: [
      { g: 'box', c: '#9AA0A8', p: [0, 0.6, 0], s: [8, 1.2, 4] },
      { g: 'box', c: '#C85A4A', p: [0, 3.2, 0], s: [8.6, 0.35, 4.6] },
      { g: 'cyl6', c: '#7A8088', p: [-3.8, 2, 1.8], s: [0.22, 2.6, 0.22] },
      { g: 'cyl6', c: '#7A8088', p: [3.8, 2, 1.8], s: [0.22, 2.6, 0.22] },
    ] },
    billboard: { parts: [
      { g: 'cyl6', c: '#5A6068', p: [-1.6, 2, 0], s: [0.22, 4, 0.22] },
      { g: 'cyl6', c: '#5A6068', p: [1.6, 2, 0], s: [0.22, 4, 0.22] },
      { g: 'box', c: null, p: [0, 4.4, 0], s: [5.6, 2.6, 0.25], tint: true },
    ] },
    tirestack: { parts: [
      { g: 'cyl8', c: '#22242A', p: [0, 0.18, 0], s: [1.3, 0.36, 1.3] },
      { g: 'cyl8', c: '#2A2C33', p: [0, 0.54, 0], s: [1.25, 0.36, 1.25] },
      { g: 'cyl8', c: '#22242A', p: [0, 0.9, 0], s: [1.2, 0.36, 1.2] },
    ] },
    container: { parts: [{ g: 'box', c: '#B0B6BE', p: [0, 1.3, 0], s: [6.2, 2.6, 2.5], tint: true }] },
    warehouse: { parts: [
      { g: 'box', c: '#8E949C', p: [0, 3.5, 0], s: [18, 7, 13] },
      { g: 'box', c: '#5A6068', p: [0, 7.4, 0], s: [19, 0.8, 14] },
    ] },
    crane: { parts: [
      { g: 'box', c: '#D8A034', p: [0, 5, 0], s: [1.2, 10, 1.2] },
      { g: 'box', c: '#D8A034', p: [3.4, 9.6, 0], s: [9, 0.9, 1.0] },
      { g: 'box', c: '#3A3F4B', p: [7.4, 7.6, 0], s: [0.18, 3.4, 0.18] },
    ] },
    silo: { parts: [
      { g: 'cyl8', c: '#A8AEB6', p: [0, 4.5, 0], s: [4.4, 9, 4.4] },
      { g: 'cone8', c: '#8E949C', p: [0, 9.8, 0], s: [4.6, 1.6, 4.6] },
    ] },
    smokestack: { parts: [
      { g: 'cyl8', c: '#B8BEC6', p: [0, 7, 0], s: [2.6, 14, 2.6] },
      { g: 'cyl8', c: '#D84C4C', p: [0, 13.2, 0], s: [2.7, 1.6, 2.7] },
      { g: 'cyl8', c: '#5A6068', p: [0, 14.2, 0], s: [2.4, 0.6, 2.4] },
    ] },
    fence: { parts: [
      { g: 'box', c: '#7A8088', p: [0, 0.9, 0], s: [12, 0.14, 0.14] },
      { g: 'box', c: '#7A8088', p: [0, 1.5, 0], s: [12, 0.14, 0.14] },
      { g: 'cyl6', c: '#5A6068', p: [-5.8, 0.95, 0], s: [0.2, 1.9, 0.2] },
      { g: 'cyl6', c: '#5A6068', p: [5.8, 0.95, 0], s: [0.2, 1.9, 0.2] },
    ] },
    pipe: { parts: [
      { g: 'cyl8', c: '#A86848', p: [0, 0.8, 0], s: [1.2, 7, 1.2], rot: [0, 0, Math.PI / 2] },
      { g: 'cyl8', c: '#8E5A40', p: [-3.2, 0.55, 0], s: [1.5, 1.1, 1.5] },
    ] },
    crate: { parts: [{ g: 'box', c: '#A8875A', p: [0, 0.75, 0], s: [1.5, 1.5, 1.5] }] },
    lightpole: { parts: [
      { g: 'cyl6', c: '#5A6068', p: [0, 3.5, 0], s: [0.24, 7, 0.24] },
      { g: 'box', c: '#E8D88A', p: [0.5, 7.1, 0], s: [1.2, 0.28, 0.5] },
    ] },
    barrier: { parts: [{ g: 'box', c: '#D8803C', p: [0, 0.5, 0], s: [3.2, 0.9, 0.4] }] },
  };

  function buildDecor(track) {
    const items = Array.isArray(track.decor) ? track.decor : [];
    const byKind = new Map();
    for (const it of items) {
      const def = DECOR[it && it.kind];
      if (!def) continue;
      let list = byKind.get(it.kind);
      if (!list) byKind.set(it.kind, (list = []));
      list.push(it);
    }
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (const [kind, list] of byKind) {
      const def = DECOR[kind];
      def.parts.forEach((part, pi) => {
        const mat = new THREE.MeshStandardMaterial({
          color: part.c || '#ffffff', roughness: 0.9, flatShading: true,
        });
        const mesh = new THREE.InstancedMesh(GEOS[part.g], mat, list.length);
        list.forEach((it, i) => {
          const sc = typeof it.scale === 'number' ? it.scale : 1;
          const yaw = it.rot || 0;
          // offset da parte rotacionado pelo yaw do item
          const ox = part.p[0] * Math.cos(yaw) + part.p[2] * Math.sin(yaw);
          const oz = -part.p[0] * Math.sin(yaw) + part.p[2] * Math.cos(yaw);
          dummy.position.set(it.x + ox * sc, part.p[1] * sc, it.z + oz * sc);
          dummy.rotation.set(part.rot ? part.rot[0] : 0, yaw + (part.rot ? part.rot[1] : 0), part.rot ? part.rot[2] : 0);
          dummy.scale.set(part.s[0] * sc, part.s[1] * sc, part.s[2] * sc);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          if (part.tint && it.tint) mesh.setColorAt(i, color.set(it.tint));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        if (quality === 'high' && pi < 2) mesh.castShadow = true; // só 1-2 partes projetam
        scene.add(mesh);
      });
    }
  }

  // ---------------------------------------------------------------- efeitos

  function buildFlame(parent) {
    const geo = new THREE.ConeGeometry(0.22, 0.9, 8);
    geo.rotateX(-Math.PI / 2); // ápice → −Z (para trás)
    flame = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#FF8A2A' }));
    flame.position.set(0, 0.55, -2.45);
    flame.visible = false;
    parent.add(flame);
    flameLight = new THREE.PointLight('#FF9A3C', 0, 16);
    flameLight.position.set(0, 0.7, -2.6);
    parent.add(flameLight);
  }

  function buildSkidPool() {
    const geo = new THREE.PlaneGeometry(0.34, 1.5);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: '#14151A', transparent: true, opacity: 0.33, depthWrite: false,
    });
    skidPool = [];
    for (let i = 0; i < SKID_MAX; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.rotation.order = 'YXZ';
      scene.add(m);
      skidPool.push(m);
    }
  }

  function smokeTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(228,228,232,0.85)');
    grad.addColorStop(1, 'rgba(228,228,232,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  function buildSmokePool() {
    const tex = smokeTexture();
    smokePool = [];
    for (let i = 0; i < SMOKE_MAX; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, opacity: 0,
      }));
      sp.visible = false;
      sp.userData = { life: 0, max: 0.9 };
      scene.add(sp);
      smokePool.push(sp);
    }
  }

  function buildSpeedLines() {
    speedLines = new THREE.Group();
    const geo = new THREE.BoxGeometry(0.03, 0.03, 2.6);
    const mat = new THREE.MeshBasicMaterial({
      color: '#FFFFFF', transparent: true, opacity: 0, depthWrite: false,
    });
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * 6, Math.sin(a) * 3.6, -9);
      speedLines.add(m);
    }
    speedLines.visible = false;
    camera.add(speedLines);
  }

  // local (lx, lz) → mundo (heading = atan2(dx,dz); +Z local = frente)
  function wheelWorld(car, lx, lz) {
    const s = Math.sin(car.hd);
    const c = Math.cos(car.hd);
    return { x: car.x + c * lx + s * lz, z: car.z - s * lx + c * lz };
  }

  function spawnSkid(car) {
    for (const lx of [0.95, -0.95]) {
      const w = wheelWorld(car, lx, -1.35);
      const m = skidPool[skidIdx++ % SKID_MAX];
      m.position.set(w.x, 0.02, w.z);
      m.rotation.set(0, car.hd, 0);
      m.visible = true;
    }
  }

  function spawnSmoke(car) {
    const sp = smokePool[smokeIdx++ % SMOKE_MAX];
    const w = wheelWorld(car, (Math.random() - 0.5) * 1.4, -1.6);
    sp.position.set(w.x, 0.45, w.z);
    sp.userData.life = 0;
    sp.visible = true;
    sp.material.opacity = 0.5 * fxI;
    sp.scale.set(1, 1, 1);
  }

  // ---------------------------------------------------------------- loop

  function readInput() {
    const i = getInput();
    return {
      throttle: i.throttle || 0,
      brake: i.brake || 0,
      steer: i.steer || 0,
      handbrake: !!i.handbrake,
      nitro: !!i.nitro,
      recoverPress: !!i.recoverPress,
    };
  }

  function physicsCtx() {
    const s = getSettings() || {};
    return {
      sampler,
      steerSensitivity: typeof s.steerSensitivity === 'number' ? s.steerSensitivity : 1,
    };
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!renderer) return;
    const nowMs = typeof ts === 'number' ? ts : performance.now();
    let dt = lastTs ? (nowMs - lastTs) / 1000 : 0;
    lastTs = nowMs;
    if (dt > 0.25) dt = 0.25;

    if (started && !running && startAtSrv != null && nowFn() >= startAtSrv) openGate();

    if (running && !(mode === 'tt' && paused)) {
      const inp = paused ? ZERO_INPUT : readInput();
      lastInput = inp;
      if (inp.recoverPress) doRecover();
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < MAX_STEPS) {
        const res = stepCar(localCar, inp, STEP, physicsCtx());
        handleEvents(res.events);
        acc -= STEP;
        steps++;
      }
      if (acc > STEP) acc = 0; // perdeu o fio: descarta atraso (anti spiral)
    }

    updateVisuals(dt);
    renderer.render(scene, camera);
  }

  function handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'wall') {
        emit('wall');
        shake = Math.min(1.1, shake + 0.55 * fxI);
        flash = 1;
      } else if (ev.type === 'nitro') {
        emit('nitro', !!ev.on);
      } else if (ev.type === 'wrongway') {
        emit('wrongway', !!ev.on);
      } else if (ev.type === 'lap') {
        onLocalLap();
      }
    }
  }

  function onLocalLap() {
    if (mode === 'tt') {
      const t = nowFn();
      const timeMs = Math.max(0, t - lapStart);
      const valid = !ttInvalid;
      lapTimes.push(timeMs);
      lapStart = t;
      ttInvalid = false;
      emit('lap', { timeMs, valid });
      if (!valid) emit('invalid_lap');
    }
    // mp: servidor é a autoridade (msg 'lap'); evento local é só cosmético
    if (lapsOpt != null && localCar.lap >= lapsOpt) emit('finish');
  }

  function doRecover() {
    if (!localCar || !running) return;
    if (localCar.recTimer > 0) {
      emit('notice', { text: 'Recuperação indisponível ainda…', kind: 'info' });
      return;
    }
    const res = recoverCar(localCar, physicsCtx());
    for (const ev of res.events) {
      if (ev.type === 'recover') {
        emit('recover');
        if (mode === 'tt') ttInvalid = true; // próxima volta sai inválida
      } else if (ev.type === 'wrongway') {
        emit('wrongway', !!ev.on);
      }
    }
  }

  function updateVisuals(dt) {
    const car = localCar;

    // --- carro local
    if (car && localMesh) {
      const g = localMesh.group;
      g.position.set(car.x, 0, car.z);
      g.rotation.y = car.hd;
      localMesh.setSteer(car.steer01 * 0.5);
      localMesh.setWheelSpin(Math.abs(car.v) * dt);
      const k = 1 - Math.exp(-6 * Math.max(dt, 1e-4));
      const rollT = clamp(-car.steer01 * Math.min(1, Math.abs(car.v) / 30) * 0.1 - car.vlat * 0.003, -0.16, 0.16);
      const dv = dt > 0 ? (car.v - prevV) / dt : 0;
      const pitchT = clamp(-dv * 0.0012, -0.07, 0.07);
      prevV = car.v;
      tiltRoll += (rollT - tiltRoll) * k;
      tiltPitch += (pitchT - tiltPitch) * k;
      localMesh.setTilt(tiltRoll, tiltPitch);

      // chama do nitro
      if (flame) {
        const on = car.nitroActive && car.nitro > 0;
        flame.visible = on;
        if (on) {
          const fl = 1 + Math.sin(performance.now() * 0.04) * 0.18;
          flame.scale.set(fl, fl, 0.8 + fl * 0.4);
        }
        if (flameLight) flameLight.intensity = on ? 1.3 * fxI + Math.random() * 0.3 : 0;
      }
    }

    // --- remotos interpolados
    updateRemotes(dt);

    // --- marcas de derrapagem / fumaça (timer, estado atual)
    if (car && running && !paused) {
      skidNext -= dt;
      smokeNext -= dt;
      const drifting = car.drift01 > 0.35;
      const hardBrake = lastInput.brake > 0.6 && Math.abs(car.v) > 16;
      if ((drifting || hardBrake) && skidNext <= 0) {
        skidNext = 0.05;
        spawnSkid(car);
      }
      if ((drifting || (car.offTrack && Math.abs(car.v) > 8)) && smokeNext <= 0 && fxI > 0.1) {
        smokeNext = 0.08;
        spawnSmoke(car);
      }
    }

    // --- fumaça: vida/reset
    if (smokePool) {
      for (const sp of smokePool) {
        if (!sp.visible) continue;
        sp.userData.life += dt;
        const t = sp.userData.life / sp.userData.max;
        if (t >= 1) { sp.visible = false; continue; }
        sp.position.y += 1.7 * dt;
        const sc = 1 + t * 1.5;
        sp.scale.set(sc, sc, sc);
        sp.material.opacity = 0.5 * (1 - t) * fxI;
      }
    }

    // --- speed-lines (só quality high)
    if (speedLines && car) {
      const sp01 = Math.min(1, Math.abs(car.v) / (PHYSICS.maxSpeed * NITRO.speedBoost));
      const vis = sp01 > 0.55;
      speedLines.visible = vis;
      if (vis) speedLines.children[0].material.opacity = 0.28 * ((sp01 - 0.55) / 0.45);
    }

    updateCamera(dt);
    followSun();
  }

  function updateRemotes(dt) {
    if (!remotes.size) return;
    const renderT = nowFn() - REMOTE_INTERP_DELAY_MS;
    for (const r of remotes.values()) {
      const buf = r.buf;
      let x;
      let z;
      let hd;
      let v;
      let steer;
      if (!buf.length) {
        ({ x, z, hd, v, steer } = r.cur);
      } else if (renderT <= buf[0].t) {
        ({ x, z, hd, v, steer } = buf[0]);
      } else if (renderT >= buf[buf.length - 1].t) {
        // dead-reckoning com cap: avança x,z por v*dt na direção hd até
        // REMOTE_EXTRAP_CAP_MS além da última amostra; depois congela.
        // (interp normal abaixo segue intacta; sem mexer em colisão/autoridade)
        const last = buf[buf.length - 1];
        const overS = Math.min((renderT - last.t) / 1000, REMOTE_EXTRAP_CAP_MS / 1000);
        x = last.x + Math.sin(last.hd) * last.v * overS;
        z = last.z + Math.cos(last.hd) * last.v * overS;
        hd = last.hd;
        v = last.v;
        steer = last.steer;
      } else {
        let i = buf.length - 1;
        while (i > 0 && buf[i - 1].t > renderT) i--;
        const a = buf[i - 1];
        const b = buf[i];
        const u = (renderT - a.t) / Math.max(1e-6, b.t - a.t);
        x = a.x + (b.x - a.x) * u;
        z = a.z + (b.z - a.z) * u;
        hd = a.hd + wrapAngle(b.hd - a.hd) * u;
        v = a.v + (b.v - a.v) * u;
        steer = a.steer + (b.steer - a.steer) * u;
      }
      r.cur.x = x;
      r.cur.z = z;
      r.cur.hd = hd;
      r.cur.v = v;
      r.cur.steer = steer;
      const g = r.mesh.group;
      g.position.set(x, 0, z);
      g.rotation.y = hd;
      r.mesh.setSteer(steer * 0.5);
      r.mesh.setWheelSpin(Math.abs(v) * dt);
      while (buf.length && buf[0].t < renderT - 2500) buf.shift();
    }
  }

  function updateCamera(dt) {
    const car = localCar;
    if (!car) return;
    const fx = Math.sin(car.hd);
    const fz = Math.cos(car.hd);
    const k = 1 - Math.exp(-CAM_LERP * Math.max(dt, 1e-4));
    camPos.x += (car.x - fx * CAM_DIST - camPos.x) * k;
    camPos.z += (car.z - fz * CAM_DIST - camPos.z) * k;
    camPos.y += (CAM_H - camPos.y) * k;

    const sh = shake * fxI;
    camera.position.set(
      camPos.x + (sh ? (Math.random() - 0.5) * sh : 0),
      Math.max(0.8, camPos.y + (sh ? (Math.random() - 0.5) * sh : 0)),
      camPos.z + (sh ? (Math.random() - 0.5) * sh : 0),
    );
    camera.lookAt(car.x + fx * 2.5, 1.2, car.z + fz * 2.5);

    const sp01 = Math.min(1, Math.abs(car.v) / (PHYSICS.maxSpeed * NITRO.speedBoost));
    const fovT = 60 + 12 * sp01; // 60 → 72 pela velocidade
    if (Math.abs(camera.fov - fovT) > 0.05) {
      camera.fov += (fovT - camera.fov) * k;
      camera.updateProjectionMatrix();
    }

    if (shake > 0) shake = Math.max(0, shake - dt * 3.2);
    if (flash > 0) {
      flash = Math.max(0, flash - dt * 6);
      ambient.intensity = baseAmbientI * (1 + flash * 1.6 * fxI);
    }
  }

  function followSun() {
    if (!sun || !sun.castShadow || !localCar) return;
    sun.position.set(localCar.x + 80, 140, localCar.z + 50);
    sun.target.position.set(localCar.x, 0, localCar.z);
    sun.target.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- fachada

  function start({ startAtServerTime = null, now = null, mode: m = 'mp' } = {}) {
    mode = m === 'tt' ? 'tt' : 'mp';
    if (typeof now === 'function') nowFn = now;
    startAtSrv = startAtServerTime;
    started = true;
    paused = false;
    acc = 0;
    lastTs = 0;
    if (startAtServerTime == null) openGate();
    // senão: gate abre sozinho no frame em que nowFn() >= startAtServerTime
  }

  function openGate() {
    if (running) return;
    running = true;
    lapStart = nowFn();
    emit('countdownEnd');
  }

  function pause(p) {
    p = !!p;
    if (mode === 'tt') {
      // tt: congela relógio de volta junto com a simulação
      if (p && !paused) pauseAt = nowFn();
      if (!p && paused) lapStart += nowFn() - pauseAt;
    }
    // mp: simulação segue com input zerado (neutro) — §6
    paused = p;
    if (p) lastInput = ZERO_INPUT;
  }

  function applySnapshot(snap) {
    if (!snap || !Array.isArray(snap.cars) || !localCar) return;
    // invariant: t na MESMA base de renderT (nowFn()−delay = relógio ABSOLUTO
    // do servidor): startAtSrv é o instante absoluto do GO; raceNow é relativo a ele
    const t = (startAtSrv != null && typeof snap.raceNow === 'number')
      ? startAtSrv + snap.raceNow
      : nowFn();
    const preStart = !running; // antes da largada / reconexão: servidor manda posição
    for (const c of snap.cars) {
      if (!c || typeof c.x !== 'number' || typeof c.z !== 'number') continue;
      if (c.id === you) {
        if (preStart) {
          localCar.x = c.x;
          localCar.z = c.z;
          if (typeof c.hd === 'number') localCar.hd = c.hd;
          if (typeof c.v === 'number') localCar.v = c.v;
          // reconexão: restaura o tanque (servidor ecoa nit 0..100 — race.js)
          if (Number.isFinite(c.nit)) localCar.nitro = clamp(c.nit, 0, NITRO.tank);
          const pr = sampler.project(c.x, c.z);
          localCar.s = pr.s;
          localCar.lat = pr.lat;
          localCar.sPrev = pr.s;
          localCar.offTrack = !pr.inside;
        }
        continue; // em corrida o cliente é autoridade do próprio carro
      }
      const r = remotes.get(c.id);
      if (!r) continue;
      r.buf.push({
        t,
        x: c.x,
        z: c.z,
        hd: c.hd || 0,
        v: c.v || 0,
        steer: c.steer || 0,
      });
      if (r.buf.length > BUF_MAX) r.buf.splice(0, r.buf.length - BUF_MAX);
      if (r.buf.length === 1) {
        // primeira amostra: aplica direto (sem esperar o delay de interpolação)
        r.cur.x = c.x;
        r.cur.z = c.z;
        r.cur.hd = c.hd || 0;
      }
    }
  }

  function applyCorrection({ x, z, hd, v }) {
    if (!localCar) return;
    if (typeof x === 'number') localCar.x = x;
    if (typeof z === 'number') localCar.z = z;
    if (typeof hd === 'number') localCar.hd = hd;
    if (typeof v === 'number') localCar.v = v;
    localCar.vlat = 0; // empurrão do servidor: sem componente lateral residual
  }

  function getLocalState() {
    if (!localCar || !running) return null;
    return {
      x: r2(localCar.x),
      z: r2(localCar.z),
      hd: r3(localCar.hd),
      v: r2(localCar.v),
      steer: r2(localCar.steer01),
      hb: lastInput.handbrake ? 1 : 0,
      nit: Math.round(localCar.nitro), // 0..100 (unidades do tanque; servidor clampa — race.js:278)
      off: localCar.offTrack ? 1 : 0,
      dr: r2(localCar.drift01),
    };
  }

  function getHudPayload() {
    const h = {
      speedKmh: localCar ? Math.abs(localCar.v) * 3.6 : 0,
      nitro01: localCar ? clamp(localCar.nitro / NITRO.tank, 0, 1) : 0,
      nitroActive: !!(localCar && localCar.nitroActive),
      tt: null,
    };
    if (mode === 'tt') {
      const cur = running && !paused ? Math.max(0, nowFn() - lapStart) : Math.max(0, pauseAt - lapStart);
      let best = null;
      for (const tms of lapTimes) if (best == null || tms < best) best = tms;
      h.tt = {
        currentLapMs: cur,
        lapTimes: lapTimes.slice(),
        bestLapMs: best,
        invalid: ttInvalid,
      };
    }
    return h;
  }

  function getCarPositions() {
    const out = [];
    if (localCar) {
      const youR = roster.get(you);
      out.push({
        x: localCar.x,
        z: localCar.z,
        heading: localCar.hd,
        color: (youR && youR.color) || (getSettings() || {}).color || '#e5484d',
        isYou: true,
      });
    }
    for (const [id, r] of remotes) {
      const p = roster.get(id);
      out.push({
        x: r.cur.x,
        z: r.cur.z,
        heading: r.cur.hd,
        color: (p && p.color) || '#888888',
        isYou: false,
      });
    }
    return out;
  }

  function recover() {
    doRecover();
  }

  function dispose() {
    cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener('resize', onResize);
    if (scene) {
      const disposeMat = (m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      };
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach(disposeMat);
        else if (m) disposeMat(m);
      });
    }
    handlers.clear();
    remotes.clear();
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    }
    renderer = null;
    scene = null;
    camera = null;
    localCar = null;
    localMesh = null;
    flame = null;
    flameLight = null;
    skidPool = null;
    smokePool = null;
    speedLines = null;
    started = false;
    running = false;
    paused = false;
  }

  return {
    load,
    start,
    pause,
    applySnapshot,
    applyCorrection,
    getLocalState,
    getHudPayload,
    recover,
    on,
    getCarPositions,
    dispose,
  };
}
