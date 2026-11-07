'use strict';
// RED TDD p/ review lane (18 itens). Cada teste deve FALHAR antes do fix pelo motivo esperado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sim = require('../lib/sim');
const catalog = require('../lib/catalog');

function B(over = {}) {
  return { weapon: 'battleaxe', q: 'rending-strike', w: 'deadly-chop', e: 'blood-bandit', offhand: 'torch', head: 'mercenary-hood', chest: 'mercenary-jacket', boots: 'mercenary-shoes', cape: 'bridgewatch', ...over };
}
function arena(mode = 'ffa', b1 = {}, b2 = {}) {
  const m = sim.createMatch('T', { mode, durationSec: 300 });
  sim.joinPlayer(m, 'p1', 'Ana', B(b1));
  sim.joinPlayer(m, 'p2', 'Beto', B(b2));
  if (mode === '2v2') { m.players.get('p1').team = 0; m.players.get('p2').team = 1; }
  sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
  m.players.get('p1').x = 10; m.players.get('p1').y = 10;
  m.players.get('p2').x = 11; m.players.get('p2').y = 10;
  m.players.get('p1').energy = 500; m.players.get('p2').energy = 500;
  return m;
}

test('1-life-leech cura 15% do dano efetivo no AA', () => {
  const m = arena('ffa', { wPass: 'life-leech' });
  const s = m.players.get('p1'), d = m.players.get('p2');
  s.hp = s.maxHp - 500;
  const r = sim.basicAttack(m, 'p1', 'p2');
  assert.ok(r.ok);
  assert.ok(r.dmg > 0);
  const esperado = r.dmg * 0.15;
  // cura aproximada (regen do tick não aplicada aqui; só lifesteal)
  assert.ok(s.hp > s.maxHp - 500, `life-leech deveria curar ~${esperado.toFixed(1)}`);
});

test('1-frost: apos 4 spells proximo AA enraiza ~1,2s', () => {
  const m = arena('ffa', { weapon: 'frost', q: 'frostbite', w: 'frost-bomb', e: 'freezing-wind', wPass: 'frost' });
  const s = m.players.get('p1');
  s.energy = 9999;
  // 4 spells (Q repetido, cd curto)
  for (let i = 0; i < 4; i++) { s.cd.q = 0; s.castUntil = 0; sim.useSkill(m, 'p1', 'Q', 'p2', { x: 11, y: 10 }); }
  s.castUntil = 0; s.cd.aa = 0;
  sim.basicAttack(m, 'p1', 'p2');
  const d = m.players.get('p2');
  assert.ok(d.cc.rootUntil > m.time, 'frost deveria enraizar no AA seguinte');
});

test('1-magic-force: apos 5 spells proximo AA empurra ~2,99m', () => {
  const m = arena('ffa', { weapon: 'holy', q: 'smite', w: 'sacred-pulse', e: 'desperate-prayer', wPass: 'magic-force' });
  const s = m.players.get('p1'), d = m.players.get('p2');
  s.energy = 9999;
  for (let i = 0; i < 5; i++) { s.cd.q = 0; s.castUntil = 0; m.players.get('p2').hp = m.players.get('p2').maxHp; sim.useSkill(m, 'p1', 'Q', null, { x: 11, y: 10 }); }
  const bx = d.x, by = d.y;
  s.castUntil = 0; s.cd.aa = 0;
  // garante alcance: aproxima
  s.x = d.x - 2; s.y = d.y;
  sim.basicAttack(m, 'p1', 'p2');
  const moved = Math.hypot(d.x - bx, d.y - by);
  assert.ok(moved > 1, `magic-force deveria empurrar ~2,99m (moveu ${moved.toFixed(2)})`);
});

test('2-ascended +5% dano/cura; courier inerte', () => {
  const mk = (pass) => {
    const m = sim.createMatch('T', {});
    sim.joinPlayer(m, 'p1', 'Ana', B({ weapon: 'holy', q: 'generous-heal', w: 'sacred-pulse', e: 'desperate-prayer', wPass: pass }));
    sim.joinPlayer(m, 'p2', 'Beto', B({}));
    sim.setReady(m, 'p1', true); sim.setReady(m, 'p2', true);
    m.players.get('p1').x = 10; m.players.get('p1').y = 10; m.players.get('p2').x = 11; m.players.get('p2').y = 10;
    const antes = m.players.get('p2').hp;
    sim.basicAttack(m, 'p1', 'p2');
    return antes - m.players.get('p2').hp;
  };
  const base = mk(undefined);
  const asc = mk('ascended');
  assert.ok(asc > base * 1.04, `ascended +5% (${base} -> ${asc})`);
});

test('3-stacks de AA funcionam (aggressive-rush/thetford/aa-speed)', () => {
  const m = arena('ffa', { cape: 'thetford', wPass: 'aggressive-rush' });
  const s = m.players.get('p1');
  s.energy = 9999;
  for (let i = 0; i < 4; i++) { s.cd.aa = 0; m.players.get('p2').hp = m.players.get('p2').maxHp; const r = sim.basicAttack(m, 'p1', 'p2'); assert.ok(r.ok, 'AA ' + i + ' ok'); }
  assert.ok(s.aggrRushUntil > m.time, 'aggressive-rush ativo apos 4 AA');
});

test('4-deep-cuts aplica bleed real apos 4 AA', () => {
  const m = arena('ffa', { wPass: 'deep-cuts' });
  const s = m.players.get('p1');
  s.energy = 9999;
  for (let i = 0; i < 4; i++) { s.cd.aa = 0; m.players.get('p2').hp = m.players.get('p2').maxHp; sim.basicAttack(m, 'p1', 'p2'); }
  const d = m.players.get('p2');
  const temBleed = (d.bleeds && d.bleeds.length > 0) || (d.dots && d.dots.some((x) => /deep|cut|bleed/i.test(x.id || '')));
  assert.ok(temBleed, 'deep-cuts deveria aplicar bleed apos 4 AA');
});

test('5-increased-defense reduz dano (ironSkinUntil lido no dealDamage)', () => {
  const m = arena('ffa', {}, { wPass: 'increased-defense' });
  const d = m.players.get('p2');
  d.hp = d.maxHp;
  const r1 = sim.dealDamage(m, 'p1', 'p2', 200, m.time, { type: 'phys' });
  d.hp = d.maxHp;
  d.ironSkinUntil = m.time + 2000;
  const r2 = sim.dealDamage(m, 'p1', 'p2', 200, m.time, { type: 'phys' });
  assert.ok(r2.dmg < r1.dmg, `ironSkin deveria reduzir (${r1.dmg} -> ${r2.dmg})`);
});

test('6-burn: AA de fogo aplica 72/3s', () => {
  const m = arena('ffa', { weapon: 'fire', q: 'fire-bolt', w: 'flame-blast', e: 'pyroblast', wPass: 'burn' });
  sim.basicAttack(m, 'p1', 'p2');
  const d = m.players.get('p2');
  const dot = (d.dots || []).find((x) => x.id === 'burn');
  assert.ok(dot, 'burn deveria aplicar dot no AA');
  const total = dot.perTick * 3;
  assert.ok(Math.abs(total - 72) < 5, `burn total ~72 (achou ${total})`);
});

test('7-dash custa 1 (catalogo)', () => {
  assert.equal(catalog.getSkill('dash').cost, 1);
  const p = sim.skillParams('dash');
  assert.equal(p.cost, 1, 'sim deve aplicar custo 1 do catalogo');
  const m = arena('ffa', { weapon: 'dagger', q: 'sunder-armor', w: 'dash', e: 'bloodthirsty-blade' });
  const s = m.players.get('p1');
  s.energy = 100;
  const antes = s.energy;
  const r = sim.useSkill(m, 'p1', 'W', null, { x: 14, y: 10 });
  assert.ok(r.ok);
  assert.ok(antes - s.energy >= 1, 'dash deveria gastar >=1 energia');
});

test('8-shadow-edge sem dano inventado (so stun/teleporte)', () => {
  const m = arena('ffa', { weapon: 'dagger', q: 'sunder-armor', w: 'shadow-edge', e: 'bloodthirsty-blade' });
  const d = m.players.get('p2');
  d.hp = d.maxHp;
  const antes = d.hp;
  m.players.get('p1').energy = 500;
  const r = sim.useSkill(m, 'p1', 'W', 'p2');
  assert.ok(r.ok);
  assert.equal(d.hp, antes, 'shadow-edge nao deve causar dano inventado');
  assert.ok(d.cc.stunUntil > m.time, 'mas deve aplicar stun');
});

test('9-howl custo 0', () => {
  assert.equal(catalog.getSkill('howl').cost, 0);
  const m = arena('ffa', { hSkill: 'howl' });
  const s = m.players.get('p1');
  s.energy = 100;
  // howl é cone direcional: sem direção rejeita sem gastar (como dodge)
  const r0 = sim.useSkill(m, 'p1', 'HEAD', null);
  assert.equal(r0.ok, false);
  assert.equal(s.energy, 100, 'sem direção não gasta');
  const r = sim.useSkill(m, 'p1', 'HEAD', 'p2', { x: 11, y: 10 });
  assert.ok(r.ok);
  assert.ok(Math.abs(s.energy - 100) < 0.01, 'howl custo 0');
});

test('10-inferno custo0/CD30/reflect 20%', () => {
  assert.equal(catalog.getSkill('inferno-shield').cost, 0);
  assert.equal(catalog.getSkill('inferno-shield').cd, 30);
  const m = arena('ffa', { cSkill: 'inferno-shield' });
  const s = m.players.get('p1');
  s.energy = 100;
  const r = sim.useSkill(m, 'p1', 'CHEST', null);
  assert.ok(r.ok);
  assert.ok(Math.abs(s.energy - 100) < 0.01, 'inferno custo 0');
  assert.ok(s.cd.chest - m.time <= 30001 && s.cd.chest - m.time >= 29000, 'CD 30s');
  // reflect: atacante sofre 20%
  const a = m.players.get('p2');
  a.x = 10.5; a.y = 10;
  const hpA = a.hp;
  sim.dealDamage(m, 'p2', 'p1', 100, m.time, { type: 'phys' });
  assert.ok(a.hp < hpA, 'inferno deveria refletir 20%');
});

test('11-bloodlust custo0/CD30/6s com cura 30% do dano direto (cap 120/600)', () => {
  assert.equal(catalog.getSkill('bloodlust').cost, 0);
  const m = arena('ffa', { cSkill: 'bloodlust' });
  const s = m.players.get('p1');
  s.energy = 100;
  const r = sim.useSkill(m, 'p1', 'CHEST', null);
  assert.ok(r.ok);
  assert.ok(s.bloodlustUntil - m.time <= 6100 && s.bloodlustUntil - m.time >= 5900, 'bloodlust 6s');
  // AA (dano direto) cura 30% com cap 120; sem bônus flat +50.
  s.hp = s.maxHp - 200;
  s.cd.aa = 0;
  const hpAntes = s.hp, dd0 = m.players.get('p2').hp;
  sim.basicAttack(m, 'p1', 'p2');
  const dealt = dd0 - m.players.get('p2').hp;
  assert.ok(dealt < 150, `sem +50 flat por AA (dano ${dealt})`);
  assert.equal(Math.round(s.hp - hpAntes), Math.min(120, Math.round(dealt * 0.30)), 'cura 30% do direto');
  // DoT não dispara
  s.hp = s.maxHp - 500;
  const hB = s.hp;
  m.players.get('p2').bleeds.push({ until: m.time + 6000, perSec: 50, from: 'p1' });
  sim.tick(m, 1000);
  assert.ok(Math.abs(s.hp - hB) < 60, 'DoT não dispara bloodlust');
});

test('12-refreshing +40% mov/+20% recarga 5s', () => {
  const m = arena('ffa', { boots: 'mercenary-shoes', bSkill: 'refreshing-sprint' });
  sim.useSkill(m, 'p1', 'BOOTS', null);
  const s = m.players.get('p1');
  assert.equal(s.moveBonus, 0.40);
  const buff = (s.buffs || []).find((x) => x.id === 'cdr-sprint');
  assert.ok(buff && Math.abs(buff.cdr - 0.20) < 0.001, 'cdr +20%');
});

test('13-rejuvenating 40/s', () => {
  const m = arena('ffa', { boots: 'soldier-boots', bSkill: 'rejuvenating-sprint' });
  sim.useSkill(m, 'p1', 'BOOTS', null);
  const s = m.players.get('p1');
  const hot = (s.hots || []).find((x) => x.id === 'reju');
  assert.ok(hot, 'hot reju existe');
  assert.equal(hot.perTick, 40);
});

test('14-wanderlust +80% 8s fora de combate; cancela em combate', () => {
  const m = arena('ffa', { boots: 'soldier-boots', bSkill: 'wanderlust' });
  sim.useSkill(m, 'p1', 'BOOTS', null);
  const s = m.players.get('p1');
  assert.equal(s.moveBonus, 0.80);
  assert.ok(s.wanderlustUntil - m.time >= 7900, 'wanderlust 8s');
  // entrar em combate cancela
  sim.dealDamage(m, 'p2', 'p1', 50, m.time, { type: 'phys' });
  sim.tick(m, 100);
  assert.ok(!(s.wanderlustUntil > m.time), 'wanderlust cancela em combate');
});

test('15-finish: cancela por dano/move/skill do finalizador; segue no levantar', () => {
  const m = sim.createMatch('D', { mode: '2v2' });
  sim.joinPlayer(m, 'a1', 'A1', B(), 0); sim.joinPlayer(m, 'a2', 'A2', B(), 0);
  sim.joinPlayer(m, 'b1', 'B1', B(), 1); sim.joinPlayer(m, 'b2', 'B2', B(), 1);
  for (const id of ['a1', 'a2', 'b1', 'b2']) sim.setReady(m, id, true);
  const v = m.players.get('a1'); v.x = 10; v.y = 10;
  v.hp = 100;
  sim.dealDamage(m, null, 'a1', 9999, m.time, { env: true });
  assert.ok(v.knocked);
  const f = m.players.get('b1'); f.x = 10.5; f.y = 10; f.energy = 500;
  assert.ok(sim.useSkill(m, 'b1', 'FINISH', 'a1').ok);
  // dano no finalizador cancela
  sim.dealDamage(m, 'a2', 'b1', 10, m.time, { type: 'phys' });
  assert.ok(!f.finish, 'dano no finalizador cancela');
  // reinicia; skill do finalizador cancela
  f.x = 10.5; f.y = 10; f.hp = f.maxHp; f.cd.q = 0; f.cd.w = 0; f.energy = 500;
  assert.ok(sim.useSkill(m, 'b1', 'FINISH', 'a1').ok);
  f.cd.q = 0; f.energy = 500;
  sim.useSkill(m, 'b1', 'Q', 'a2');
  assert.ok(!f.finish, 'skill do finalizador cancela');
  // reinicia perto do levantar: finish iniciada no caído prossegue na fase de levantar
  f.x = 10.5; f.y = 10; f.hp = f.maxHp; f.energy = 500; f.cd.q = 0; f.cd.w = 0;
  sim.tick(m, 12000); // t=12s: vítima ainda caída, sem levantar
  assert.ok(!v.gettingUpUntil, 'ainda caída sem levantar');
  assert.ok(sim.useSkill(m, 'b1', 'FINISH', 'a1').ok);
  const finUntil = f.finish.until; // t=12s + 5s = 17s
  sim.tick(m, 3500); // t=15,5s: vítima entra em getting-up (15s), finish segue
  assert.ok(v.gettingUpUntil > 0, 'vítima levantando');
  assert.ok(f.finish && f.finish.until === finUntil, 'finish continua no levantar');
  sim.tick(m, 2000); // t=17,5s: finish conclui e mata
  assert.equal(v.alive, false, 'finish conclui após o levantar iniciar');
});

test('16-menu permite 2v2 e client envia modo', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(/2v2/.test(html), 'menu menciona 2v2');
  assert.ok(/in-modo|modo.*2v2|select.*modo/i.test(html), 'menu tem seletor de modo');
  const cli = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
  assert.ok(/['"]mode['"]/.test(cli), 'client envia troca de modo');
});

test('17-servidor permite build em PvE a qualquer momento', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/pve/.test(src) && /build/.test(src), 'server menciona pve+build');
  // deve haver exceção pve no handler de build (não só lobby)
  assert.ok(/mode.*pve|pve.*build|build.*pve/i.test(src), 'server tem exceção PvE p/ build');
  assert.ok(!/Build só pode mudar no lobby/.test(src) || /pve/i.test(src.split('Build só pode mudar no lobby')[0].slice(-500)), 'mensagem lobby com exceção PvE próxima');
});

test('18-server usa valor real da skill na cura (nunca fixo 200)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(!/healDummy\(m,\s*ws\.pid,\s*200\)/.test(src), 'sem healDummy fixo 200');
});

test('19-2v2 sem decisao por HP total; so eliminacao/wave', () => {
  const m = sim.createMatch('V', { mode: '2v2' });
  sim.joinPlayer(m, 'a1', 'A1', B(), 0); sim.joinPlayer(m, 'a2', 'A2', B(), 0);
  sim.joinPlayer(m, 'b1', 'B1', B(), 1); sim.joinPlayer(m, 'b2', 'B2', B(), 1);
  for (const id of ['a1', 'a2', 'b1', 'b2']) sim.setReady(m, id, true);
  m.time = m.endsAt + 1000;
  m.roundStartAt = m.time; // wave ainda nao começou na rodada
  m.players.get('a1').hp = 100; m.players.get('a2').hp = 100;
  m.players.get('b1').hp = m.players.get('b1').maxHp; m.players.get('b2').hp = m.players.get('b2').maxHp;
  const w0 = { ...m.wins };
  sim.tick(m, 50);
  assert.deepEqual(m.wins, w0, 'timeout nao decide por HP total');
  assert.equal(m.roundState, 'playing', 'rodada segue sem eliminacao');
});

test('hub joinable checa lotacao', () => {
  const hub = require('../lib/hub');
  const rooms = new Map();
  const m = sim.createMatch('H', { mode: 'ffa' });
  rooms.set('H', { match: m, conns: new Map(), secrets: new Map(), pendingRemove: new Map(), returned: new Set(), creatorId: null });
  // lota FFA (12)
  for (let i = 0; i < 12; i++) sim.joinPlayer(m, 'p' + i, 'N' + i, B());
  const r = hub.stateOf(rooms, 'H', null);
  // sem HUB_SECRET => 503; com secret checa joinable
  process.env.HUB_SECRET = process.env.HUB_SECRET || 't';
  const r2 = hub.stateOf(rooms, 'H', null);
  assert.equal(r2.body.room.joinable, false, 'lotada nao joinable');
  delete process.env.HUB_SECRET;
});

test('client skill envia x,y p/ area/direcao', () => {
  const cli = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
  assert.ok(/x:\s*\+?wx|x:\s*msg\.x|JSON\.stringify\(\{[^}]*x/.test(cli), 'client envia x,y na skill');
});

test('catalogo x sim: campos corrigidos (dash/howl/inferno/bloodlust/sprints)', () => {
  for (const id of ['dash', 'howl', 'inferno-shield', 'bloodlust', 'refreshing-sprint', 'rejuvenating-sprint', 'wanderlust']) {
    const cat = catalog.getSkill(id);
    assert.ok(cat, 'catalogo tem ' + id);
    const p = sim.skillParams(id);
    assert.ok(p, 'sim tem params ' + id);
    assert.equal(p.cost, cat.cost, `${id} custo`);
    assert.equal(p.cdMs, Math.round(cat.cd * 1000), `${id} cd`);
  }
});
