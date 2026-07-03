// ===========================================================================
//  Ravitaillement (flood-fill depuis les sources).
//
//  Sources d'un camp : ses villes/ports tenus + son bord de carte
//  (Axe = ouest, Allié = est). Le ravitaillement se propage d'hex en hex tant
//  qu'il ne traverse ni la mer, ni un hex ennemi, ni une ZOC ennemie. Une unité
//  posée sur un hex atteint est ravitaillée.
// ===========================================================================

import { COLS, ROWS, DIRS, TERRAIN } from './config.js';
import { key, offsetToAxial } from './geometry.js';
import { other, enemyAt } from './units.js';
import { zocOf } from './movement.js';

export function supplySources(state, side) {
  const { terrain, objectives, objControl } = state;
  const src = new Set();
  for (const k of objectives) if (objControl.get(k) === side) src.add(k); // ports tenus
  const edgeCol = side === 'axis' ? 0 : COLS - 1;                          // bord ami
  for (let rw = 0; rw < ROWS; rw++) {
    const { q, r } = offsetToAxial(edgeCol, rw);
    const k = key(q, r);
    if (terrain.has(k) && isFinite(TERRAIN[terrain.get(k)].cost)) src.add(k);
  }
  return src;
}

export function suppliedHexes(state, side) {
  const { units, terrain } = state;
  const eZOC = zocOf(units, other(side), terrain);
  const seen = new Set();
  const queue = [];
  for (const k of supplySources(state, side)) {
    const [q, r] = k.split(',').map(Number);
    if (enemyAt(units, q, r, side) || eZOC.has(k)) continue;               // source coupée
    seen.add(k);
    queue.push([q, r]);
  }
  while (queue.length) {
    const [q, r] = queue.pop();
    for (const [dq, dr] of DIRS) {
      const nq = q + dq, nr = r + dr, nk = key(nq, nr);
      if (seen.has(nk) || !terrain.has(nk)) continue;
      if (!isFinite(TERRAIN[terrain.get(nk)].cost)) continue;             // pas par la mer
      if (enemyAt(units, nq, nr, side)) continue;                          // pas par l'ennemi
      if (eZOC.has(nk)) continue;                                          // la ZOC coupe la route
      seen.add(nk);
      queue.push([nq, nr]);
    }
  }
  return seen;
}

// Recalcule l'état de ravitaillement de toutes les unités.
export function updateSupply(state) {
  const cache = {};
  for (const u of state.units) {
    const s = cache[u.side] || (cache[u.side] = suppliedHexes(state, u.side));
    u.supplied = s.has(key(u.q, u.r));
  }
}
