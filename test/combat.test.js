import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oddsIndex, resolveCombat } from '../src/combat.js';
import { makeState, fillTerrain, makeUnit } from './helpers.js';

test('oddsIndex mappe le rapport de force sur une colonne', () => {
  assert.equal(oddsIndex(1, 3), 0); // 1:3
  assert.equal(oddsIndex(6, 3), 3); // 2:1
  assert.equal(oddsIndex(6, 2), 4); // 3:1
  assert.equal(oddsIndex(6, 0), 7); // défense nulle → colonne max
});

test('un « Échange » réduit défenseur et attaquant', () => {
  const terrain = fillTerrain([[0, 0], [1, 0]]);
  const attacker = makeUnit({ id: 0, side: 'axis', type: 'armor', q: 0, r: 0, atk: 6 });
  const defender = makeUnit({ id: 1, side: 'ally', type: 'inf', q: 1, r: 0, def: 2, rdef: 1 });
  const state = makeState({ terrain, units: [attacker, defender], rng: () => 0 }); // dé 1
  const { col, res } = resolveCombat(state, [attacker], defender);
  assert.equal(col, '3:1');
  assert.equal(res, 'EX');
  assert.ok(defender.reduced, 'défenseur réduit');
  assert.ok(attacker.reduced, 'attaquant réduit');
});

test('les armes combinées décalent la colonne de +1', () => {
  const terrain = fillTerrain([[0, 0], [0, 1], [1, 0]]);
  const armor = makeUnit({ id: 0, side: 'axis', type: 'armor', q: 0, r: 0, atk: 4 });
  const inf = makeUnit({ id: 1, side: 'axis', type: 'inf', q: 0, r: 1, atk: 2 });
  const defender = makeUnit({ id: 2, side: 'ally', type: 'inf', q: 1, r: 0, def: 3 });
  const state = makeState({ terrain, units: [armor, inf, defender], rng: () => 0 });
  // atk total 6 vs def 3 → base « 2:1 » ; combiné +1 → « 3:1 ».
  const { col } = resolveCombat(state, [armor, inf], defender);
  assert.equal(col, '3:1');
});

test('« Défenseur éliminé » retire le pion et fait avancer l\'attaquant', () => {
  const terrain = fillTerrain([[0, 0], [1, 0]]);
  const attacker = makeUnit({ id: 0, side: 'axis', type: 'armor', q: 0, r: 0, atk: 8 });
  const defender = makeUnit({ id: 1, side: 'ally', type: 'inf', q: 1, r: 0, reduced: true, rdef: 1 });
  const state = makeState({ terrain, units: [attacker, defender], rng: () => 0 });
  let removed = null;
  state.bus.on('unitRemoved', (u) => { removed = u; });
  const { res } = resolveCombat(state, [attacker], defender);
  assert.equal(res, 'DE');
  assert.equal(removed, defender, 'événement unitRemoved émis pour le défenseur');
  assert.ok(!state.units.includes(defender), 'défenseur retiré de l\'état');
  assert.deepEqual([attacker.q, attacker.r], [1, 0], 'attaquant avance sur l\'hex libéré');
});
