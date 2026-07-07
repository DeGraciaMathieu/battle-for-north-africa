import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateSupply, supplyRoutes, supplySources } from '../src/supply.js';
import { createGame, updateObjectives } from '../src/game.js';
import { TERRAIN, BASES } from '../src/config.js';
import { offsetToAxial, hexDistance } from '../src/geometry.js';
import { makeState, fillTerrain, makeUnit } from './helpers.js';

test('au-delà de la portée d\'une ville (6), une unité est coupée du ravitaillement', () => {
  const R = TERRAIN.town.supply;                                  // portée d'une ville = 6
  const coords = [];
  for (let q = 0; q <= R + 1; q++) coords.push([q, 0]);          // corridor rectiligne
  const terrain = fillTerrain(coords);
  terrain.set('0,0', 'town');
  const near = makeUnit({ id: 0, side: 'blue', q: R, r: 0 });     // route = portée max
  const far = makeUnit({ id: 1, side: 'blue', q: R + 1, r: 0 });  // un hex au-delà
  const state = makeState({ terrain, units: [near, far] });
  state.objControl.set('0,0', 'blue');
  updateSupply(state);
  assert.ok(near.supplied, 'à portée = ravitaillée');
  assert.ok(!far.supplied, 'au-delà de la portée = coupée');

  // La portée restante décroît avec la distance à la source.
  const { reach } = supplyRoutes(state, 'blue');
  assert.equal(reach.get('0,0'), R, 'source à portée pleine');
  assert.equal(reach.get(`${R},0`), 0, 'hex le plus loin à portée restante nulle');
});

test('une oasis tenue ravitaille comme un relais (portée 4)', () => {
  const coords = [];
  for (let q = 0; q <= 6; q++) coords.push([q, 0]);
  const terrain = fillTerrain(coords);
  terrain.set('0,0', 'oasis');
  const state = makeState({ terrain, units: [] });
  state.objControl.set('0,0', 'blue');                  // oasis tenue par Bleu
  assert.ok(supplySources(state, 'blue').has('0,0'), 'oasis tenue = source de ravitaillement');
  const supplied = supplyRoutes(state, 'blue').supplied;
  assert.ok(supplied.has('4,0'), 'oasis : ravitaille jusqu\'à 4 hexes');
  assert.ok(!supplied.has('5,0'), 'oasis : ne dépasse pas 4 hexes');
});

test('une ville (6) ravitaille plus loin qu\'un village (4)', () => {
  const coords = [];
  for (let q = 0; q <= 6; q++) coords.push([q, 0]);
  const build = (type) => {
    const terrain = fillTerrain(coords);
    terrain.set('0,0', type);
    const state = makeState({ terrain, units: [] });
    state.objControl.set('0,0', 'blue');
    return supplyRoutes(state, 'blue').supplied;
  };
  const ville = build('town');
  const village = build('village');
  assert.ok(ville.has('6,0'), 'ville : ravitaille jusqu\'à 6 hexes');
  assert.ok(!village.has('5,0'), 'village : ne dépasse pas 4 hexes');
  assert.ok(village.has('4,0'), 'village : ravitaille jusqu\'à 4 hexes');
});

test('occuper une ville ennemie en prend le contrôle et l\'ajoute aux sources', () => {
  const terrain = fillTerrain([[0, 0], [1, 0]]);
  terrain.set('0,0', 'town');
  const state = makeState({ terrain, units: [], objectives: ['0,0'] });
  state.objControl.set('0,0', 'red');                    // ville tenue par Rouge
  assert.ok(!supplySources(state, 'blue').has('0,0'), 'pas encore une source pour Bleu');

  state.units.push(makeUnit({ id: 0, side: 'blue', q: 0, r: 0 })); // Bleu occupe la ville
  updateObjectives(state);
  assert.equal(state.objControl.get('0,0'), 'blue', 'contrôle basculé à Bleu');
  assert.ok(supplySources(state, 'blue').has('0,0'), 'la ville devient source de ravito pour Bleu');
});

test('au départ, chaque unité déploie à ≤3 hexes de sa base et est ravitaillée', () => {
  const state = createGame(() => 0);
  for (const u of state.units) {
    const b = offsetToAxial(...BASES[u.side]);
    assert.ok(hexDistance(b.q, b.r, u.q, u.r) <= 3, `${u.name} à ≤3 hexes de la base`);
    assert.ok(u.supplied, `${u.name} ravitaillée au départ`);
  }
});

test('le ravitaillement part du camp de base', () => {
  const state = createGame(() => 0);
  // Le camp de base de chaque camp est bien une source de ravitaillement.
  for (const side of ['blue', 'red']) {
    const src = [...supplySources(state, side)];
    assert.ok(src.some((k) => state.terrain.get(k) === 'base'), `source 'base' présente pour ${side}`);
  }
});

test('la mer bloque la propagation du ravitaillement', () => {
  const terrain = fillTerrain([[0, 0], [2, 0]]);
  terrain.set('0,0', 'town');
  terrain.set('1,0', 'river'); // coupe la seule route entre la source et l'unité
  const unit = makeUnit({ id: 0, side: 'blue', q: 2, r: 0 });
  const state = makeState({ terrain, units: [unit], objectives: ['0,0'] });
  state.objControl.set('0,0', 'blue');
  updateSupply(state);
  assert.ok(!unit.supplied);
});

test('une ZOC ennemie sur le chemin coupe la ligne de ravitaillement', () => {
  // Corridor (0,0)→(3,0) ; l'ennemi en (2,1) met (2,0) sous ZOC et casse la route.
  const terrain = fillTerrain([[0, 0], [1, 0], [2, 0], [3, 0]]);
  terrain.set('0,0', 'town');
  const objectives = ['0,0'];

  const a = makeUnit({ id: 0, side: 'blue', q: 1, r: 0 }); // ravitaillé depuis (0,0)
  const b = makeUnit({ id: 1, side: 'blue', q: 3, r: 0 }); // coupé : seul accès (2,0) sous ZOC
  const enemy = makeUnit({ id: 2, side: 'red', q: 2, r: 1 }); // ZOC couvre (2,0) et (3,0)
  const state = makeState({ terrain, units: [a, b, enemy], objectives });
  state.objControl.set('0,0', 'blue');

  updateSupply(state);
  assert.ok(a.supplied, 'unité reliée à la source est ravitaillée');
  assert.ok(!b.supplied, 'unité dont la seule route passe par une ZOC est coupée');

  // La route de l'unité ravitaillée remonte jusqu'à une source.
  const { supplied, parent } = supplyRoutes(state, 'blue');
  const chain = [];
  for (let k = '1,0'; k; k = parent.get(k)) chain.push(k);
  assert.ok(supplySources(state, 'blue').has(chain[chain.length - 1]), 'la route se termine sur une source');
  assert.ok(!supplied.has('3,0'), 'unité coupée absente des routes');
});

test('deux unités au corps à corps restent ravitaillées via leur arrière', () => {
  // Régression : chacune est dans la ZOC de l'autre, mais garde sa ligne arrière.
  const terrain = fillTerrain([[0, 0], [1, 0], [2, 0]]);
  terrain.set('0,0', 'town');
  const mine = makeUnit({ id: 0, side: 'blue', q: 2, r: 0 });  // au contact de l'ennemi
  const enemy = makeUnit({ id: 1, side: 'red', q: 2, r: 1 }); // adjacent → ZOC sur (2,0)
  const state = makeState({ terrain, units: [mine, enemy], objectives: ['0,0'] });
  state.objControl.set('0,0', 'blue');
  updateSupply(state);
  assert.ok(mine.supplied, 'l\'unité au contact reste ravitaillée par l\'arrière');
});
