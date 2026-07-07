// ===========================================================================
//  Séquence de jeu (IGO-UGO) : Bleu mvt → Bleu combat → Rouge mvt → Rouge combat.
//  Fabrique l'état complet de la partie, gère l'avancement des phases,
//  les objectifs et les conditions de victoire.
// ===========================================================================

import { MAX_TURNS, TERRAIN, DIRS } from './config.js';
import { createUnits, eMov, unitsAt } from './units.js';
import { generateMap } from './map.js';
import { createBus } from './events.js';
import { updateSupply } from './supply.js';
import { key } from './geometry.js';

// Crée une partie prête à jouer. `rng` est injectable (déterminisme des tests) ;
// `seed` fixe la carte générée ; `composition` (optionnelle) fixe les armées
// (éditeur point-buy) — sinon le roster fixe par défaut est utilisé. `map`
// (optionnelle) fournit une carte déjà construite (chargée depuis un fichier) et
// prime alors sur la génération par seed.
export function createGame(rng = Math.random, seed, composition, map, mapOptions) {
  const { terrain, hexes, objectives } = map ?? generateMap(seed, mapOptions);
  const state = {
    terrain,
    hexes,
    objectives,
    objControl: new Map(),        // key -> 'blue' | 'red' (dernier occupant)
    units: createUnits(composition),
    G: { turn: 1, player: 'blue', phase: 'move', over: false },
    bus: createBus(),
    rng,
  };
  // Effectif initial par camp, figé avant tout combat (base des « éliminés »).
  state.initialCount = { blue: 0, red: 0 };
  for (const u of state.units) state.initialCount[u.side]++;
  relocateOffWater(state);
  updateObjectives(state);
  startMove(state, 'blue');
  // Après chaque combat, vérifier l'anéantissement d'un camp.
  state.bus.on('combatResolved', () => checkElimination(state));
  return state;
}

// Le tracé de l'eau est indépendant du déploiement : toute unité tombée sur un
// hex infranchissable est repoussée vers la terre atteignable la plus proche.
function relocateOffWater(state) {
  const passable = (q, r) => { const t = state.terrain.get(key(q, r)); return t && TERRAIN[t].cost !== Infinity; };
  for (const u of state.units) {
    if (passable(u.q, u.r)) continue;
    const seen = new Set([key(u.q, u.r)]);
    let ring = [[u.q, u.r]], found = null;
    while (ring.length && !found) {
      const next = [];
      for (const [q, r] of ring) {
        for (const [dq, dr] of DIRS) {
          const nq = q + dq, nr = r + dr, nk = key(nq, nr);
          if (seen.has(nk)) continue;
          seen.add(nk);
          if (passable(nq, nr)) { found = { q: nq, r: nr }; break; }
          next.push([nq, nr]);
        }
        if (found) break;
      }
      ring = next;
    }
    if (found) { u.q = found.q; u.r = found.r; }
  }
}

// Met à jour le contrôle des peuplements (villes ET villages) selon l'occupant.
// Le contrôle sert au ravitaillement ; la victoire (objCount) ne compte que les
// villes (state.objectives).
export function updateObjectives(state) {
  // Contrôle suivi pour les peuplements (sources de ravitaillement) ET les
  // objectifs de victoire, ces derniers pouvant être sur n'importe quel terrain.
  const tracked = new Set(state.objectives);
  for (const [k, t] of state.terrain) {
    if (t === 'town' || t === 'village' || t === 'oasis') tracked.add(k);
  }
  for (const k of tracked) {
    const [q, r] = k.split(',').map(Number);
    const occ = unitsAt(state.units, q, r)[0];
    if (occ) state.objControl.set(k, occ.side);
  }
}

export const objCount = (state, side) =>
  state.objectives.filter((k) => state.objControl.get(k) === side).length;

// Pertes d'un camp : éliminés (écart au roster initial) et réduits vivants.
export function losses(state, side) {
  const alive = state.units.filter((u) => u.side === side);
  return {
    eliminated: state.initialCount[side] - alive.length,
    reduced: alive.filter((u) => u.reduced).length,
  };
}

// Poids du score de victoire : objectif tenu, unité ennemie éliminée / réduite.
export const SCORE_WEIGHTS = { obj: 2, eliminated: 1, reduced: 0.5 };

// Score de victoire d'un camp : objectifs tenus + pertes infligées à l'ennemi.
export function victoryScore(state, side) {
  const enemy = side === 'blue' ? 'red' : 'blue';
  const { eliminated, reduced } = losses(state, enemy);
  return objCount(state, side) * SCORE_WEIGHTS.obj
    + eliminated * SCORE_WEIGHTS.eliminated
    + reduced * SCORE_WEIGHTS.reduced;
}

// Début de phase de mouvement d'un camp : rafraîchit le ravitaillement (il
// conditionne les PM) puis réinitialise PM et drapeau de combat.
export function startMove(state, side) {
  updateSupply(state);
  for (const u of state.units) {
    if (u.side === side) {
      u.mpLeft = eMov(u);
      u.hasFought = false;
    }
  }
}

// Avance la séquence : move → combat, puis passage au camp suivant / tour suivant.
export function endPhase(state) {
  if (state.G.over) return;
  const { G } = state;
  if (G.phase === 'move') {
    G.phase = 'combat';
  } else if (G.player === 'blue') {
    G.player = 'red';
    G.phase = 'move';
    startMove(state, 'red');
  } else {
    G.player = 'blue';
    G.phase = 'move';
    G.turn++;
    startMove(state, 'blue');
    checkTurnEnd(state);
  }
  state.bus.emit('phaseChanged');
}

export function checkElimination(state) {
  const a = state.units.some((u) => u.side === 'blue');
  const b = state.units.some((u) => u.side === 'red');
  if (!a) endGame(state, 'red', 'Force Bleue anéantie');
  else if (!b) endGame(state, 'blue', 'Force Rouge anéantie');
}

export function checkTurnEnd(state) {
  if (state.G.turn > MAX_TURNS) {
    const a = victoryScore(state, 'blue');
    const b = victoryScore(state, 'red');
    endGame(state, a >= b ? 'blue' : 'red', `Fin du tour ${MAX_TURNS} — score ${a}–${b}`);
  }
}

export function endGame(state, side, reason) {
  state.G.over = true;
  state.bus.emit('gameOver', { side, reason });
}
