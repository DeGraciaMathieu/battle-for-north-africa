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
    objControl: new Map(),        // key -> 'axis' | 'ally' (dernier occupant)
    units: createUnits(composition),
    G: { turn: 1, player: 'axis', phase: 'move', over: false },
    bus: createBus(),
    rng,
  };
  relocateOffWater(state);
  updateObjectives(state);
  startMove(state, 'axis');
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
  for (const [k, t] of state.terrain) {
    if (t !== 'town' && t !== 'village') continue;
    const [q, r] = k.split(',').map(Number);
    const occ = unitsAt(state.units, q, r)[0];
    if (occ) state.objControl.set(k, occ.side);
  }
}

export const objCount = (state, side) =>
  state.objectives.filter((k) => state.objControl.get(k) === side).length;

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
  } else if (G.player === 'axis') {
    G.player = 'ally';
    G.phase = 'move';
    startMove(state, 'ally');
  } else {
    G.player = 'axis';
    G.phase = 'move';
    G.turn++;
    startMove(state, 'axis');
    checkTurnEnd(state);
  }
  state.bus.emit('phaseChanged');
}

export function checkElimination(state) {
  const a = state.units.some((u) => u.side === 'axis');
  const b = state.units.some((u) => u.side === 'ally');
  if (!a) endGame(state, 'ally', 'Force Bleue anéantie');
  else if (!b) endGame(state, 'axis', 'Force Rouge anéantie');
}

export function checkTurnEnd(state) {
  if (state.G.turn > MAX_TURNS) {
    const a = objCount(state, 'axis');
    const b = objCount(state, 'ally');
    endGame(state, a >= b ? 'axis' : 'ally', `Fin du tour ${MAX_TURNS} — objectifs ${a}–${b}`);
  }
}

export function endGame(state, side, reason) {
  state.G.over = true;
  state.bus.emit('gameOver', { side, reason });
}
