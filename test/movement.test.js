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
  terrain.set('1,0', 'river');
  const unit = makeUnit({ q: 0, r: 0, mpLeft: 5 });
  const state = makeState({ terrain, units: [unit] });
  const { reachable } = computeReachable(state, unit);
  assert.ok(!reachable.has('1,0'));
});

test('entrer en ZOC ennemie est terminal', () => {
  const terrain = fillTerrain([[0, 0], [1, 0], [2, 0], [3, 0]]);
  const unit = makeUnit({ id: 0, side: 'blue', q: 0, r: 0, mpLeft: 5 });
  const enemy = makeUnit({ id: 1, side: 'red', q: 2, r: 0 });
  const state = makeState({ terrain, units: [unit, enemy] });
  const { reachable, dist, eZOC } = computeReachable(state, unit);
  assert.ok(reachable.has('1,0'), 'hex ZOC atteignable (terminal)');
  assert.ok(!reachable.has('3,0'), 'ne dépasse pas la ZOC');
  moveUnit(unit, '1,0', dist, eZOC);
  assert.equal(unit.mpLeft, 0, 'arrivée en ZOC consomme tous les PM');
});

test('un empilement plein bloque l\'entrée', () => {
  const terrain = fillTerrain([[0, 0], [1, 0]]);
  const mover = makeUnit({ id: 0, side: 'blue', q: 0, r: 0, mpLeft: 5 });
  const stack = [1, 2, 3].map((id) => makeUnit({ id, side: 'blue', q: 1, r: 0 })); // STACK_MAX atteint
  const state = makeState({ terrain, units: [mover, ...stack] });
  const { reachable } = computeReachable(state, mover);
  assert.ok(!reachable.has('1,0'), 'hex saturé inaccessible');
});

test('le coût du terrain est respecté (coteau = 3 PM)', () => {
  const terrain = fillTerrain([[0, 0], [2, 0]]);
  terrain.set('1,0', 'hill'); // coût 3
  const unit = makeUnit({ q: 0, r: 0, mpLeft: 3 });
  const state = makeState({ terrain, units: [unit] });
  const { reachable } = computeReachable(state, unit);
  assert.ok(reachable.has('1,0'), 'coteau atteignable à 3 PM');
  assert.ok(!reachable.has('2,0'), 'hex au-delà (3 + 1) hors de portée');
});

test('le coût du terrain est respecté (montagne = 4 PM)', () => {
  const terrain = fillTerrain([[0, 0], [2, 0]]);
  terrain.set('1,0', 'mountain'); // coût 4
  const unit = makeUnit({ q: 0, r: 0, mpLeft: 4 });
  const state = makeState({ terrain, units: [unit] });
  const { reachable } = computeReachable(state, unit);
  assert.ok(reachable.has('1,0'), 'montagne atteignable à 4 PM');
  assert.ok(!reachable.has('2,0'), 'hex au-delà (4 + 1) hors de portée');
});

test('la route est plus rapide (½ PM) : 2 hexes pour 1 PM', () => {
  const terrain = fillTerrain([[3, 0]]);           // hex lointain en plaine (coût 1)
  for (const c of [0, 1, 2]) terrain.set(`${c},0`, 'road'); // corridor de routes
  const unit = makeUnit({ q: 0, r: 0, mpLeft: 1 });
  const state = makeState({ terrain, units: [unit] });
  const { reachable } = computeReachable(state, unit);
  assert.ok(reachable.has('1,0'), 'route à ½ PM atteignable');
  assert.ok(reachable.has('2,0'), 'deux routes (1 PM) atteignables');
  assert.ok(!reachable.has('3,0'), 'plaine au-delà (1.5 PM) hors de portée');
});
