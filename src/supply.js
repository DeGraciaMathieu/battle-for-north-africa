// ===========================================================================
//  Ravitaillement (flood-fill depuis les sources).
//
//  Sources d'un camp : son camp de base (hexe `base`, voir BASES) + ses
//  villes/ports tenus. Le ravitaillement se propage d'hex en hex tant qu'il ne
//  traverse ni la mer, ni un hex ennemi, ni une ZOC ennemie (sauf sur un hex
//  occupé par une unité amie, qui annule la ZOC), ET dans la limite de
//  SUPPLY_RANGE hexes de route depuis la source. Une unité sur un hex atteint
//  est ravitaillée.
// ===========================================================================

import { DIRS, TERRAIN, SUPPLY_RANGE, BASES } from './config.js';
import { key, offsetToAxial } from './geometry.js';
import { other, enemyAt } from './units.js';
import { zocOf } from './movement.js';

export function supplySources(state, side) {
  const { terrain, objectives, objControl } = state;
  const src = new Set();
  for (const k of objectives) if (objControl.get(k) === side) src.add(k); // ports tenus
  const [bc, br] = BASES[side];                                            // camp de base
  const { q, r } = offsetToAxial(bc, br);
  const k = key(q, r);
  if (terrain.has(k)) src.add(k);
  return src;
}

// Flood-fill avec suivi du parent (BFS, file FIFO → routes courtes et lisibles).
// `parent` mappe chaque hex ravitaillé vers l'hex d'où le ravitaillement l'atteint
// (null pour une source). Remonter les parents trace la route jusqu'à la source.
export function supplyRoutes(state, side) {
  const { units, terrain } = state;
  const eZOC = zocOf(units, other(side), terrain);
  // Une unité amie annule la ZOC ennemie sur son propre hex : sans cela, deux
  // unités au corps à corps (chacune dans la ZOC de l'autre) se couperaient
  // mutuellement le ravitaillement.
  const friendly = new Set(units.filter((u) => u.side === side).map((u) => key(u.q, u.r)));
  const blockedZOC = (k) => eZOC.has(k) && !friendly.has(k);
  const parent = new Map();
  const depth = new Map();                                                 // longueur de route depuis la source
  const queue = [];
  for (const k of supplySources(state, side)) {
    const [q, r] = k.split(',').map(Number);
    if (enemyAt(units, q, r, side) || blockedZOC(k)) continue;             // source coupée
    parent.set(k, null);
    depth.set(k, 0);
    queue.push([q, r, 0]);
  }
  let head = 0;
  while (head < queue.length) {
    const [q, r, d] = queue[head++];
    if (d >= SUPPLY_RANGE) continue;                                       // limite de portée
    const ck = key(q, r);
    for (const [dq, dr] of DIRS) {
      const nq = q + dq, nr = r + dr, nk = key(nq, nr);
      if (parent.has(nk) || !terrain.has(nk)) continue;
      if (!isFinite(TERRAIN[terrain.get(nk)].cost)) continue;             // pas par la mer
      if (enemyAt(units, nq, nr, side)) continue;                          // pas par l'ennemi
      if (blockedZOC(nk)) continue;                                        // la ZOC coupe la route (sauf hex ami)
      parent.set(nk, ck);
      depth.set(nk, d + 1);
      queue.push([nq, nr, d + 1]);
    }
  }
  return { supplied: new Set(parent.keys()), parent, depth };
}

export function suppliedHexes(state, side) {
  return supplyRoutes(state, side).supplied;
}

// Recalcule l'état de ravitaillement de toutes les unités.
export function updateSupply(state) {
  const cache = {};
  for (const u of state.units) {
    const s = cache[u.side] || (cache[u.side] = suppliedHexes(state, u.side));
    u.supplied = s.has(key(u.q, u.r));
  }
}
