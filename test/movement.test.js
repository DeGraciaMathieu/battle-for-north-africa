import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReachable, moveUnit } from '../src/movement.js';
import { makeState, fillTerrain, makeUnit } from './helpers.js';

test('la portée respecte les points de mouvement', () => {
  const terrain = fillTerrain([[0, 0], [1, 0], [2, 0], [3, 0]]);
  const unit = makeUnit({ q: 0, r: 0, mpLeft: 2 });
  const state = makeState({ terrain, units: [unit] });
  const { reachable } = computeReachable(state, unit);
  assert.ok(reachable.has('1,0'), 'hex à 1 PM atteignable');
  assert.ok(reachable.has('2,0'), 'hex à 2 PM atteignable');
  assert.ok(!reachable.has('3,0'), 'hex à 3 PM hors de portée');
});

test('la mer est infranchissable', () => {
  const terrain = fillTerrain([[0, 0]]);
  terrain.set('1,0', 'sea');
  const unit = makeUnit({ q: 0, r: 0, mpLeft: 5 });
  const state = makeState({ terrain, units: [unit] });
  const { reachable } = computeReachable(state, unit);
  assert.ok(!reachable.has('1,0'));
});

test('entrer en ZOC ennemie est terminal', () => {
  const terrain = fillTerrain([[0, 0], [1, 0], [2, 0], [3, 0]]);
  const unit = makeUnit({ id: 0, side: 'axis', q: 0, r: 0, mpLeft: 5 });
  const enemy = makeUnit({ id: 1, side: 'ally', q: 2, r: 0 });
  const state = makeState({ terrain, units: [unit, enemy] });
  const { reachable, dist, eZOC } = computeReachable(state, unit);
  assert.ok(reachable.has('1,0'), 'hex ZOC atteignable (terminal)');
  assert.ok(!reachable.has('3,0'), 'ne dépasse pas la ZOC');
  moveUnit(unit, '1,0', dist, eZOC);
  assert.equal(unit.mpLeft, 0, 'arrivée en ZOC consomme tous les PM');
});
