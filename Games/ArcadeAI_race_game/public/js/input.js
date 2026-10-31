// public/js/input.js — re-export da fachada de input (lane gfx; caminho §1).
// main.js importa './input.js' (js/); a implementação fica junto do engine em
// js/game/input.js. Mantém apenas a fachada pública (§6).
export { getInput, setActive, onEsc } from './game/input.js';
