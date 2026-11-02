import { describe, expect, it } from 'vitest';
import { canEnterRoadMode } from '../../src/client/game/HandPanel';

describe('canEnterRoadMode (gate do modo estrada)', () => {
  it('sem madeira+tijolo e sem estrada gratuita => nao entra', () => {
    expect(canEnterRoadMode({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 }, 0)).toBe(false);
    expect(canEnterRoadMode({ brick: 1, lumber: 0, wool: 5, grain: 5, ore: 5 }, 0)).toBe(false);
    expect(canEnterRoadMode({ brick: 0, lumber: 1, wool: 5, grain: 5, ore: 5 }, 0)).toBe(false);
  });

  it('com 1 tijolo + 1 madeira => entra mesmo sem estrada gratuita', () => {
    expect(canEnterRoadMode({ brick: 1, lumber: 1, wool: 0, grain: 0, ore: 0 }, 0)).toBe(true);
  });

  it('sem recurso mas com estrada gratuita (carta) => entra', () => {
    expect(canEnterRoadMode({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 }, 1)).toBe(true);
    expect(canEnterRoadMode({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 }, 2)).toBe(true);
  });
});
