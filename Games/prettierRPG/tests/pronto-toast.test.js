const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateBuild, DEFAULT_BUILD } = require('../lib/build');
const sim = require('../lib/sim');

// Achado E2E-UI-BUILD-TOAST: todo "Pronto" sem Soldier Armor exibia
// "Build inválida: chestPassive2 só existe na Soldier Armor" (fluxo seguia,
// mas todo usuário via o toast). Causa: normBuild emite cPass2:null,
// o merge servidor {...p.build,...msg.build} herda o null e pick() trata
// null como "enviado". Contrato: null/ausente = não enviado
// (só validar quando != null), sem quebrar as 2 passivas da Soldier.
test('Pronto sem soldier: chestPassive2 null/ausente valida ok', () => {
  const base = structuredClone(DEFAULT_BUILD); // mercenary, sem chestPassive2
  assert.equal(validateBuild(base).ok, true, 'ausente valida');
  const comNull = { ...structuredClone(DEFAULT_BUILD), chestPassive2: null };
  assert.equal(validateBuild(comNull).ok, true, 'null = não enviado');
});

test('Pronto sem soldier via fluxo join→merge→canon valida ok', () => {
  const m = sim.createMatch('TST', {});
  assert.ok(sim.joinPlayer(m, 'p1', 'Ana', {}).ok, 'join com build limpa');
  const p = m.players.get('p1');
  // payload limpo como buildParaServidor() envia (sem chestPassive2 no JSON)
  const msgBuild = { ...sim.simToCanonBuild(p.build) };
  delete msgBuild.chestPassive2;
  const merged = { ...p.build, ...msgBuild }; // merge do handler 'build'
  const v = validateBuild(sim.simToCanonBuild(merged));
  assert.equal(v.ok, true, 'merge herdando cPass2:null valida');
});

test('Soldier Armor: 2 passivas seguem obrigatórias', () => {
  const sol = {
    ...structuredClone(DEFAULT_BUILD),
    chest: 'soldier-armor', chestActive: 'mend-wounds',
    chestPassive: 'toughness', chestPassive2: 'spirit-crush',
  };
  assert.equal(validateBuild(sol).ok, true, 'soldier válida passa');
  const sem2 = { ...sol };
  delete sem2.chestPassive2;
  assert.equal(validateBuild(sem2).ok, false, 'soldier sem 2ª passiva rejeita');
  const null2 = { ...sol, chestPassive2: null };
  assert.equal(validateBuild(null2).ok, false, 'soldier com null rejeita');
});
