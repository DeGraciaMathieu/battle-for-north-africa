import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateSupply } from '../src/supply.js';
import { makeState, fillTerrain, makeUnit } from './helpers.js';

test('une ZOC ennemie coupe la ligne de ravitaillement', () => {
  // Corridor de désert ; source = objectif (0,0) tenu par l'Axe.
  const terrain = fillTerrain([[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [2, 1]]);
  terrain.set('0,0', 'town');
  const objectives = ['0,0'];

  const a = makeUnit({ id: 0, side: 'axis', q: 2, r: 0 }); // ravitaillé depuis (0,0)
  const b = makeUnit({ id: 1, side: 'axis', q: 3, r: 1 }); // dans la ZOC ennemie
  const enemy = makeUnit({ id: 2, side: 'ally', q: 4, r: 0 }); // ZOC couvre (3,0) et (3,1)
  const state = makeState({ terrain, units: [a, b, enemy], objectives });
  state.objControl.set('0,0', 'axis');

  updateSupply(state);
  assert.ok(a.supplied, 'unité reliée à la source est ravitaillée');
  assert.ok(!b.supplied, 'unité coupée par la ZOC est hors ravitaillement');
});
