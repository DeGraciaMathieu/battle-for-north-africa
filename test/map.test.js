import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, BIOMES } from '../src/map.js';
import { createGame } from '../src/game.js';
import { BASES, DIRS, TERRAIN } from '../src/config.js';
import { offsetToAxial, key, hexDistance } from '../src/geometry.js';

const SEEDS = [0, 1, 7, 42, 2024, 999999];
const serialize = (m) => JSON.stringify([...m.entries()].sort());

test('une même seed produit exactement la même carte', () => {
  assert.equal(serialize(generateMap(12345).terrain), serialize(generateMap(12345).terrain));
});

test('le biome par défaut est « tempéré » ; un biome inconnu y retombe', () => {
  assert.ok(BIOMES.tempere, 'le registre expose le biome tempéré');
  const base = serialize(generateMap(777).terrain);
  assert.equal(serialize(generateMap(777, { biome: 'tempere' }).terrain), base, 'défaut = tempéré');
  assert.equal(serialize(generateMap(777, { biome: 'inconnu' }).terrain), base, 'biome inconnu → repli tempéré');
});

test('chaque biome du registre est jouable (déterministe, bases reliées, objectifs)', () => {
  const passable = (terrain, k) => terrain.has(k) && TERRAIN[terrain.get(k)].cost !== Infinity;
  for (const [id, def] of Object.entries(BIOMES)) {
    assert.equal(typeof def.gen, 'function', `biome ${id} : générateur manquant`);
    assert.equal(typeof def.name, 'string', `biome ${id} : nom manquant`);
    for (const seed of SEEDS) {
      const opts = { biome: id };
      assert.equal(serialize(generateMap(seed, opts).terrain), serialize(generateMap(seed, opts).terrain), `${id}/${seed} : non déterministe`);
      const { terrain, objectives } = generateMap(seed, opts);
      assert.ok(objectives.length >= 3, `${id}/${seed} : ${objectives.length} objectifs`);
      const a = offsetToAxial(...BASES.blue), b = offsetToAxial(...BASES.red);
      const seen = new Set([key(a.q, a.r)]);
      const stack = [[a.q, a.r]];
      while (stack.length) {
        const [q, r] = stack.pop();
        for (const [dq, dr] of DIRS) { const nk = key(q + dq, r + dr); if (!seen.has(nk) && passable(terrain, nk)) { seen.add(nk); stack.push([q + dq, r + dr]); } }
      }
      assert.ok(seen.has(key(b.q, b.r)), `${id}/${seed} : bases non reliées`);
    }
  }
});

test('des seeds différentes produisent des cartes différentes', () => {
  assert.notEqual(serialize(generateMap(1).terrain), serialize(generateMap(2).terrain));
});

test('quelle que soit la seed : au moins 4 objectifs et les deux bases sont reliées', () => {
  const passable = (terrain, k) => terrain.has(k) && TERRAIN[terrain.get(k)].cost !== Infinity;
  for (const seed of SEEDS) {
    const { terrain, objectives } = generateMap(seed);
    assert.ok(objectives.length >= 3, `seed ${seed} : ${objectives.length} objectifs`);

    const a = offsetToAxial(...BASES.blue), b = offsetToAxial(...BASES.red);
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

test('quelle que soit la seed : aucun dépôt n\'est entouré d\'eau', () => {
  const WATER = new Set(['river', 'bank']);
  for (const seed of SEEDS) {
    const { terrain } = generateMap(seed);
    for (const [k, t] of terrain) {
      if (t !== 'depot' && t !== 'dump') continue;
      const [q, r] = k.split(',').map(Number);
      const dry = DIRS.some(([dq, dr]) => {
        const nt = terrain.get(key(q + dq, r + dr));
        return nt && !WATER.has(nt);           // voisin terre / route / dépôt
      });
      assert.ok(dry, `seed ${seed} : dépôt ${k} entouré d'eau`);
    }
  }
});

test('quelle que soit la seed : deux grands dépôts ne sont jamais adjacents', () => {
  for (const seed of SEEDS) {
    const { terrain } = generateMap(seed);
    for (const [k, t] of terrain) {
      if (t !== 'depot') continue;
      const [q, r] = k.split(',').map(Number);
      const collee = DIRS.some(([dq, dr]) => terrain.get(key(q + dq, r + dr)) === 'depot');
      assert.ok(!collee, `seed ${seed} : grand dépôt ${k} collé à un autre`);
    }
  }
});

test('en mode équitable : les dépôts sont espacés d\'au moins 3 hexes', () => {
  for (const seed of SEEDS) {
    const { terrain } = generateMap(seed, { fair: true });
    const depots = [...terrain.entries()]
      .filter(([, t]) => t === 'depot' || t === 'dump')
      .map(([k]) => k.split(',').map(Number));
    assert.ok(depots.length > 0, `seed ${seed} : aucun dépôt équitable`);
    for (let i = 0; i < depots.length; i++) {
      for (let j = i + 1; j < depots.length; j++) {
        const [aq, ar] = depots[i], [bq, br] = depots[j];
        assert.ok(hexDistance(aq, ar, bq, br) >= 3, `seed ${seed} : dépôts ${i}/${j} trop proches`);
      }
    }
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
