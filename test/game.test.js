import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TURNS } from '../src/config.js';
import { createGame, endPhase, checkElimination, checkTurnEnd } from '../src/game.js';

test('la séquence IGO-UGO enchaîne les phases', () => {
  const state = createGame(() => 0);
  assert.deepEqual([state.G.player, state.G.phase], ['axis', 'move']);
  endPhase(state);
  assert.deepEqual([state.G.player, state.G.phase], ['axis', 'combat']);
  endPhase(state);
  assert.deepEqual([state.G.player, state.G.phase], ['ally', 'move']);
  endPhase(state);
  assert.deepEqual([state.G.player, state.G.phase], ['ally', 'combat']);
  endPhase(state);
  assert.deepEqual([state.G.player, state.G.phase, state.G.turn], ['axis', 'move', 2]);
});

test('l\'anéantissement d\'un camp termine la partie', () => {
  const state = createGame(() => 0);
  let over = null;
  state.bus.on('gameOver', (e) => { over = e; });
  state.units = state.units.filter((u) => u.side === 'axis'); // plus aucun Allié
  checkElimination(state);
  assert.ok(state.G.over);
  assert.equal(over.side, 'axis');
});

test('au dernier tour, le camp avec le plus d\'objectifs l\'emporte', () => {
  const state = createGame(() => 0);
  let over = null;
  state.bus.on('gameOver', (e) => { over = e; });
  state.objControl.set(state.objectives[0], 'axis');
  state.objControl.set(state.objectives[1], 'axis');
  state.G.turn = MAX_TURNS + 1;
  checkTurnEnd(state);
  assert.ok(state.G.over);
  assert.equal(over.side, 'axis');
  assert.match(over.reason, /Fin du tour/);
});
