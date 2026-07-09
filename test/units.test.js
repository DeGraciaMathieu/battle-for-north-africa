import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eAtk, eDef, eMov, reorderStack, unitsAt } from '../src/units.js';
import { makeUnit } from './helpers.js';

test('hors ravitaillement, défense et mouvement effectifs sont divisés par deux', () => {
  const u = makeUnit({ def: 7, mov: 12, supplied: false });
  assert.equal(eDef(u), 4, 'ceil(7 ÷ 2)');
  assert.equal(eMov(u), 6, 'floor(12 ÷ 2)');
  u.supplied = true;
  assert.equal(eDef(u), 7);
  assert.equal(eMov(u), 12);
});

test('la face réduite (verso) bascule les facteurs sur ratk/rdef/rmov', () => {
  const u = makeUnit({ atk: 8, def: 7, mov: 6, ratk: 5, rdef: 4, rmov: 5, reduced: true, supplied: true });
  assert.deepEqual([eAtk(u), eDef(u), eMov(u)], [5, 4, 5], 'verso : facteurs réduits');
  u.reduced = false;
  assert.deepEqual([eAtk(u), eDef(u), eMov(u)], [8, 7, 6], 'recto : facteurs pleine force');
});

test("réordonner une pile détermine l'unité du dessus sans déplacer les autres unités", () => {
  const units = [
    makeUnit({ id: 1, q: 2, r: 2 }),
    makeUnit({ id: 4, q: 5, r: 5, side: 'red' }),
    makeUnit({ id: 2, q: 2, r: 2 }),
    makeUnit({ id: 3, q: 2, r: 2 }),
  ];
  assert.equal(reorderStack(units, [3, 1, 2]), true);
  assert.deepEqual(unitsAt(units, 2, 2).map((u) => u.id), [3, 1, 2], 'nouvel ordre bas → haut');
  assert.equal(unitsAt(units, 2, 2).at(-1).id, 2, 'la dernière unité listée est le dessus');
  assert.equal(units[1].id, 4, "l'unité hors pile garde sa position dans le tableau");
});

test('réordonnancement refusé : id inconnu, hexes différents ou pile incomplète', () => {
  const units = [
    makeUnit({ id: 1, q: 2, r: 2 }),
    makeUnit({ id: 2, q: 2, r: 2 }),
    makeUnit({ id: 3, q: 4, r: 4 }),
  ];
  assert.equal(reorderStack(units, [1, 99]), false, 'id inconnu');
  assert.equal(reorderStack(units, [1, 3]), false, 'unités sur des hexes différents');
  assert.equal(reorderStack(units, [1, 1]), false, 'id dupliqué');
  units.push(makeUnit({ id: 5, q: 2, r: 2 }));
  assert.equal(reorderStack(units, [2, 1]), false, 'la pile entière doit être listée');
  assert.deepEqual(units.map((u) => u.id), [1, 2, 3, 5], 'ordre intact après chaque refus');
});
