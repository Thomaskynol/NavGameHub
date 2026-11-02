// Asfalto Vivo — teste do parsing do modo Hub (public/js/hub.js).
// Garante que ?hub=1 vira boot automático (create honra a sala pedida,
// join entra nela) e que fora do Hub nada muda (null → fluxo normal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHubParams } from '../public/js/hub.js';

test('hub: null sem ?hub=1 (fluxo normal intacto)', () => {
  assert.equal(parseHubParams(''), null);
  assert.equal(parseHubParams('?room=ABCDEF'), null);
  assert.equal(parseHubParams('?hub=0&room=ABCDEF&name=Bot'), null);
});

test('hub: create=1 honra sala/nome/cor/hubUrl', () => {
  const p = parseHubParams('?hub=1&room=TEST01&name=Bot&create=1&expect=2&slot=0&color=%23e5484d&hubUrl=http%3A%2F%2Fh%2Fsala');
  assert.equal(p.create, true);
  assert.equal(p.room, 'TEST01');
  assert.equal(p.name, 'Bot');
  assert.equal(p.expect, 2);
  assert.equal(p.slot, 0);
  assert.equal(p.color, '#e5484d');
  assert.equal(p.hubUrl, 'http://h/sala');
});

test('hub: create=0 entra na sala com apelido e sem cor (servidor escolhe)', () => {
  const p = parseHubParams('?hub=1&room=ABCDEF&name=Ana&create=0&hubUrl=http%3A%2F%2Fh%2Fsala');
  assert.equal(p.create, false);
  assert.equal(p.room, 'ABCDEF');
  assert.equal(p.name, 'Ana');
  assert.equal(p.color, null);
  assert.equal(p.hubUrl, 'http://h/sala');
});

test('hub: normaliza sala/nome como o cliente faz', () => {
  const p = parseHubParams('?hub=1&room=test-01!!&name=%20%20Ana%20%20&create=1');
  assert.equal(p.room, 'TEST01');
  assert.equal(p.name, 'Ana');
});
