import './style.css';
import { Game } from './game.js';
import type { HubParams } from './game.js';
import { Hud } from './hud.js';

const canvas = document.getElementById('game-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas do jogo não encontrado.');
}

const hud = new Hud();
const game = new Game(canvas, hud);

/** Modo Hub: ?hub=1&room=&name=&create=1|0&expect=&slot=&hubUrl= */
function readHubParams(): HubParams | null {
  try {
    const query = new URLSearchParams(window.location.search);
    if (query.get('hub') !== '1') return null;
    const room = (query.get('room') ?? '')
      .toUpperCase()
      .replace(/[^A-HJ-NP-Z2-9]/g, '')
      .slice(0, 4);
    if (!room) return null;
    const name = (query.get('name') ?? '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Jogador';
    return {
      room,
      name,
      create: query.get('create') === '1',
      hubUrl: query.get('hubUrl') ?? '',
    };
  } catch {
    return null;
  }
}

const hubParams = readHubParams();
if (hubParams) {
  game.startHub(hubParams);
} else {
  const roomFromUrl = new URLSearchParams(window.location.search).get('sala');
  hud.prefillRoom(roomFromUrl);
}

game.start();
