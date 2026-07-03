// ===========================================================================
//  Mouvement & zones de contrôle (ZOC).
//  Portée calculée par Dijkstra à points de mouvement (PM) ; entrer dans une
//  ZOC ennemie stoppe l'unité (hex terminal).
// ===========================================================================

import { DIRS, STACK_MAX, TERRAIN } from './config.js';
import { key } from './geometry.js';
import { other, enemyAt, stackCount } from './units.js';

// ZOC d'un camp : les 6 hexes (existants) autour de chacune de ses unités.
export function zocOf(units, side, terrain) {
  const s = new Set();
  for (const u of units) {
    if (u.side !== side) continue;
    for (const [dq, dr] of DIRS) {
      const k = key(u.q + dq, u.r + dr);
      if (terrain.has(k)) s.add(k);
    }
  }
  return s;
}

// Hexes atteignables par `unit` avec ses PM restants. Renvoie aussi le coût par
// hex (`dist`) et la ZOC ennemie utilisée (pour l'arrêt au déplacement).
export function computeReachable(state, unit) {
  const { units, terrain } = state;
  const start = key(unit.q, unit.r);
  const eZOC = zocOf(units, other(unit.side), terrain);
  const dist = { [start]: 0 };
  const frontier = [{ q: unit.q, r: unit.r, k: start, cost: 0 }];
  const reachable = new Set();
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift();
    if (cur.cost > dist[cur.k]) continue;
    // Entrer dans une ZOC ennemie stoppe net : hex terminal, on n'étend pas.
    if (eZOC.has(cur.k) && cur.k !== start) {
      reachable.add(cur.k);
      continue;
    }
    for (const [dq, dr] of DIRS) {
      const nq = cur.q + dq, nr = cur.r + dr, nk = key(nq, nr);
      if (!terrain.has(nk)) continue;
      const cost = TERRAIN[terrain.get(nk)].cost;
      if (!isFinite(cost)) continue;                        // mer infranchissable
      if (enemyAt(units, nq, nr, unit.side)) continue;      // pas d'entrée en hex ennemi
      if (stackCount(units, nq, nr, unit.side) >= STACK_MAX) continue; // empilement plein
      const nc = cur.cost + cost;
      if (nc <= unit.mpLeft && (dist[nk] === undefined || nc < dist[nk])) {
        dist[nk] = nc;
        reachable.add(nk);
        frontier.push({ q: nq, r: nr, k: nk, cost: nc });
      }
    }
  }
  reachable.delete(start);
  return { reachable, dist, eZOC };
}

// Applique un déplacement : consomme les PM, met à 0 si arrivée en ZOC ennemie.
export function moveUnit(unit, targetKey, dist, eZOC) {
  const [q, r] = targetKey.split(',').map(Number);
  unit.q = q;
  unit.r = r;
  unit.mpLeft -= dist[targetKey];
  if (eZOC.has(targetKey)) unit.mpLeft = 0;
}
