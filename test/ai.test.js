// ===========================================================================
//  IA adverse — tests macro (comportement, pas détails d'implémentation).
//
//  On vérifie les deux facettes voulues : tactique (n'engager que des combats
//  favorables, chercher le contact) et stratégique (marcher sur les objectifs).
//  Le planificateur est pur : on l'exerce sur des états minimaux, sans rendu.
// ===========================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiMovePhase, aiAttackPhase } from '../src/ai.js';
import { makeState, makeUnit, fillTerrain } from './helpers.js';
import { hexDistance } from '../src/geometry.js';
import { ARTY_RANGE } from '../src/config.js';

const field = () => {
  const coords = [];
  for (let q = -2; q <= 10; q++) for (let r = -2; r <= 10; r++) coords.push([q, r]);
  return fillTerrain(coords);
};

test('tactique : l\'IA engage un combat quand la force est écrasante', () => {
  const units = [
    makeUnit({ id: 1, side: 'axis', type: 'armor', q: 0, r: 0 }),   // atk 8
    makeUnit({ id: 2, side: 'axis', type: 'armor', q: 1, r: 1 }),   // atk 8, adjacents à (1,0)
    makeUnit({ id: 3, side: 'ally', type: 'inf', q: 1, r: 0, atk: 6, def: 6 }),
  ];
  const state = makeState({ terrain: field(), units });
  const attacks = aiAttackPhase(state, 'axis');
  assert.equal(attacks.length, 1, 'un assaut planifié');
  assert.equal(attacks[0].def, 3);
  assert.deepEqual(attacks[0].atk.sort(), [1, 2], 'les deux blindés concentrés');
});

test('tactique : l\'IA renonce à un combat défavorable', () => {
  const units = [
    makeUnit({ id: 1, side: 'axis', type: 'moto', q: 0, r: 0, atk: 4 }), // faible
    makeUnit({ id: 2, side: 'ally', type: 'armor', q: 1, r: 0, def: 7 }), // robuste
  ];
  const state = makeState({ terrain: field(), units });
  assert.deepEqual(aiAttackPhase(state, 'axis'), [], 'aucun assaut suicide');
});

test('stratégie : l\'IA marche vers un objectif non tenu', () => {
  const terrain = field();
  terrain.set('8,0', 'town');                                   // objectif au loin
  const units = [makeUnit({ id: 1, side: 'axis', type: 'armor', q: 0, r: 0 })];
  const state = makeState({ terrain, units, objectives: ['8,0'] }); // non contrôlé → contesté
  const moves = aiMovePhase(state, 'axis');
  assert.equal(moves.length, 1);
  const [q, r] = moves[0].to.split(',').map(Number);
  assert.ok(hexDistance(q, r, 8, 0) < hexDistance(0, 0, 8, 0), 'se rapproche de l\'objectif');
});

test('tactique : l\'IA se porte au contact d\'un ennemi proche', () => {
  const units = [
    makeUnit({ id: 1, side: 'axis', type: 'armor', q: 0, r: 0 }),
    makeUnit({ id: 2, side: 'ally', type: 'inf', q: 3, r: 0, atk: 6, def: 6 }),
  ];
  const state = makeState({ terrain: field(), units });
  const moves = aiMovePhase(state, 'axis');
  assert.equal(moves.length, 1);
  const [q, r] = moves[0].to.split(',').map(Number);
  assert.equal(hexDistance(q, r, 3, 0), 1, 'termine au contact de l\'ennemi');
});

test('tactique : l\'artillerie à portée fait basculer un 1:1 en assaut, sans être engagée', () => {
  const base = () => [
    makeUnit({ id: 1, side: 'axis', type: 'inf', q: 0, r: 0, atk: 6 }),      // 6 vs 6 → 1:1 nu
    makeUnit({ id: 2, side: 'ally', type: 'inf', q: 1, r: 0, atk: 6, def: 6 }),
  ];
  const sansArt = makeState({ terrain: field(), units: base() });
  assert.deepEqual(aiAttackPhase(sansArt, 'axis'), [], 'à 1:1 nu, pas d\'assaut');

  const avecArt = makeState({ terrain: field(), units: [...base(), makeUnit({ id: 3, side: 'axis', type: 'arty', q: 4, r: 0 })] });
  const attacks = aiAttackPhase(avecArt, 'axis');
  assert.equal(attacks.length, 1, 'l\'appui rend l\'assaut favorable');
  assert.deepEqual(attacks[0].atk, [1], 'l\'artillerie appuie mais n\'est pas dans le corps à corps');
});

test('stratégie : une cible sur objectif est attaquée dès 1:1, pas à découvert', () => {
  const units = () => [
    makeUnit({ id: 1, side: 'axis', type: 'armor', q: 0, r: 0, atk: 8 }),    // 8 vs 6 → 1:1
    makeUnit({ id: 2, side: 'ally', type: 'inf', q: 1, r: 0, atk: 6, def: 6 }),
  ];
  const decouvert = makeState({ terrain: field(), units: units() });
  assert.deepEqual(aiAttackPhase(decouvert, 'axis'), [], 'à découvert, 1:1 refusé');

  const surObjectif = makeState({ terrain: field(), units: units(), objectives: ['1,0'] });
  const attacks = aiAttackPhase(surObjectif, 'axis');
  assert.equal(attacks.length, 1, 'enjeu d\'objectif : on engage à 1:1');
  assert.equal(attacks[0].def, 2);
});

test('tactique : un attaquant n\'est pas réaffecté à une seconde cible', () => {
  const units = [
    makeUnit({ id: 1, side: 'axis', type: 'armor', q: 0, r: 0, atk: 8 }),   // attaquant unique
    makeUnit({ id: 2, side: 'ally', type: 'inf', q: 1, r: 0, def: 4 }),     // 8/4 → 2:1, adjacent
    makeUnit({ id: 3, side: 'ally', type: 'inf', q: 0, r: 1, def: 4 }),     // 2:1 aussi, adjacent
  ];
  const state = makeState({ terrain: field(), units });
  const attacks = aiAttackPhase(state, 'axis');
  assert.equal(attacks.length, 1, 'un seul assaut : l\'attaquant unique n\'est pas dédoublé');
  assert.deepEqual(attacks.flatMap((a) => a.atk), [1]);
});

test('tactique : une unité déjà au contact n\'est pas déplacée', () => {
  const units = [
    makeUnit({ id: 1, side: 'axis', type: 'armor', q: 0, r: 0 }),           // au contact de l'ennemi
    makeUnit({ id: 2, side: 'ally', type: 'inf', q: 1, r: 0 }),
    makeUnit({ id: 3, side: 'axis', type: 'armor', q: 6, r: 0 }),           // à distance → doit avancer
  ];
  const state = makeState({ terrain: field(), units });
  const moves = aiMovePhase(state, 'axis');
  assert.ok(!moves.some((m) => m.id === 1), 'le pion au contact reste pour frapper');
  assert.ok(moves.some((m) => m.id === 3), 'les autres avancent');
});

test('tactique : l\'artillerie se poste à portée sans se coller à l\'ennemi', () => {
  const units = [
    makeUnit({ id: 1, side: 'axis', type: 'arty', q: 0, r: 0 }),
    makeUnit({ id: 2, side: 'ally', type: 'inf', q: 4, r: 0, def: 6 }),
  ];
  const state = makeState({ terrain: field(), units });
  const m = aiMovePhase(state, 'axis').find((x) => x.id === 1);
  assert.ok(m, 'l\'artillerie se déplace vers le front');
  const [q, r] = m.to.split(',').map(Number);
  const d = hexDistance(q, r, 4, 0);
  assert.ok(d >= 2, 'elle ne finit pas au contact');
  assert.ok(d <= ARTY_RANGE, 'mais reste à portée d\'appui');
});
