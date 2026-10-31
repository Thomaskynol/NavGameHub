// Parser dos parâmetros do modo Hub (?hub=1...). Puro, sem DOM.
import { describe, expect, it } from 'vitest';
import { parseHubParams } from '../../src/client/session';

describe('parseHubParams', () => {
  it('null fora do modo Hub', () => {
    expect(parseHubParams('')).toBeNull();
    expect(parseHubParams('?room=ABCDEF&name=Ana')).toBeNull();
    expect(parseHubParams('?hub=0&room=ABCDEF&name=Ana')).toBeNull();
  });

  it('lê create=1 com sala, apelido, expect, slot e hubUrl', () => {
    const hubUrl = encodeURIComponent('http://10.0.0.2:8090/?room=HZ12');
    const p = parseHubParams(`?hub=1&room=ab12cd&name=%20Ana%20%20Souza%20&create=1&expect=3&slot=0&hubUrl=${hubUrl}`);
    expect(p).toEqual({
      room: 'AB12CD',
      name: 'Ana Souza',
      create: true,
      expect: 3,
      slot: 0,
      hubUrl: 'http://10.0.0.2:8090/?room=HZ12',
    });
  });

  it('create=0 vira join; números inválidos viram 0', () => {
    const p = parseHubParams('?hub=1&room=ABCDEF&name=Bia&create=0&expect=x&slot=-2');
    expect(p?.create).toBe(false);
    expect(p?.expect).toBe(0);
    expect(p?.slot).toBe(0);
  });

  it('saneia a sala e exige apelido', () => {
    expect(parseHubParams('?hub=1&room=ab-cd-ef!!&name=Ana')?.room).toBe('ABCDEF');
    expect(parseHubParams('?hub=1&room=ABCDEF&name=%20%20')).toBeNull();
    expect(parseHubParams('?hub=1&name=Ana')).toBeNull();
  });
});
