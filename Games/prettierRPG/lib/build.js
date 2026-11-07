'use strict';

// Validação e atributos de build — catálogo completo T8.0 Normal IP1100.
// Fonte: docs/PRODUTO.md §§3,14,15. Qualquer 1M + qualquer offhand, mistura
// livre de peças, 1 opção por slot/passiva (Soldier Armor: 2 passivas).
// Compat: mantém VALID/DEFAULT_BUILD/KIT_BONUS/BASE_HP/BASE_ENERGY/
// maxHpFor/maxEnergyFor/validateBuild + reexporta catálogo.

const catalog = require('./catalog');
const { ITEMS, SKILLS, getItem, getSkill, calcStats, APPROX } = catalog;

const WEAPONS = ['battleaxe', 'dagger', 'fire-staff', 'frost-staff', 'holy-staff'];
const OFFHANDS = ['shield', 'tome', 'torch'];
const HEADS = ['mercenary-hood', 'soldier-helmet', 'scholar-cowl'];
const CHESTS = ['mercenary-jacket', 'soldier-armor', 'scholar-robe'];
const BOOTS = ['mercenary-shoes', 'soldier-boots', 'scholar-sandals'];
const CAPES = ['cape-bridgewatch', 'cape-fort-sterling', 'cape-lymhurst', 'cape-martlock', 'cape-thetford', 'cape-caerleon'];

// Slots válidos (chestPassive2 só p/ Soldier Armor).
const VALID = {
  weapon: WEAPONS,
  q: true, w: true, e: true, weaponPassive: true, // dependem da arma
  offhand: OFFHANDS,
  head: HEADS, headActive: true, headPassive: true,
  chest: CHESTS, chestActive: true, chestPassive: true, chestPassive2: true,
  boots: BOOTS, bootsActive: true, bootsPassive: true,
  cape: CAPES,
};

const DEFAULT_BUILD = {
  weapon: 'battleaxe',
  q: 'rending-strike',
  w: 'deadly-chop',
  e: 'blood-bandit',
  weaponPassive: 'deep-cuts',
  offhand: 'torch',
  head: 'mercenary-hood',
  headActive: 'energizing-shield',
  headPassive: 'balanced-mind',
  chest: 'mercenary-jacket',
  chestActive: 'mend-wounds',
  chestPassive: 'balanced-mind',
  boots: 'mercenary-shoes',
  bootsActive: 'dodge',
  bootsPassive: 'balanced-mind',
  cape: 'cape-caerleon',
};

// Bônus fixos do kit padrão (T8 Normal): machado +95HP; capuz +269HP/+98EN;
// jaqueta +539HP/+49EN; botas +269HP/+29EN; capa +20EN.
const KIT_BONUS = { hp: 95 + 269 + 539 + 269, energy: 98 + 49 + 29 + 20 };
const BASE_HP = 1200;
const BASE_ENERGY = 120;

function maxHpFor(b) { return calcStats(b || DEFAULT_BUILD).maxHp; }
function maxEnergyFor(b) { return calcStats(b || DEFAULT_BUILD).maxEnergy; }

function inList(v, list) { return typeof v === 'string' && list.includes(v); }

function validateBuild(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    return { ok: false, error: 'build inválida: objeto esperado' };
  }
  for (const key of Object.keys(b)) {
    if (!Object.prototype.hasOwnProperty.call(VALID, key)) {
      return { ok: false, error: `slot inexistente: ${key}` };
    }
  }
  const need = ['weapon', 'q', 'w', 'e', 'weaponPassive', 'offhand', 'head', 'headActive', 'headPassive', 'chest', 'chestActive', 'chestPassive', 'boots', 'bootsActive', 'bootsPassive', 'cape'];
  for (const slot of need) {
    if (b[slot] === undefined) return { ok: false, error: `slot ausente: ${slot}` };
  }
  if (!inList(b.weapon, WEAPONS)) return { ok: false, error: `slot inválido: weapon (${String(b.weapon)})` };
  if (!inList(b.offhand, OFFHANDS)) return { ok: false, error: `slot inválido: offhand (${String(b.offhand)})` };
  if (!inList(b.head, HEADS)) return { ok: false, error: `slot inválido: head (${String(b.head)})` };
  if (!inList(b.chest, CHESTS)) return { ok: false, error: `slot inválido: chest (${String(b.chest)})` };
  if (!inList(b.boots, BOOTS)) return { ok: false, error: `slot inválido: boots (${String(b.boots)})` };
  if (!inList(b.cape, CAPES)) return { ok: false, error: `slot inválido: cape (${String(b.cape)})` };
  const w = ITEMS[b.weapon].skills;
  for (const [slot, list] of [['q', w.q], ['w', w.w], ['e', w.e], ['weaponPassive', w.passive]]) {
    if (!inList(b[slot], list || [])) return { ok: false, error: `slot inválido: ${slot} (${String(b[slot])}) não pertence a ${b.weapon}` };
  }
  const armorSlots = [['head', 'headActive', 'active', 'headPassive', 'passive'], ['chest', 'chestActive', 'active', 'chestPassive', 'passive'], ['boots', 'bootsActive', 'active', 'bootsPassive', 'passive']];
  for (const [itemSlot, actSlot, actKey, pasSlot, pasKey] of armorSlots) {
    const item = ITEMS[b[itemSlot]];
    if (!inList(b[actSlot], (item.skills && item.skills[actKey]) || [])) {
      return { ok: false, error: `slot inválido: ${actSlot} (${String(b[actSlot])}) não pertence a ${b[itemSlot]}` };
    }
    if (!inList(b[pasSlot], (item.skills && item.skills[pasKey]) || [])) {
      return { ok: false, error: `slot inválido: ${pasSlot} (${String(b[pasSlot])}) não pertence a ${b[itemSlot]}` };
    }
  }
  // Soldier Armor: 2ª passiva obrigatória; demais peças não têm esse slot.
  if (b.chest === 'soldier-armor') {
    if (!inList(b.chestPassive2, ITEMS['soldier-armor'].skills.passive2 || [])) {
      return { ok: false, error: `slot inválido: chestPassive2 (${String(b.chestPassive2)}) exige spirit-crush/protective-instinct` };
    }
    if (b.chestPassive === b.chestPassive2) {
      return { ok: false, error: 'slot inválido: chestPassive e chestPassive2 devem diferir em grupo (1º grupo x 2º grupo)' };
    }
  } else if (b.chestPassive2 != null) {
    return { ok: false, error: 'slot inválido: chestPassive2 só existe na Soldier Armor' };
  }
  return { ok: true };
}

module.exports = {
  VALID, DEFAULT_BUILD, KIT_BONUS, BASE_HP, BASE_ENERGY,
  maxHpFor, maxEnergyFor, validateBuild,
  ITEMS, SKILLS, getItem, getSkill, calcStats, APPROX,
};
