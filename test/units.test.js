import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eAtk, eDef, eMov } from '../src/units.js';
import { makeUnit } from './helpers.js';

test('hors ravitaillement, défense et mouvement effectifs sont divisés par deux', () => {
  const u = makeUnit({ def: 7, mov: 12, supplied: false });
  assert.equal(eDef(u), 4, 'ceil(7 ÷ 2)');
  assert.equal(eMov(u), 6, 'floor(12 ÷ 2)');
  u.supplied = true;
  assert.equal(eDef(u), 7);
  assert.equal(eMov(u), 12);
});

test('la face réduite (verso) bascule les facteurs sur ratk/rdef', () => {
  const u = makeUnit({ atk: 8, def: 7, ratk: 5, rdef: 4, reduced: true, supplied: true });
  assert.equal(eAtk(u), 5);
  assert.equal(eDef(u), 4);
  u.reduced = false;
  assert.equal(eAtk(u), 8);
  assert.equal(eDef(u), 7);
});
