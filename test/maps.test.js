import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadMap } from '../src/map.js';
import { createGame } from '../src/game.js';
import { BASES, DIRS, TERRAIN } from '../src/config.js';
import { offsetToAxial, key } from '../src/geometry.js';

// Cartes livrées : chaque preset du manifeste doit rester jouable.
const mapsDir = fileURLToPath(new URL('../maps/', import.meta.url));
const manifest = JSON.parse(readFileSync(mapsDir + 'index.json', 'utf8'));
const passable = (terrain, k) => terrain.has(k) && TERRAIN[terrain.get(k)].cost !== Infinity;

test('le manifeste liste au moins les cartes à thème', () => {
  const files = manifest.map((m) => m.file);
  for (const f of ['grande-foret', 'debarquement', 'archipel', 'col']) {
    assert.ok(files.includes(f), `carte ${f} absente du manifeste`);
  }
});

for (const { file, name } of manifest) {
  test(`carte « ${name} » : bases reliées, objectifs franchissables, unités sur terre`, () => {
    const data = JSON.parse(readFileSync(`${mapsDir}${file}.json`, 'utf8'));
    const map = loadMap(data);

    assert.ok(map.objectives.length >= 1, `${file} : aucun objectif`);
    for (const k of map.objectives) assert.ok(passable(map.terrain, k), `${file} : objectif ${k} infranchissable`);

    // Les deux bases sont reliées par voie terrestre.
    const a = offsetToAxial(...BASES.blue), b = offsetToAxial(...BASES.red);
    const seen = new Set([key(a.q, a.r)]);
    const stack = [[a.q, a.r]];
    while (stack.length) {
      const [q, r] = stack.pop();
      for (const [dq, dr] of DIRS) {
        const nk = key(q + dq, r + dr);
        if (!seen.has(nk) && passable(map.terrain, nk)) { seen.add(nk); stack.push([q + dq, r + dr]); }
      }
    }
    assert.ok(seen.has(key(b.q, b.r)), `${file} : bases non reliées`);

    // À la création de partie, aucune unité ne reste sur un hex infranchissable.
    const state = createGame(() => 0, undefined, undefined, map);
    for (const u of state.units) {
      assert.ok(passable(state.terrain, key(u.q, u.r)), `${file} : ${u.name} sur terrain infranchissable`);
    }
  });
}
