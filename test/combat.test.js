import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oddsIndex, resolveCombat, combatPlan } from '../src/combat.js';
import { hexDistance } from '../src/geometry.js';
import { makeState, fillTerrain, makeUnit } from './helpers.js';

test('oddsIndex mappe le rapport de force sur une colonne', () => {
  assert.equal(oddsIndex(1, 3), 0); // 1:3
  assert.equal(oddsIndex(6, 3), 3); // 2:1
  assert.equal(oddsIndex(6, 2), 4); // 3:1
  assert.equal(oddsIndex(6, 0), 7); // défense nulle → colonne max
});

test('combatPlan expose la colonne sans lancer le dé ni muter l\'état', () => {
  const terrain = fillTerrain([[0, 0], [0, 1], [1, 0]]);
  const armor = makeUnit({ id: 0, side: 'blue', type: 'armor', q: 0, r: 0, atk: 4 });
  const inf = makeUnit({ id: 1, side: 'blue', type: 'inf', q: 0, r: 1, atk: 2 });
  const defender = makeUnit({ id: 2, side: 'red', type: 'inf', q: 1, r: 0, def: 3 });
  const state = makeState({ terrain, units: [armor, inf, defender] });
  const plan = combatPlan(state, [armor, inf], defender);
  assert.equal(plan.baseCol, '2:1');           // 6 contre 3
  assert.equal(plan.col, '3:1');               // armes combinées +1
  assert.ok(!defender.reduced && !armor.reduced, 'aucune mutation');
});

test('un « Échange » réduit défenseur et attaquant', () => {
  const terrain = fillTerrain([[0, 0], [1, 0]]);
  const attacker = makeUnit({ id: 0, side: 'blue', type: 'armor', q: 0, r: 0, atk: 6 });
  const defender = makeUnit({ id: 1, side: 'red', type: 'inf', q: 1, r: 0, def: 2, rdef: 1 });
  const state = makeState({ terrain, units: [attacker, defender], rng: () => 0 }); // dé 1
  const { col, res } = resolveCombat(state, [attacker], defender);
  assert.equal(col, '3:1');
  assert.equal(res, 'EX');
  assert.ok(defender.reduced, 'défenseur réduit');
  assert.ok(attacker.reduced, 'attaquant réduit');
});

test('les armes combinées décalent la colonne de +1', () => {
  const terrain = fillTerrain([[0, 0], [0, 1], [1, 0]]);
  const armor = makeUnit({ id: 0, side: 'blue', type: 'armor', q: 0, r: 0, atk: 4 });
  const inf = makeUnit({ id: 1, side: 'blue', type: 'inf', q: 0, r: 1, atk: 2 });
  const defender = makeUnit({ id: 2, side: 'red', type: 'inf', q: 1, r: 0, def: 3 });
  const state = makeState({ terrain, units: [armor, inf, defender], rng: () => 0 });
  // atk total 6 vs def 3 → base « 2:1 » ; combiné +1 → « 3:1 ».
  const { col } = resolveCombat(state, [armor, inf], defender);
  assert.equal(col, '3:1');
});

test('« Défenseur éliminé » retire le pion et fait avancer l\'attaquant', () => {
  const terrain = fillTerrain([[0, 0], [1, 0]]);
  const attacker = makeUnit({ id: 0, side: 'blue', type: 'armor', q: 0, r: 0, atk: 8 });
  const defender = makeUnit({ id: 1, side: 'red', type: 'inf', q: 1, r: 0, reduced: true, rdef: 1 });
  const state = makeState({ terrain, units: [attacker, defender], rng: () => 0 });
  let removed = null;
  state.bus.on('unitRemoved', (u) => { removed = u; });
  const { res } = resolveCombat(state, [attacker], defender);
  assert.equal(res, 'DE');
  assert.equal(removed, defender, 'événement unitRemoved émis pour le défenseur');
  assert.ok(!state.units.includes(defender), 'défenseur retiré de l\'état');
  assert.deepEqual([attacker.q, attacker.r], [1, 0], 'attaquant avance sur l\'hex libéré');
});

test('le résumé de combat narre les conséquences', () => {
  const terrain = fillTerrain([[0, 0], [1, 0]]);
  const attacker = makeUnit({ id: 0, side: 'blue', type: 'armor', q: 0, r: 0, atk: 8 });
  const defender = makeUnit({ id: 1, side: 'red', type: 'inf', q: 1, r: 0, reduced: true, rdef: 1 });
  const state = makeState({ terrain, units: [attacker, defender], rng: () => 0 });
  let summary = null;
  state.bus.on('combatResolved', (p) => { summary = p; });
  resolveCombat(state, [attacker], defender);
  assert.ok(Array.isArray(summary.effects) && summary.effects.length, 'effets présents');
  assert.match(summary.effects.join(' '), /éliminé/, 'défenseur réduit → éliminé narré');
  assert.match(summary.effects.join(' '), /avance/, 'avance après combat narrée');
});

test('un « Défenseur repoussé » (DR) éloigne le défenseur de l\'attaquant', () => {
  const terrain = fillTerrain([[0, 0], [1, 0], [2, 0], [2, -1], [1, 1], [0, 1], [1, -1]]);
  const attacker = makeUnit({ id: 0, side: 'blue', q: 0, r: 0, atk: 6 });
  const defender = makeUnit({ id: 1, side: 'red', type: 'inf', q: 1, r: 0, def: 6 });
  const state = makeState({ terrain, units: [attacker, defender], rng: () => 0.5 }); // dé 4 → « 1:1 » = DR
  const { res } = resolveCombat(state, [attacker], defender);
  assert.equal(res, 'DR');
  assert.ok(state.units.includes(defender), 'défenseur survit');
  assert.ok(hexDistance(defender.q, defender.r, 0, 0) > 1, 'défenseur recule plus loin');
});

test('sans case de recul possible, le défenseur repoussé est éliminé', () => {
  const terrain = fillTerrain([[0, 0], [1, 0]]); // aucun hex de repli autour du défenseur
  const attacker = makeUnit({ id: 0, side: 'blue', q: 0, r: 0, atk: 6 });
  const defender = makeUnit({ id: 1, side: 'red', type: 'inf', q: 1, r: 0, def: 6 });
  const state = makeState({ terrain, units: [attacker, defender], rng: () => 0.5 }); // DR
  let removed = null;
  state.bus.on('unitRemoved', (u) => { removed = u; });
  resolveCombat(state, [attacker], defender);
  assert.equal(removed, defender);
  assert.ok(!state.units.includes(defender));
});

test('l\'appui d\'artillerie à portée décale la colonne de +1', () => {
  const terrain = fillTerrain([[0, 0], [0, 1], [1, 0]]);
  const attacker = makeUnit({ id: 0, side: 'blue', type: 'armor', q: 0, r: 0, atk: 4 });
  const arty = makeUnit({ id: 1, side: 'blue', type: 'arty', q: 0, r: 1, atk: 2 });
  const defender = makeUnit({ id: 2, side: 'red', type: 'inf', q: 1, r: 0, def: 3 });
  const state = makeState({ terrain, units: [attacker, arty, defender], rng: () => 0 });
  // atk 4 vs def 3 → base « 1:1 » ; artillerie +1 → « 2:1 ».
  const { col } = resolveCombat(state, [attacker], defender);
  assert.equal(col, '2:1');
});

test('le terrain défensif retire une colonne à l\'attaquant', () => {
  const terrain = fillTerrain([[0, 0]]);
  terrain.set('1,0', 'hill'); // rocaille : def +2
  const attacker = makeUnit({ id: 0, side: 'blue', q: 0, r: 0, atk: 6 });
  const defender = makeUnit({ id: 1, side: 'red', type: 'inf', q: 1, r: 0, def: 3 });
  const state = makeState({ terrain, units: [attacker, defender], rng: () => 0 });
  // atk 6 vs def 3 → base « 2:1 » ; terrain −2 → « 1:2 ».
  const { col } = resolveCombat(state, [attacker], defender);
  assert.equal(col, '1:2');
});

test('une route expose le défenseur : +1 colonne pour l\'attaquant (malus)', () => {
  const colOnTerrain = (t) => {
    const terrain = fillTerrain([[0, 0]]);
    terrain.set('1,0', t);
    const attacker = makeUnit({ id: 0, side: 'blue', q: 0, r: 0, atk: 6 });
    const defender = makeUnit({ id: 1, side: 'red', type: 'inf', q: 1, r: 0, def: 3 });
    const state = makeState({ terrain, units: [attacker, defender] });
    return combatPlan(state, [attacker], defender).col; // atk 6 vs def 3 → base « 2:1 »
  };
  assert.equal(colOnTerrain('plain'), '2:1', 'plaine : pas de décalage');
  assert.equal(colOnTerrain('road'), '3:1', 'route : +1 colonne en faveur de l\'attaquant (def −1)');
  assert.equal(colOnTerrain('hill'), '1:2', 'coteau : −2 colonnes (protection défensive)');
});

test('hors ravitaillement, la défense réduite fait monter les odds', () => {
  const terrain = fillTerrain([[0, 0], [1, 0]]);
  const attacker = makeUnit({ id: 0, side: 'blue', q: 0, r: 0, atk: 6 });
  const defender = makeUnit({ id: 1, side: 'red', type: 'inf', q: 1, r: 0, def: 4, supplied: false });
  const state = makeState({ terrain, units: [attacker, defender], rng: () => 0 });
  // eDef = ceil(4 ÷ 2) = 2 → atk 6 vs def 2 → « 3:1 » (au lieu de « 1:1 » si ravitaillé).
  const { col } = resolveCombat(state, [attacker], defender);
  assert.equal(col, '3:1');
});

test('un résultat AE réduit l\'attaquant', () => {
  // atk 2 vs def 6 → colonne « 1:3 » ; dé 1 → AE (attaquant éliminé/réduit).
  const terrain = fillTerrain([[0, 0], [1, 0]]);
  const attacker = makeUnit({ id: 0, side: 'blue', q: 0, r: 0, atk: 2 });
  const defender = makeUnit({ id: 1, side: 'red', q: 1, r: 0, def: 6 });
  const state = makeState({ terrain, units: [attacker, defender], rng: () => 0 });
  const { res } = resolveCombat(state, [attacker], defender);
  assert.equal(res, 'AE');
  assert.ok(attacker.reduced && state.units.includes(attacker), 'attaquant pleine force → réduit');
  assert.ok(!defender.reduced, 'défenseur intact');
});

test('un résultat AR repousse l\'attaquant', () => {
  // même rapport « 1:3 » ; dé 3 → AR (attaquant repoussé d\'un hexe).
  const terrain = fillTerrain([[-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0]]);
  const attacker = makeUnit({ id: 0, side: 'blue', q: 0, r: 0, atk: 2 });
  const defender = makeUnit({ id: 1, side: 'red', q: 1, r: 0, def: 6 });
  const state = makeState({ terrain, units: [attacker, defender], rng: () => 0.4 });
  const { res } = resolveCombat(state, [attacker], defender);
  assert.equal(res, 'AR');
  assert.ok(state.units.includes(attacker), 'attaquant survit');
  assert.ok(attacker.q !== 0 || attacker.r !== 0, 'attaquant a reculé d\'un hexe');
});

test('un défenseur cerné de ZOC ennemie ne peut reculer et est éliminé sur DR', () => {
  // Seule case de repli = (-1,0), mais elle est sous ZOC du bloqueur blue (-2,0).
  const terrain = fillTerrain([[-2, 0], [-1, 0], [0, 0], [1, 0]]);
  const attacker = makeUnit({ id: 0, side: 'blue', q: 1, r: 0, atk: 6 });
  const defender = makeUnit({ id: 1, side: 'red', q: 0, r: 0, def: 6 });
  const blocker = makeUnit({ id: 2, side: 'blue', q: -2, r: 0 }); // sa ZOC couvre (-1,0)
  const state = makeState({ terrain, units: [attacker, defender, blocker], rng: () => 0.5 });
  const { res } = resolveCombat(state, [attacker], defender); // « 1:1 », dé 4 → DR
  assert.equal(res, 'DR');
  assert.ok(!state.units.includes(defender), 'sans repli hors ZOC, le défenseur est éliminé');
});

test('une artillerie hors ravitaillement n\'appuie pas', () => {
  const terrain = fillTerrain([[0, 0], [1, 0], [2, 0]]);
  const attacker = makeUnit({ id: 0, side: 'blue', q: 0, r: 0 });
  const defender = makeUnit({ id: 1, side: 'red', q: 1, r: 0 });
  const arty = makeUnit({ id: 2, side: 'blue', type: 'arty', q: 2, r: 0, supplied: false });
  const state = makeState({ terrain, units: [attacker, defender, arty] });
  assert.equal(combatPlan(state, [attacker], defender).arty, 0, 'hors ravito → pas d\'appui');
  arty.supplied = true;
  assert.equal(combatPlan(state, [attacker], defender).arty, 1, 'ravitaillée → +1 colonne');
});
