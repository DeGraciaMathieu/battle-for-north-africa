import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TURNS } from '../src/config.js';
import { createGame, endPhase, startMove, checkElimination, checkTurnEnd } from '../src/game.js';
import { makeState, fillTerrain, makeUnit } from './helpers.js';

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

test('une composition (point-buy) construit les armées demandées', () => {
  const composition = {
    axis: { armor: 3, arty: 1 },        // 4 pions côté Bleu
    ally: { inf: 5 },                   // 5 pions côté Rouge
  };
  const state = createGame(() => 0, 42, composition);
  const count = (side, type) => state.units.filter((u) => u.side === side && u.type === type).length;
  assert.equal(state.units.filter((u) => u.side === 'axis').length, 4, 'Bleu : 4 pions');
  assert.equal(count('axis', 'armor'), 3, 'Bleu : 3 blindés');
  assert.equal(count('axis', 'arty'), 1, 'Bleu : 1 artillerie');
  assert.equal(state.units.filter((u) => u.side === 'ally').length, 5, 'Rouge : 5 pions');
  assert.equal(count('ally', 'inf'), 5, 'Rouge : 5 infanteries');
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

test('hors ravitaillement, startMove réduit les PM de moitié', () => {
  // Unité isolée sur un hex sans source (ni objectif ami, ni bord de carte).
  const terrain = fillTerrain([[5, 5]]);
  const unit = makeUnit({ id: 0, side: 'axis', q: 5, r: 5, mov: 12 });
  const state = makeState({ terrain, units: [unit], objectives: [] });
  startMove(state, 'axis');
  assert.ok(!unit.supplied, 'unité coupée de toute source');
  assert.equal(unit.mpLeft, 6, 'PM = floor(12 ÷ 2)');
});

test('endPhase est sans effet quand la partie est terminée', () => {
  const state = createGame(() => 0);
  state.G.over = true;
  let fired = false;
  state.bus.on('phaseChanged', () => { fired = true; });
  endPhase(state);
  assert.deepEqual([state.G.player, state.G.phase], ['axis', 'move']);
  assert.ok(!fired, 'aucun événement phaseChanged émis');
});
