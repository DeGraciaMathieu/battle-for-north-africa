// ===========================================================================
//  Ravitaillement (flood-fill depuis les sources).
//
//  Sources d'un camp : son camp de base (hexe `base`, voir BASES) + ses dépôts
//  de ravitaillement tenus. Chaque source a sa PROPRE portée (`TERRAIN[t].supply`
//  : base 8, grand dépôt 6, petit dépôt 4). Il se propage d'hex en hex tant
//  qu'il ne traverse ni la mer, ni un hex ennemi, ni une ZOC ennemie (sauf sur
//  un hex occupé par une unité amie, qui annule la ZOC), dans la limite de la
//  portée de la source. Une unité sur un hex atteint est ravitaillée.
// ===========================================================================

import { DIRS, TERRAIN, BASES } from './config.js';
import { key, offsetToAxial } from './geometry.js';
import { other, enemyAt } from './units.js';
import { zocOf } from './movement.js';

export function supplySources(state, side) {
  const { terrain, objControl } = state;
  const src = new Set();
  for (const [k, t] of terrain) {                                          // dépôts/oasis tenus
    if ((t === 'depot' || t === 'dump' || t === 'oasis') && objControl.get(k) === side) src.add(k);
  }
  const { q, r } = offsetToAxial(...(state.bases ?? BASES)[side]);         // camp de base
  const k = key(q, r);
  if (terrain.has(k)) src.add(k);
  return src;
}

// Flood-fill à portée par source : chaque source démarre avec sa portée
// (`reach`), qui décroît de 1 par hex. On garde par hex la MEILLEURE portée
// restante (une source lointaine mais généreuse peut l'emporter sur une proche
// mais courte). `parent` remonte la route jusqu'à la source ; `reach` (portée
// restante) sert d'indicateur affiché. Une portée 0 est ravitaillée mais ne
// s'étend plus.
export function supplyRoutes(state, side) {
  const { units, terrain } = state;
  const eZOC = zocOf(units, other(side), terrain);
  // Une unité amie annule la ZOC ennemie sur son propre hex : sans cela, deux
  // unités au corps à corps (chacune dans la ZOC de l'autre) se couperaient
  // mutuellement le ravitaillement.
  const friendly = new Set(units.filter((u) => u.side === side).map((u) => key(u.q, u.r)));
  const blockedZOC = (k) => eZOC.has(k) && !friendly.has(k);
  const parent = new Map();
  const reach = new Map();                                                 // portée restante depuis la source
  const queue = [];
  for (const k of supplySources(state, side)) {
    const [q, r] = k.split(',').map(Number);
    if (enemyAt(units, q, r, side) || blockedZOC(k)) continue;             // source coupée
    const rng = TERRAIN[terrain.get(k)].supply ?? 0;
    if (rng > (reach.get(k) ?? -1)) {
      parent.set(k, null);
      reach.set(k, rng);
      queue.push([q, r, rng]);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const [q, r, rc] = queue[head++];
    const ck = key(q, r);
    if (rc !== reach.get(ck)) continue;                                    // entrée périmée
    if (rc <= 0) continue;                                                 // plus de portée
    for (const [dq, dr] of DIRS) {
      const nq = q + dq, nr = r + dr, nk = key(nq, nr);
      if (!terrain.has(nk)) continue;
      if (!isFinite(TERRAIN[terrain.get(nk)].cost)) continue;             // pas par la mer
      if (enemyAt(units, nq, nr, side)) continue;                          // pas par l'ennemi
      if (blockedZOC(nk)) continue;                                        // la ZOC coupe la route (sauf hex ami)
      const nrc = rc - 1;
      if (nrc > (reach.get(nk) ?? -1)) {
        parent.set(nk, ck);
        reach.set(nk, nrc);
        queue.push([nq, nr, nrc]);
      }
    }
  }
  return { supplied: new Set(reach.keys()), parent, reach };
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
