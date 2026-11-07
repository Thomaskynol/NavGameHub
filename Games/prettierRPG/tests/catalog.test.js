const { test } = require('node:test');
const assert = require('node:assert/strict');

const catalog = require('../lib/catalog');
const build = require('../lib/build');

const { ITEMS, SKILLS, getItem, getSkill, calcStats, APPROX } = catalog;

function baseBuild() { return structuredClone(build.DEFAULT_BUILD); }
function withOpt(b, patch) { return { ...b, ...patch }; }

// ---- interface p/ outras lanes ----
test('interface exportada (catalog + build)', () => {
  for (const k of ['ITEMS', 'SKILLS', 'getItem', 'getSkill', 'calcStats', 'APPROX']) {
    assert.ok(catalog[k] !== undefined, `catalog sem ${k}`);
    assert.ok(build[k] !== undefined, `build sem ${k}`);
  }
  assert.equal(typeof build.validateBuild, 'function');
  assert.ok(build.DEFAULT_BUILD);
});

test('catálogo: 23 itens, skills completas sem placeholder', () => {
  assert.equal(Object.keys(ITEMS).length, 23);
  const ids = Object.keys(SKILLS);
  assert.ok(ids.length >= 90, `skills insuficientes: ${ids.length}`);
  let checked = 0;
  for (const sk of Object.values(SKILLS)) {
    for (const f of ['id', 'name', 'slot', 'target', 'effect', 'formula', 'source', 'confidence']) {
      assert.ok(sk[f] !== undefined && sk[f] !== null && String(sk[f]).length > 0, `${sk.id}: campo ${f} vazio`);
    }
    for (const f of ['range', 'cost', 'cd']) {
      assert.ok(typeof sk[f] === 'number' && Number.isFinite(sk[f]), `${sk.id}: ${f} deve ser número finito`);
    }
    for (const f of ['effect', 'formula', 'name']) {
      assert.ok(!/\bNaN\b|\bTODO\b|\bFIXME\b|\bXXX\b|placeholder|botão sem efeito/i.test(String(sk[f])), `${sk.id}: placeholder em ${f}`);
    }
    checked++;
  }
  console.log(`skills verificadas: ${checked}`);
});

test('DEFAULT_BUILD válido; maxHp/maxEnergy derivados', () => {
  const r = build.validateBuild(baseBuild());
  assert.equal(r.ok, true);
  const st = calcStats(baseBuild());
  // 1200+95+269+539+269=2372 HP; 120+98+49+29+20=316 EN
  assert.equal(st.maxHp, 2372);
  assert.equal(st.maxEnergy, 316);
  assert.equal(build.maxHpFor(), 2372);
  assert.equal(build.maxEnergyFor(), 316);
});

test('rejeita slot inexistente, ausente e combos inválidos', () => {
  let b = baseBuild(); b.q = 'golpe-inexistente';
  assert.equal(build.validateBuild(b).ok, false);
  b = baseBuild(); b.espada = 1;
  assert.match(build.validateBuild(b).error, /inexistente/);
  b = baseBuild(); b.weapon = 'espada-laser';
  assert.equal(build.validateBuild(b).ok, false);
  b = baseBuild(); b.q = 'fire-bolt'; // Q de outra arma
  assert.equal(build.validateBuild(b).ok, false);
  b = baseBuild(); b.headActive = 'frost-shield'; // ativa de outro item
  assert.equal(build.validateBuild(b).ok, false);
  b = baseBuild(); delete b.cape;
  assert.equal(build.validateBuild(b).ok, false);
  // Soldier Armor exige 2ª passiva; outra peça a proíbe
  b = baseBuild(); b.chest = 'soldier-armor'; b.chestActive = 'fury';
  b.chestPassive = 'toughness'; delete b.chestPassive2;
  assert.equal(build.validateBuild(b).ok, false);
  b.chestPassive2 = 'spirit-crush';
  assert.equal(build.validateBuild(b).ok, true);
  b = baseBuild(); b.chestPassive2 = 'spirit-crush'; // merc não tem 2º slot
  assert.equal(build.validateBuild(b).ok, false);
});

// ---- matriz completa: cada opção selecionável validada + calculada ----
const WEAPON_MATRIX = {
  'battleaxe': { q: ['rending-strike', 'rending-spin', 'rending-rage'], w: ['deadly-chop', 'adrenaline-boost', 'battle-rush', 'internal-bleeding', 'raging-blades'], e: ['blood-bandit'], p: ['deep-cuts', 'life-leech', 'increased-defense', 'aggressive-rush'] },
  'dagger': { q: ['sunder-armor', 'deadly-swipe', 'assassin-spirit'], w: ['throwing-blades', 'dash', 'forbidden-stab', 'shadow-edge', 'chain-slash'], e: ['bloodthirsty-blade'], p: ['deep-cuts', 'life-leech', 'auto-attack-speed', 'aggressive-rush'] },
  'fire-staff': { q: ['fire-bolt', 'burning-field', 'searing-flame'], w: ['flame-blast', 'wall-of-flames', 'raging-flare', 'fire-wave', 'fire-artillery'], e: ['pyroblast'], p: ['burn', 'energetic', 'aggressive-caster', 'furious'] },
  'frost-staff': { q: ['frostbite', 'ice-shard', 'frozen-surge'], w: ['frost-bomb', 'frost-beam', 'frost-nova', 'frost-lance', 'glacial-obelisk'], e: ['freezing-wind'], p: ['frost', 'energetic', 'aggressive-caster', 'furious'] },
  'holy-staff': { q: ['generous-heal', 'smite', 'holy-flash'], w: ['sacred-pulse', 'holy-beam', 'holy-blessing', 'holy-orb', 'reawaken'], e: ['desperate-prayer'], p: ['adrenaline-driven-charity', 'energetic', 'magic-force', 'ascended'] },
};
const ARMOR_MATRIX = [
  ['head', 'mercenary-hood', 'headActive', ['energizing-shield', 'cleanse', 'howl'], 'headPassive', ['balanced-mind', 'swiftness', 'quick-thinker']],
  ['head', 'soldier-helmet', 'headActive', ['energizing-shield', 'stone-skin', 'block'], 'headPassive', ['toughness', 'authority', 'tenacity']],
  ['head', 'scholar-cowl', 'headActive', ['energizing-shield', 'force-field', 'aegis-of-energy'], 'headPassive', ['aggression', 'concentration', 'efficiency']],
  ['chest', 'mercenary-jacket', 'chestActive', ['mend-wounds', 'inferno-shield', 'bloodlust'], 'chestPassive', ['balanced-mind', 'swiftness', 'quick-thinker']],
  ['chest', 'soldier-armor', 'chestActive', ['mend-wounds', 'taunt', 'fury'], 'chestPassive', ['toughness', 'authority', 'tenacity']],
  ['chest', 'scholar-robe', 'chestActive', ['mend-wounds', 'frost-shield', 'speed-caster'], 'chestPassive', ['aggression', 'concentration', 'efficiency']],
  ['boots', 'mercenary-shoes', 'bootsActive', ['dodge', 'refreshing-sprint', 'break-free'], 'bootsPassive', ['courier', 'balanced-mind', 'swiftness', 'quick-thinker']],
  ['boots', 'soldier-boots', 'bootsActive', ['dodge', 'rejuvenating-sprint', 'wanderlust'], 'bootsPassive', ['courier', 'toughness', 'authority', 'tenacity']],
  ['boots', 'scholar-sandals', 'bootsActive', ['dodge', 'energetic-sprint', 'focused-run'], 'bootsPassive', ['courier', 'aggression', 'concentration', 'efficiency']],
];
const CAPES = ['cape-bridgewatch', 'cape-fort-sterling', 'cape-lymhurst', 'cape-martlock', 'cape-thetford', 'cape-caerleon'];
const SOLDIER_P2 = ['spirit-crush', 'protective-instinct'];

test('todas as opções de arma (65 seleções) validam + calculam', () => {
  let n = 0;
  for (const [w, m] of Object.entries(WEAPON_MATRIX)) {
    for (const slot of ['q', 'w', 'e']) {
      for (const opt of m[slot]) {
        const b = withOpt(baseBuild(), { weapon: w, q: WEAPON_MATRIX[w].q[0], w: WEAPON_MATRIX[w].w[0], e: WEAPON_MATRIX[w].e[0], weaponPassive: WEAPON_MATRIX[w].p[0], [slot]: opt });
        assert.equal(build.validateBuild(b).ok, true, `${w}.${slot}=${opt}`);
        const sk = getSkill(opt);
        assert.ok(sk && sk.items.includes(w));
        const st = calcStats(b);
        assert.ok(st.maxHp > 1200 && st.maxEnergy > 120);
        n++;
      }
    }
    for (const opt of m.p) {
      const b = withOpt(baseBuild(), { weapon: w, q: m.q[0], w: m.w[0], e: m.e[0], weaponPassive: opt });
      assert.equal(build.validateBuild(b).ok, true, `${w}.passive=${opt}`);
      assert.ok(getSkill(opt));
      calcStats(b);
      n++;
    }
  }
  assert.equal(n, 65);
  console.log(`opções de arma cobertas: ${n}`);
});

test('todas as peças de armadura (59 seleções) validam + calculam', () => {
  let n = 0;
  for (const [itemSlot, itemId, actSlot, acts, pasSlot, pass] of ARMOR_MATRIX) {
    for (const opt of acts) {
      const b = withOpt(baseBuild(), { [itemSlot]: itemId, [actSlot]: opt, [pasSlot]: pass[0] });
      if (itemId === 'soldier-armor') b.chestPassive2 = 'spirit-crush';
      assert.equal(build.validateBuild(b).ok, true, `${itemId}.${actSlot}=${opt}`);
      calcStats(b);
      n++;
    }
    for (const opt of pass) {
      const b = withOpt(baseBuild(), { [itemSlot]: itemId, [actSlot]: acts[0], [pasSlot]: opt });
      if (itemId === 'soldier-armor') b.chestPassive2 = 'spirit-crush';
      assert.equal(build.validateBuild(b).ok, true, `${itemId}.${pasSlot}=${opt}`);
      const st = calcStats(b);
      assert.ok(Number.isFinite(st.maxHp));
      n++;
    }
  }
  for (const opt of SOLDIER_P2) {
    const b = withOpt(baseBuild(), { chest: 'soldier-armor', chestActive: 'mend-wounds', chestPassive: 'toughness', chestPassive2: opt });
    assert.equal(build.validateBuild(b).ok, true, `soldier-armor.p2=${opt}`);
    n++;
  }
  assert.equal(n, 59);
  console.log(`opções de armadura cobertas: ${n}`);
});

test('6 capas validam; Caerleon reseta Q com CD 60s (hipótese)', () => {
  let n = 0;
  for (const cape of CAPES) {
    const b = withOpt(baseBuild(), { cape });
    assert.equal(build.validateBuild(b).ok, true, cape);
    const st = calcStats(b);
    // valor real: base 120 +98+49+29+20 = 316; capa não muda HP, só EN
    assert.equal(st.maxEnergy, 316, `${cape}: EN 316 (120+98+49+29+20)`);
    assert.equal(st.maxHp, 2372, `${cape}: HP 2372 preservado`);
    n++;
  }
  const cae = getSkill('caerleon-reset');
  assert.ok(cae && cae.cd === 60 && /1º slot/.test(cae.effect));
  assert.equal(n, 6);
  console.log(`capas cobertas: ${n}`);
});

test('stats vêm dos itens T8 IP1100 (valores reais, não só >base)', () => {
  // merc default: 1200+95+269+539+269=2372 HP (prova soma, não só >1200)
  const st = calcStats(baseBuild());
  assert.equal(st.maxHp, 2372);
  assert.equal(st.maxEnergy, 316);
  // soldier-armor troca jaqueta: armor 236, MR 193, CCR 156 (D.7/B confirmado)
  const sol = withOpt(baseBuild(), { chest: 'soldier-armor', chestActive: 'fury', chestPassive: 'toughness', chestPassive2: 'spirit-crush' });
  const ss = calcStats(sol);
  assert.equal(ss.armor, 236, 'soldier armor 236');
  assert.equal(ss.magicResist, 193, 'soldier MR 193');
  // scholar-robe: dano/cura +40% (D.6/B confirmado por peça)
  const sch = withOpt(baseBuild(), { chest: 'scholar-robe', chestActive: 'frost-shield', chestPassive: 'aggression' });
  const sc = calcStats(sch);
  assert.ok(sc.dmgBonus >= 40 && sc.healBonus >= 40, `scholar robe +40% (achou ${sc.dmgBonus}/${sc.healBonus})`);
});

test('bloodlust: cura por dano direto com limite (não flat por AA)', () => {
  const bl = getSkill('bloodlust');
  assert.ok(bl, 'catálogo tem bloodlust');
  assert.equal(bl.cost, 0, 'custo 0');
  assert.equal(bl.cd, 30, 'CD 30');
  assert.equal(bl.duration, 6, 'duração 6s');
  // semântica correta: cura escala com dano direto, com limite — sem flat +50/+30 por AA
  assert.match(bl.effect, /dano direto/i, 'efeito menciona dano direto');
  assert.match(bl.effect, /limite|cap/i, 'efeito menciona limite');
  assert.doesNotMatch(bl.effect, /\+50 físico/, 'sem +50 flat (genericização removida)');
  assert.match(bl.formula, /30%/, 'fórmula tem 30%');
  assert.match(bl.formula, /cap/i, 'fórmula tem cap');
  assert.ok(bl.approx && /30%.*120.*600|hipótese/i.test(bl.approx), 'APROX explícita com %/limite');
  assert.match(bl.source, /D\.7/, 'origem D.7');
});

test('force-field: custo 0 (dado D.6, não 15)', () => {
  const ff = getSkill('force-field');
  assert.ok(ff, 'catálogo tem force-field');
  assert.equal(ff.cost, 0, 'custo 0 por D.6 Scholar Cowl (era 15 por leitura de D.7)');
  assert.equal(ff.cd, 30, 'CD 30');
  assert.equal(ff.radius, 6, 'raio 6m');
  assert.match(ff.effect, /177/, 'dano 177');
  assert.match(ff.effect, /9m/, 'knockback 9m');
  assert.ok(!ff.approx, 'sem APROX de custo (custo é dado D.6, não hipótese)');
});

test('courier inerte com tooltip; threat soma no PvE', () => {
  const c = getSkill('courier');
  assert.match(c.effect, /SEM EFEITO/);
  const b = withOpt(baseBuild(), { chest: 'soldier-armor', chestActive: 'fury', chestPassive: 'toughness', chestPassive2: 'protective-instinct' });
  assert.equal(build.validateBuild(b).ok, true);
  assert.ok(calcStats(b).threat >= 400);
});

test('APROX registra origem de cada hipótese', () => {
  assert.ok(APPROX.length >= 30, `APROX insuficiente: ${APPROX.length}`);
  for (const a of APPROX) {
    assert.ok(a.valor !== undefined && a.justificativa && a.origem, `APROX incompleto: ${JSON.stringify(a)}`);
  }
  console.log(`APROX registradas: ${APPROX.length}`);
});
