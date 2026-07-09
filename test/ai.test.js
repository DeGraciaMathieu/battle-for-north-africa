// ===========================================================================
//  IA adverse — tests macro (comportement, pas détails d'implémentation).
//
//  On vérifie les deux facettes voulues : tactique (n'engager que des combats
//  favorables, chercher le contact) et stratégique (marcher sur les objectifs).
//  Le planificateur est pur : on l'exerce sur des états minimaux, sans rendu.
// ===========================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiMovePhase, aiAttackPhase, aiReorderPhase } from '../src/ai.js';
import { makeState, makeUnit, fillTerrain } from './helpers.js';
import { hexDistance } from '../src/geometry.js';
import { ARTY_RANGE } from '../src/config.js';
import { reorderStack } from '../src/units.js';
import { computeReachable, moveUnit } from '../src/movement.js';
import { updateSupply, suppliedHexes } from '../src/supply.js';

const field = () => {
  const coords = [];
  for (let q = -2; q <= 10; q++) for (let r = -2; r <= 10; r++) coords.push([q, r]);
  return fillTerrain(coords);
};

test('tactique : l\'IA engage un combat quand la force est écrasante', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0 }),   // atk 8
    makeUnit({ id: 2, side: 'blue', type: 'armor', q: 1, r: 1 }),   // atk 8, adjacents à (1,0)
    makeUnit({ id: 3, side: 'red', type: 'inf', q: 1, r: 0, atk: 6, def: 6 }),
  ];
  const state = makeState({ terrain: field(), units });
  const attacks = aiAttackPhase(state, 'blue');
  assert.equal(attacks.length, 1, 'un assaut planifié');
  assert.equal(attacks[0].def, 3);
  assert.deepEqual(attacks[0].atk.sort(), [1, 2], 'les deux blindés concentrés');
});

test('tactique : l\'IA renonce à un combat défavorable', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'arty', q: 0, r: 0, atk: 2 }), // faible
    makeUnit({ id: 2, side: 'red', type: 'armor', q: 1, r: 0, def: 7 }), // robuste
  ];
  const state = makeState({ terrain: field(), units });
  assert.deepEqual(aiAttackPhase(state, 'blue'), [], 'aucun assaut suicide');
});

test('stratégie : l\'IA marche vers un objectif non tenu', () => {
  const terrain = field();
  terrain.set('8,0', 'town');                                   // objectif au loin
  const units = [makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0 })];
  const state = makeState({ terrain, units, objectives: ['8,0'] }); // non contrôlé → contesté
  const moves = aiMovePhase(state, 'blue');
  assert.equal(moves.length, 1);
  const [q, r] = moves[0].to.split(',').map(Number);
  assert.ok(hexDistance(q, r, 8, 0) < hexDistance(0, 0, 8, 0), 'se rapproche de l\'objectif');
});

test('tactique : l\'IA se porte au contact d\'un ennemi proche', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0 }),
    makeUnit({ id: 2, side: 'red', type: 'inf', q: 3, r: 0, atk: 6, def: 6 }),
  ];
  const state = makeState({ terrain: field(), units });
  const moves = aiMovePhase(state, 'blue');
  assert.equal(moves.length, 1);
  const [q, r] = moves[0].to.split(',').map(Number);
  assert.equal(hexDistance(q, r, 3, 0), 1, 'termine au contact de l\'ennemi');
});

test('tactique : l\'artillerie à portée fait basculer un 1:1 en assaut, sans être engagée', () => {
  const base = () => [
    makeUnit({ id: 1, side: 'blue', type: 'inf', q: 0, r: 0, atk: 6 }),      // 6 vs 6 → 1:1 nu
    makeUnit({ id: 2, side: 'red', type: 'inf', q: 1, r: 0, atk: 6, def: 6 }),
  ];
  const sansArt = makeState({ terrain: field(), units: base() });
  assert.deepEqual(aiAttackPhase(sansArt, 'blue'), [], 'à 1:1 nu, pas d\'assaut');

  const avecArt = makeState({ terrain: field(), units: [...base(), makeUnit({ id: 3, side: 'blue', type: 'arty', q: 4, r: 0 })] });
  const attacks = aiAttackPhase(avecArt, 'blue');
  assert.equal(attacks.length, 1, 'l\'appui rend l\'assaut favorable');
  assert.deepEqual(attacks[0].atk, [1], 'l\'artillerie appuie mais n\'est pas dans le corps à corps');
});

test('stratégie : une cible sur objectif est attaquée dès 1:1, pas à découvert', () => {
  const units = () => [
    makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0, atk: 8 }),    // 8 vs 6 → 1:1
    makeUnit({ id: 2, side: 'red', type: 'inf', q: 1, r: 0, atk: 6, def: 6 }),
  ];
  const decouvert = makeState({ terrain: field(), units: units() });
  assert.deepEqual(aiAttackPhase(decouvert, 'blue'), [], 'à découvert, 1:1 refusé');

  const surObjectif = makeState({ terrain: field(), units: units(), objectives: ['1,0'] });
  const attacks = aiAttackPhase(surObjectif, 'blue');
  assert.equal(attacks.length, 1, 'enjeu d\'objectif : on engage à 1:1');
  assert.equal(attacks[0].def, 2);
});

test('tactique : un attaquant n\'est pas réaffecté à une seconde cible', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0, atk: 8 }),   // attaquant unique
    makeUnit({ id: 2, side: 'red', type: 'inf', q: 1, r: 0, def: 4 }),     // 8/4 → 2:1, adjacent
    makeUnit({ id: 3, side: 'red', type: 'inf', q: 0, r: 1, def: 4 }),     // 2:1 aussi, adjacent
  ];
  const state = makeState({ terrain: field(), units });
  const attacks = aiAttackPhase(state, 'blue');
  assert.equal(attacks.length, 1, 'un seul assaut : l\'attaquant unique n\'est pas dédoublé');
  assert.deepEqual(attacks.flatMap((a) => a.atk), [1]);
});

test('tactique : un attaquant au contact d\'une cible battable reste pour frapper', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0, atk: 8 }),   // 2:1 sur la cible : cloué
    makeUnit({ id: 2, side: 'red', type: 'inf', q: 1, r: 0, atk: 4, def: 4, mov: 2, mpLeft: 2 }),
    makeUnit({ id: 3, side: 'blue', type: 'armor', q: 6, r: 0 }),           // à distance → doit avancer
  ];
  const state = makeState({ terrain: field(), units });
  const moves = aiMovePhase(state, 'blue');
  assert.ok(!moves.some((m) => m.id === 1), 'le pion au contact reste pour frapper');
  assert.ok(moves.some((m) => m.id === 3), 'les autres avancent');
});

test('dégel : au contact d\'un ennemi inattaquable, le pion peut décrocher', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'inf', q: 0, r: 0, atk: 3, def: 2 }),                  // faible, collé
    makeUnit({ id: 2, side: 'red', type: 'armor', q: 1, r: 0, atk: 10, def: 8, mov: 4, mpLeft: 0 }), // écrasant
  ];
  const state = makeState({ terrain: field(), units });
  const m = aiMovePhase(state, 'blue').find((x) => x.id === 1);
  assert.ok(m, 'le pion n\'est plus gelé au contact');
  const [q, r] = m.to.split(',').map(Number);
  assert.ok(hexDistance(q, r, 1, 0) > 1, 'il sort du contact suicidaire');
});

test('tactique : l\'artillerie se poste à portée sans se coller à l\'ennemi', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'arty', q: 0, r: 0 }),
    makeUnit({ id: 2, side: 'red', type: 'inf', q: 4, r: 0, def: 6 }),
  ];
  const state = makeState({ terrain: field(), units });
  const m = aiMovePhase(state, 'blue').find((x) => x.id === 1);
  assert.ok(m, 'l\'artillerie se déplace vers le front');
  const [q, r] = m.to.split(',').map(Number);
  const d = hexDistance(q, r, 4, 0);
  assert.ok(d >= 2, 'elle ne finit pas au contact');
  assert.ok(d <= ARTY_RANGE, 'mais reste à portée d\'appui');
});

test('retenue : l\'IA n\'engage qu\'avec la force minimale et garde une réserve', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0, atk: 8 }),      // 8 vs 4 → 2:1 à lui seul
    makeUnit({ id: 2, side: 'blue', type: 'armor', q: 2, r: 0, atk: 8 }),      // second au contact, superflu
    makeUnit({ id: 3, side: 'red', type: 'inf', q: 1, r: 0, atk: 4, def: 4 }),
  ];
  const state = makeState({ terrain: field(), units });
  const attacks = aiAttackPhase(state, 'blue');
  assert.equal(attacks.length, 1, 'un seul assaut');
  assert.equal(attacks[0].atk.length, 1, 'un seul attaquant suffit : l\'autre reste en réserve');
});

test('anticipation : l\'IA n\'avance pas une unité isolée sur une case suicide', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'inf', q: 0, r: 0, atk: 3, def: 3, mov: 10, mpLeft: 10 }), // faible, mobile
    makeUnit({ id: 2, side: 'red', type: 'armor', q: 5, r: 0, atk: 10, def: 8, mov: 2, mpLeft: 2 }), // écrasant, lent
  ];
  const state = makeState({ terrain: field(), units });
  const m = aiMovePhase(state, 'blue').find((x) => x.id === 1);
  if (m) {
    const [q, r] = m.to.split(',').map(Number);
    assert.ok(hexDistance(q, r, 5, 0) > 1, 'ne se jette pas au contact d\'un ennemi bien plus fort');
  }
});

test('pathfinding : l\'IA contourne une rivière vers la passe au lieu de bloquer sur la berge', () => {
  const coords = [];
  for (let q = -1; q <= 9; q++) for (let r = -4; r <= 4; r++) coords.push([q, r]);
  const terrain = fillTerrain(coords, 'plain');
  for (let r = -4; r <= 3; r++) terrain.set(`3,${r}`, 'river');   // mur de rivière, passe en (3,4)
  const units = [makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0, mov: 4, mpLeft: 4 })];
  const state = makeState({ terrain, units, objectives: ['6,0'] }); // objectif de l'autre côté
  const m = aiMovePhase(state, 'blue').find((x) => x.id === 1);
  assert.ok(m, 'l\'unité se déplace');
  const [q, r] = m.to.split(',').map(Number);
  assert.ok(r > 0, 'elle progresse vers la passe (3,4), pas tout droit contre la berge');
  assert.ok(!(q === 2 && r === 0), 'elle ne reste pas collée à la berge la plus proche du but');
});

test('ravitaillement : l\'IA prend un objectif à portée sans sortir du ravitaillement', () => {
  const coords = [];
  for (let q = -1; q <= 12; q++) for (let r = -3; r <= 3; r++) coords.push([q, r]);
  const terrain = fillTerrain(coords, 'plain');
  terrain.set('0,0', 'town');                                    // source de ravito (portée 6)
  const units = [makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0, mov: 10, mpLeft: 10 })];
  const state = makeState({ terrain, units, objectives: ['5,0'] }); // objectif dans la portée
  state.objControl.set('0,0', 'blue');                          // ville tenue → source active
  updateSupply(state);
  const supplied = suppliedHexes(state, 'blue');
  const m = aiMovePhase(state, 'blue').find((x) => x.id === 1);
  assert.ok(m && supplied.has(m.to), 'elle atteint son but tout en restant ravitaillée');
});

test('anticipation : la menace est comptée à PM pleins, même si l\'ennemi a déjà joué', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'inf', q: 0, r: 0, atk: 3, def: 2, mov: 10, mpLeft: 10 }),
    makeUnit({ id: 2, side: 'red', type: 'armor', q: 5, r: 0, atk: 10, def: 8, mov: 4, mpLeft: 0 }), // PM épuisés
  ];
  const state = makeState({ terrain: field(), units });
  const m = aiMovePhase(state, 'blue').find((x) => x.id === 1);
  assert.ok(m, 'l\'unité réagit à la menace');
  const [q, r] = m.to.split(',').map(Number);
  assert.ok(hexDistance(q, r, 5, 0) > 5, 'elle sort de la portée de frappe anticipée (PM pleins, pas PM restants)');
});

test('équité : seule l\'unité au sommet d\'une pile ennemie est ciblée', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0, atk: 8 }),
    makeUnit({ id: 2, side: 'blue', type: 'armor', q: 1, r: 1, atk: 8 }),
    makeUnit({ id: 3, side: 'red', type: 'arty', q: 1, r: 0, atk: 2, def: 3 }), // cible facile… mais enfouie
    makeUnit({ id: 4, side: 'red', type: 'inf', q: 1, r: 0, atk: 6, def: 6 }),  // sommet de la pile
  ];
  const state = makeState({ terrain: field(), units });
  const attacks = aiAttackPhase(state, 'blue');
  assert.ok(attacks.length >= 1, 'la pile est assaillie');
  assert.ok(attacks.every((a) => a.def === 4), 'la cible est le sommet, jamais l\'unité enfouie');
});

test('piles : l\'IA présente son meilleur défenseur au sommet', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'armor', q: 2, r: 2, def: 7 }),        // solide, pourtant dessous
    makeUnit({ id: 2, side: 'blue', type: 'arty', q: 2, r: 2, atk: 2, def: 3 }), // fragile au sommet
    makeUnit({ id: 3, side: 'blue', type: 'inf', q: 5, r: 5 }),                  // pile de 1 : rien à faire
  ];
  const state = makeState({ terrain: field(), units });
  const orders = aiReorderPhase(state, 'blue');
  assert.equal(orders.length, 1, 'une seule pile à réordonner');
  assert.deepEqual(orders[0].ids, [2, 1], 'bas → haut : l\'artillerie dessous, le blindé dessus');
  assert.ok(reorderStack(state.units, orders[0].ids), 'l\'intention est rejouable telle quelle');
});

test('score : menée au dernier tour, l\'IA force un 1:1 qu\'elle refusait', () => {
  const units = () => [
    makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0, atk: 8 }),
    makeUnit({ id: 2, side: 'red', type: 'inf', q: 1, r: 0, atk: 6, def: 6 }),   // 8 vs 6 → 1:1
  ];
  const behind = makeState({ terrain: field(), units: units(), objectives: ['8,8'] });
  behind.objControl.set('8,8', 'red');                          // 2 points de retard
  behind.G.turn = 10;                                           // dernier tour : sprint
  assert.equal(aiAttackPhase(behind, 'blue').length, 1, 'menée en fin de partie, elle tente le 1:1');

  const even = makeState({ terrain: field(), units: units(), objectives: ['8,8'] });
  even.G.turn = 10;
  assert.deepEqual(aiAttackPhase(even, 'blue'), [], 'à égalité, le 1:1 à découvert reste refusé');
});

test('garnison : posté sur un objectif menacé, le pion tient sa position', () => {
  const terrain = field();
  terrain.set('0,0', 'town');
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'inf', q: 0, r: 0 }),
    makeUnit({ id: 2, side: 'red', type: 'armor', q: 6, r: 0 }),                 // peut fondre sur la ville
  ];
  const state = makeState({ terrain, units, objectives: ['0,0'] });
  state.objControl.set('0,0', 'blue');
  const moves = aiMovePhase(state, 'blue');
  assert.ok(!moves.some((m) => m.id === 1), 'la garnison ne déserte pas la ville menacée');
});

test('garnison : un objectif tenu, vide et menacé rappelle une unité en garde', () => {
  const terrain = field();
  terrain.set('0,0', 'town');
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'inf', q: 4, r: 0 }),                  // à mi-chemin ville/ennemi
    makeUnit({ id: 2, side: 'red', type: 'armor', q: 8, r: 0 }),
  ];
  const state = makeState({ terrain, units, objectives: ['0,0'] });
  state.objControl.set('0,0', 'blue');
  const m = aiMovePhase(state, 'blue').find((x) => x.id === 1);
  assert.ok(m, 'l\'unité bouge');
  const [q, r] = m.to.split(',').map(Number);
  assert.ok(hexDistance(q, r, 0, 0) < 4, 'elle rentre couvrir la ville au lieu d\'avancer sur l\'ennemi');
});

test('armes combinées : blindé + à pied préféré à deux blindés pour la colonne', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0, atk: 8 }),
    makeUnit({ id: 2, side: 'blue', type: 'armor', q: 1, r: 1, atk: 8 }),
    makeUnit({ id: 3, side: 'blue', type: 'inf', q: 2, r: -1, atk: 6 }),
    makeUnit({ id: 4, side: 'red', type: 'inf', q: 1, r: 0, atk: 6, def: 7 }),
  ];
  const state = makeState({ terrain: field(), units });
  const attacks = aiAttackPhase(state, 'blue');
  assert.equal(attacks.length, 1);
  const group = attacks[0].atk.sort();
  assert.equal(group.length, 2, 'deux unités suffisent grâce au bonus de colonne');
  assert.ok(group.includes(3), 'l\'assaut mêle blindé et infanterie (armes combinées +1)');
});

test('encerclement : à odds égaux, la cible sans repli est engagée en premier', () => {
  const terrain = field();
  for (const k of ['9,1', '9,0', '7,1', '7,2', '8,2']) terrain.set(k, 'river'); // cul-de-sac autour de (8,1)
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0, atk: 8 }),
    makeUnit({ id: 2, side: 'red', type: 'inf', q: 1, r: 0, atk: 6, def: 4 }),  // même cible, repli libre
    makeUnit({ id: 3, side: 'blue', type: 'armor', q: 8, r: 0, atk: 8 }),
    makeUnit({ id: 4, side: 'red', type: 'inf', q: 8, r: 1, atk: 6, def: 4 }),  // dos à la rivière : piégée
  ];
  const state = makeState({ terrain, units });
  const attacks = aiAttackPhase(state, 'blue');
  assert.equal(attacks.length, 2, 'les deux cibles sont engagées');
  assert.equal(attacks[0].def, 4, 'la cible encerclée (recul = mort) passe en premier');
});

test('assaut monté : deux unités convergent pour créer le 2:1 au même tour', () => {
  const units = [
    makeUnit({ id: 1, side: 'blue', type: 'armor', q: 2, r: 0, atk: 8, mov: 4, mpLeft: 4 }),
    makeUnit({ id: 2, side: 'blue', type: 'armor', q: 2, r: 2, atk: 8, mov: 4, mpLeft: 4 }),
    makeUnit({ id: 3, side: 'red', type: 'inf', q: 5, r: 0, atk: 6, def: 7, mov: 0, mpLeft: 0 }), // 1:1 pour un seul
  ];
  const state = makeState({ terrain: field(), units });
  for (const mv of aiMovePhase(state, 'blue')) {              // rejoue comme le pilote
    const u = state.units.find((x) => x.id === mv.id);
    const { dist, eZOC } = computeReachable(state, u);
    if (dist[mv.to]) moveUnit(u, mv.to, dist, eZOC);
  }
  const attacks = aiAttackPhase(state, 'blue');
  assert.equal(attacks.length, 1, 'l\'assaut est lancé dès ce tour');
  assert.equal(attacks[0].atk.length, 2, 'les deux blindés convergent et frappent ensemble');
});

test('hystérésis : le but du tour précédent est conservé à distance quasi égale', () => {
  const terrain = field();
  terrain.set('8,0', 'town');
  terrain.set('0,8', 'town');
  const units = [makeUnit({ id: 1, side: 'blue', type: 'armor', q: 0, r: 0, mov: 3, mpLeft: 3 })];
  const state = makeState({ terrain, units, objectives: ['8,0', '0,8'] }); // deux buts à égale distance
  state.aiMemo = { blue: { goals: new Map([[1, '0,8']]), lastPos: new Map() } };
  const m = aiMovePhase(state, 'blue').find((x) => x.id === 1);
  assert.ok(m);
  const [q, r] = m.to.split(',').map(Number);
  assert.ok(hexDistance(q, r, 0, 8) < hexDistance(q, r, 8, 0), 'elle poursuit son but précédent au lieu de basculer');
});
