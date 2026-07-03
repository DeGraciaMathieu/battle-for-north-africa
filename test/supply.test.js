import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateSupply, supplyRoutes, supplySources } from '../src/supply.js';
import { createGame } from '../src/game.js';
import { SUPPLY_RANGE } from '../src/config.js';
import { makeState, fillTerrain, makeUnit } from './helpers.js';

test('au-delà de la portée, une unité est coupée du ravitaillement', () => {
  const coords = [];
  for (let q = 0; q <= SUPPLY_RANGE + 1; q++) coords.push([q, 0]); // corridor rectiligne
  const terrain = fillTerrain(coords);
  terrain.set('0,0', 'town');
  const near = makeUnit({ id: 0, side: 'axis', q: SUPPLY_RANGE, r: 0 });     // route = portée max
  const far = makeUnit({ id: 1, side: 'axis', q: SUPPLY_RANGE + 1, r: 0 });  // un hex au-delà
  const state = makeState({ terrain, units: [near, far], objectives: ['0,0'] });
  state.objControl.set('0,0', 'axis');
  updateSupply(state);
  assert.ok(near.supplied, 'à portée = ravitaillée');
  assert.ok(!far.supplied, 'au-delà de la portée = coupée');

  // La profondeur croît avec la distance à la source (base du numéro affiché).
  const { depth } = supplyRoutes(state, 'axis');
  assert.equal(depth.get('0,0'), 0, 'source à profondeur 0');
  assert.equal(depth.get(`${SUPPLY_RANGE},0`), SUPPLY_RANGE, 'hex le plus loin à profondeur max');
});

test('au départ, chaque camp est ravitaillé depuis sa base, mais la portée en laisse hors d\'atteinte', () => {
  const state = createGame(() => 0);
  for (const side of ['axis', 'ally']) {
    assert.ok(state.units.some((u) => u.side === side && u.supplied), `${side} : ravitaillé depuis la base`);
  }
  assert.ok(state.units.some((u) => !u.supplied), 'la portée laisse des unités hors ravitaillement');
});

test('le ravitaillement part du camp de base', () => {
  const state = createGame(() => 0);
  // Le camp de base de chaque camp est bien une source de ravitaillement.
  for (const side of ['axis', 'ally']) {
    const src = [...supplySources(state, side)];
    assert.ok(src.some((k) => state.terrain.get(k) === 'base'), `source 'base' présente pour ${side}`);
  }
});

test('la mer bloque la propagation du ravitaillement', () => {
  const terrain = fillTerrain([[0, 0], [2, 0]]);
  terrain.set('0,0', 'town');
  terrain.set('1,0', 'sea'); // coupe la seule route entre la source et l'unité
  const unit = makeUnit({ id: 0, side: 'axis', q: 2, r: 0 });
  const state = makeState({ terrain, units: [unit], objectives: ['0,0'] });
  state.objControl.set('0,0', 'axis');
  updateSupply(state);
  assert.ok(!unit.supplied);
});

test('une ZOC ennemie sur le chemin coupe la ligne de ravitaillement', () => {
  // Corridor (0,0)→(3,0) ; l'ennemi en (2,1) met (2,0) sous ZOC et casse la route.
  const terrain = fillTerrain([[0, 0], [1, 0], [2, 0], [3, 0]]);
  terrain.set('0,0', 'town');
  const objectives = ['0,0'];

  const a = makeUnit({ id: 0, side: 'axis', q: 1, r: 0 }); // ravitaillé depuis (0,0)
  const b = makeUnit({ id: 1, side: 'axis', q: 3, r: 0 }); // coupé : seul accès (2,0) sous ZOC
  const enemy = makeUnit({ id: 2, side: 'ally', q: 2, r: 1 }); // ZOC couvre (2,0) et (3,0)
  const state = makeState({ terrain, units: [a, b, enemy], objectives });
  state.objControl.set('0,0', 'axis');

  updateSupply(state);
  assert.ok(a.supplied, 'unité reliée à la source est ravitaillée');
  assert.ok(!b.supplied, 'unité dont la seule route passe par une ZOC est coupée');

  // La route de l'unité ravitaillée remonte jusqu'à une source.
  const { supplied, parent } = supplyRoutes(state, 'axis');
  const chain = [];
  for (let k = '1,0'; k; k = parent.get(k)) chain.push(k);
  assert.ok(supplySources(state, 'axis').has(chain[chain.length - 1]), 'la route se termine sur une source');
  assert.ok(!supplied.has('3,0'), 'unité coupée absente des routes');
});

test('deux unités au corps à corps restent ravitaillées via leur arrière', () => {
  // Régression : chacune est dans la ZOC de l'autre, mais garde sa ligne arrière.
  const terrain = fillTerrain([[0, 0], [1, 0], [2, 0]]);
  terrain.set('0,0', 'town');
  const mine = makeUnit({ id: 0, side: 'axis', q: 2, r: 0 });  // au contact de l'ennemi
  const enemy = makeUnit({ id: 1, side: 'ally', q: 2, r: 1 }); // adjacent → ZOC sur (2,0)
  const state = makeState({ terrain, units: [mine, enemy], objectives: ['0,0'] });
  state.objControl.set('0,0', 'axis');
  updateSupply(state);
  assert.ok(mine.supplied, 'l\'unité au contact reste ravitaillée par l\'arrière');
});
