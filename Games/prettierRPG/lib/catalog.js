'use strict';

// Catálogo canônico T8.0 Normal IP1100 (base 1200HP/120EN).
// Fonte: docs/PRODUTO.md §§3,4,14,15 (Anexos A–F). Precedência:
// produto > 3º levantamento > 2º levantamento > histórico 2025.
// Campos sem fonte confiável viram APROX registrada (ver APPROX).

const DATA = require('../data/equipment.json');

const ITEMS = {};
for (const it of DATA.items) ITEMS[it.id] = it;
const SKILLS = {};
for (const sk of DATA.skills) SKILLS[sk.id] = sk;

function getItem(id) { return ITEMS[id] || null; }
function getSkill(id) { return SKILLS[id] || null; }

// Registro de aproximações: {skill|item, campo, valor, justificativa, origem}.
// Gerado das marcas "approx" do JSON + regras estruturais do projeto.
const APPROX = [];
for (const sk of DATA.skills) {
  if (sk.approx) {
    APPROX.push({
      skill: sk.id, campo: 'efeito/custo/CD',
      valor: sk.approx, justificativa: 'sem fonte confiável; hipótese jogável até teste',
      origem: sk.source,
    });
  }
}
APPROX.push(
  { item: 'capuz/botas', campo: 'Armor/MR', valor: 'adotado 0', justificativa: 'não listado na linha consultada; 0 é piso, não prova ausência', origem: 'C.3 nota "não listado não prova zero"' },
  { skill: 'caerleon-reset', campo: 'cd', valor: '60s', justificativa: 'hipótese do projeto §14 (sem valor confiável)', origem: 'PRODUTO §14' },
  { skill: 'courier', campo: 'efeito', valor: 'inerte', justificativa: 'sem peso/inventário nesta versão; tooltip informa', origem: 'PRODUTO §14' },
  { campo: 'stacking', valor: 'bônus somados (aditivo)', justificativa: 'ordem/multiplicação de bônus não confirmada (F.2/F.3); soma é hipótese testável', origem: 'F.2/F.3' },
  { campo: 'regen-combate', valor: '1%/1% paz; combate HP 0%/EN 0,5%, 10s', justificativa: 'BARRAGEM §4 prevalece sobre hipótese §14; ver sim.js:2532 + sim-regen.test.js', origem: 'PRODUTO §14 + BARRAGEM §4' },
  { item: 'todas as peças', campo: 'passivas repetidas', valor: 'por peça (tabela D.7)', justificativa: 'mesmo nome não garante mesmo valor; Scholar confirmado por peça, demais adotadas', origem: 'B.3/D.7' },
);

// Soma atributos de itens + passivas contínuas (hipótese aditiva, ver APROX).
// Retorna tudo que tooltip/sিম precisam; sem placeholder.
function calcStats(b) {
  const base = { maxHp: 1200, maxEnergy: 120, hpRegen: 0, enRegen: 0, armor: 0, magicResist: 0, ccr: 0, defensePlayers: 0, defenseMobs: 0, threat: 0, aaSpeedPct: 0, cooldownRate: 0, castReduction: 0, energyCostReduction: 0, dmgBonus: 0, healBonus: 0, ccDuration: 0 };
  const st = { ...base };
  const addStats = (s = {}) => {
    if (s.maxHp) st.maxHp += s.maxHp;
    if (s.maxEnergy) st.maxEnergy += s.maxEnergy;
    if (s.hpRegen) st.hpRegen += s.hpRegen;
    if (s.enRegen) st.enRegen += s.enRegen;
    if (s.armor) st.armor += s.armor;
    if (s.magicResist) st.magicResist += s.magicResist;
    if (s.ccr) st.ccr += s.ccr;
    if (s.defensePlayers) st.defensePlayers += s.defensePlayers;
    if (s.defenseMobs) st.defenseMobs += s.defenseMobs;
    if (s.threat) st.threat += s.threat;
    if (s.aaSpeedPct) st.aaSpeedPct += s.aaSpeedPct;
    if (s.cooldownRate) st.cooldownRate += s.cooldownRate;
    if (s.castReduction) st.castReduction += s.castReduction;
    if (s.dmgBonus) st.dmgBonus += s.dmgBonus;
    if (s.healBonus) st.healBonus += s.healBonus;
    if (s.ccDuration) st.ccDuration += s.ccDuration;
    // regen percentual de jaquetas aplicada sobre o flat acumulado
    if (s.hpRegenPct) st.hpRegen *= 1 + s.hpRegenPct / 100;
    if (s.enRegenPct) st.enRegen *= 1 + s.enRegenPct / 100;
  };
  for (const slot of ['weapon', 'offhand', 'head', 'chest', 'boots', 'cape']) {
    const it = b && ITEMS[b[slot]];
    if (it) addStats(it.stats);
  }
  const passiveVal = { 'balanced-mind': { dmg: 1.5, heal: 1.5, def: 1 }, 'swiftness': { aa: 6 }, 'quick-thinker': { cd: 2.5 } };
  for (const k of ['headPassive', 'chestPassive', 'bootsPassive']) {
    const p = b && b[k];
    if (p && passiveVal[p]) {
      const v = passiveVal[p];
      if (v.dmg) { st.dmgBonus += v.dmg; st.healBonus += v.heal; st.defensePlayers += v.def; st.defenseMobs += v.def; }
      if (v.aa) st.aaSpeedPct += v.aa;
      if (v.cd) st.cooldownRate += v.cd;
    }
  }
  const pieceVal = { // por peça (D.7/B.3)
    'toughness': { 'soldier-helmet': 2.5, 'soldier-armor': 5, 'soldier-boots': 2.5 },
    'authority': { 'soldier-helmet': 5, 'soldier-armor': 10, 'soldier-boots': 5 },
    'tenacity': { 'soldier-helmet': 10, 'soldier-armor': 20, 'soldier-boots': 10 },
    'aggression': { 'scholar-cowl': 3.5, 'scholar-robe': 8, 'scholar-sandals': 3.5 },
    'concentration': { 'scholar-cowl': 5, 'scholar-robe': 10, 'scholar-sandals': 5 },
    'efficiency': { 'scholar-cowl': 6, 'scholar-robe': 12, 'scholar-sandals': 6 },
  };
  const pieceOf = { headPassive: 'head', chestPassive: 'chest', bootsPassive: 'boots' };
  for (const k of Object.keys(pieceOf)) {
    const p = b && b[k];
    const itemId = b && b[pieceOf[k]];
    if (p && pieceVal[p] && itemId && pieceVal[p][itemId] != null) {
      const v = pieceVal[p][itemId];
      if (p === 'toughness') { st.defensePlayers += v; st.defenseMobs += v; }
      if (p === 'authority') st.ccDuration += v;
      if (p === 'tenacity') st.ccr += v;
      if (p === 'aggression') { st.dmgBonus += v; st.healBonus += v; }
      if (p === 'concentration') st.castReduction += v;
      if (p === 'efficiency') st.energyCostReduction += v;
    }
  }
  if (b && b.chestPassive2 === 'protective-instinct') st.threat += 400;
  st.maxHp = Math.round(st.maxHp);
  st.maxEnergy = Math.round(st.maxEnergy * 100) / 100;
  return st;
}

module.exports = { ITEMS, SKILLS, getItem, getSkill, calcStats, APPROX, META: DATA.meta };
