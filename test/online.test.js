// ===========================================================================
//  Mode en ligne — fondation déterministe (lockstep).
//
//  Le mode deux joueurs ne transmet que l'INTENTION des actions ; chaque client
//  rejoue le même code de règle sur un état identique. La seule source d'aléa du
//  moteur est le dé de combat (`state.rng`). Ces tests vérifient que, semé à
//  l'identique (mulberry32), deux parties conduites par la même séquence
//  d'actions restent rigoureusement synchronisées — condition sans laquelle le
//  relais en ligne désynchroniserait les deux écrans.
//
//  Aucune règle n'est modifiée : on n'importe que le PRNG de la couche réseau et
//  les fonctions de règle publiques.
// ===========================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../render/net.js';
import { resolveCombat } from '../src/combat.js';
import { makeState, makeUnit, fillTerrain } from './helpers.js';

test('mulberry32 est déterministe : même graine → même suite', () => {
  const a = mulberry32(123456789);
  const b = mulberry32(123456789);
  const c = mulberry32(987654321);
  const sa = Array.from({ length: 64 }, () => a());
  const sb = Array.from({ length: 64 }, () => b());
  assert.deepStrictEqual(sa, sb);                       // reproductible d'un client à l'autre
  assert.notDeepStrictEqual(sa, Array.from({ length: 64 }, () => c())); // graines différentes → suites différentes
  assert.ok(sa.every((x) => x >= 0 && x < 1));          // dans [0, 1)
});

// Fabrique une partie identique (terrain plat + deux camps face à face), pilotée
// par un RNG semé. Deux appels avec la même graine sont des jumeaux parfaits.
function twinGame(seed) {
  const coords = [];
  for (let q = -2; q <= 3; q++) for (let r = -2; r <= 3; r++) coords.push([q, r]);
  const units = [
    makeUnit({ id: 0, side: 'blue', type: 'armor', q: 0, r: 0 }),
    makeUnit({ id: 1, side: 'blue', type: 'inf', q: 0, r: 1, atk: 4, def: 4, ratk: 2, rdef: 2 }),
    makeUnit({ id: 2, side: 'red', type: 'inf', q: 1, r: 0, atk: 4, def: 5, ratk: 2, rdef: 3 }),
    makeUnit({ id: 3, side: 'red', type: 'inf', q: 1, r: 1, atk: 4, def: 5, ratk: 2, rdef: 3 }),
  ];
  return makeState({ terrain: fillTerrain(coords), units, rng: mulberry32(seed) });
}

// Instantané comparable de l'état de jeu (positions + faces + camps).
const snap = (s) =>
  s.units
    .map((u) => ({ id: u.id, side: u.side, q: u.q, r: u.r, reduced: u.reduced }))
    .sort((a, b) => a.id - b.id);

test('deux parties jumelles restent synchronisées après une série de combats', () => {
  const A = twinGame(0xc0ffee);
  const B = twinGame(0xc0ffee);
  const diceA = [];

  // Simule le relais : le joueur actif (A) résout, l'autre (B) rejoue la même
  // intention. À chaque tour on replace les pions à l'identique dans les deux
  // parties (mutation symétrique) pour garantir un combat, puis on compare.
  for (let i = 0; i < 10; i++) {
    let both = true;
    for (const [s, dice] of [[A, diceA], [B, null]]) {
      const atk = s.units.find((u) => u.side === 'blue');
      const def = s.units.find((u) => u.side === 'red');
      if (!atk || !def) { both = false; break; }
      atk.q = 0; atk.r = 0; atk.hasFought = false;
      def.q = 1; def.r = 0; def.hasFought = false;
      const out = resolveCombat(s, [atk], def);          // consomme 1 tirage de rng
      if (dice) dice.push(out.die);
    }
    if (!both) break;
    // Le cœur du lockstep : mêmes dés → mêmes conséquences → états identiques.
    assert.deepStrictEqual(snap(A), snap(B));
  }

  assert.ok(diceA.length >= 3, 'plusieurs combats doivent avoir été résolus');
  assert.ok(diceA.every((d) => d >= 1 && d <= 6), 'dés dans 1..6');
  assert.ok(new Set(diceA).size > 1, 'le RNG doit réellement varier les dés');
});
