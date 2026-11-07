const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateBuild, DEFAULT_BUILD } = require('../lib/build');

test('build padrão válida passa', () => {
  const r = validateBuild(structuredClone(DEFAULT_BUILD));
  assert.equal(r.ok, true);
});

test('validação rejeita slot inexistente', () => {
  const b = structuredClone(DEFAULT_BUILD);
  b.q = 'golpe-inexistente';
  const r = validateBuild(b);
  assert.equal(r.ok, false);
  assert.match(r.error, /slot|inválid|inexistente/i);
});

test('validação rejeita arma inexistente', () => {
  const b = structuredClone(DEFAULT_BUILD);
  b.weapon = 'espada-laser';
  const r = validateBuild(b);
  assert.equal(r.ok, false);
});
