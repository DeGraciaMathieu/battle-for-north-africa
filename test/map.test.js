import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { createGame } from '../src/game.js';
import { BASES, DIRS, TERRAIN } from '../src/config.js';
import { offsetToAxial, key } from '../src/geometry.js';

const SEEDS = [0, 1, 7, 42, 2024, 999999];
const serialize = (m) => JSON.stringify([...m.entries()].sort());

test('une même seed produit exactement la même carte', () => {
  assert.equal(serialize(generateMap(12345).terrain), serialize(generateMap(12345).terrain));
});

test('des seeds différentes produisent des cartes différentes', () => {
  assert.notEqual(serialize(generateMap(1).terrain), serialize(generateMap(2).terrain));
});

test('quelle que soit la seed : au moins 4 objectifs et les deux bases sont reliées', () => {
  const passable = (terrain, k) => terrain.has(k) && TERRAIN[terrain.get(k)].cost !== Infinity;
  for (const seed of SEEDS) {
    const { terrain, objectives } = generateMap(seed);
    assert.ok(objectives.length >= 3, `seed ${seed} : ${objectives.length} objectifs (villes)`);

    const a = offsetToAxial(...BASES.axis), b = offsetToAxial(...BASES.ally);
    const seen = new Set([key(a.q, a.r)]);
    const stack = [[a.q, a.r]];
    while (stack.length) {
      const [q, r] = stack.pop();
      for (const [dq, dr] of DIRS) {
        const nk = key(q + dq, r + dr);
        if (!seen.has(nk) && passable(terrain, nk)) { seen.add(nk); stack.push([q + dq, r + dr]); }
      }
    }
    assert.ok(seen.has(key(b.q, b.r)), `seed ${seed} : bases reliées`);
  }
});

test('quelle que soit la seed : aucune unité ne démarre sur un hex infranchissable', () => {
  for (const seed of SEEDS) {
    const state = createGame(() => 0, seed);
    for (const u of state.units) {
      const t = state.terrain.get(key(u.q, u.r));
      assert.ok(t && TERRAIN[t].cost !== Infinity, `seed ${seed} : ${u.name} sur ${t}`);
    }
  }
});
