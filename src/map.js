// ===========================================================================
//  Génération de la carte — terrain, hexes et objectifs.
//  Reproductible via une seed : même seed → même carte (PRNG mulberry32).
//  La seed choisit un style de cours d'eau (vertical / horizontal / diagonal /
//  fourchu), sème le relief (bois, coteaux) et l'eau (étangs) en amas variés,
//  puis garantit la jouabilité : ponts ajoutés jusqu'à relier les deux bases,
//  unités tombées dans l'eau repoussées à terre (voir game.js).
// ===========================================================================

import { COLS, ROWS, BASES, DIRS, TERRAIN } from './config.js';
import { key, offsetToAxial, clamp } from './geometry.js';

// PRNG déterministe seedé : même seed → même suite de nombres [0, 1).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LAND = new Set(['sand', 'sand2', 'oasis', 'rock']);

// Construit une carte reproductible depuis `seed`. Renvoie le terrain, la liste
// des hexes et les clés des objectifs (villes de terre + ponts).
export function generateMap(seed = 1) {
  const rng = mulberry32(seed);
  const rint = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const terrain = new Map();
  const hexes = [];

  // 1) Fond de plaine (deux nuances) sur toute la carte.
  const noise = (a, b) => {
    const h = Math.sin(a * 127.1 + b * 311.7 + seed * 12.9898) * 43758.5453;
    return h - Math.floor(h);
  };
  for (let c = 0; c < COLS; c++) {
    for (let rw = 0; rw < ROWS; rw++) {
      const { q, r } = offsetToAxial(c, rw);
      terrain.set(key(q, r), noise(c, rw) > 0.5 ? 'sand' : 'sand2');
      hexes.push({ q, r });
    }
  }

  // 2) Cours d'eau : tracé (une cellule par pas) selon un style tiré au sort.
  //    Un « ruban » qui serpente autour d'un axe, éventuellement en diagonale
  //    ou avec une fourche. Le tracé principal `path` sert à poser les ponts.
  const meander = (v, center, lo, hi, wig) => {
    if (rng() >= wig) return clamp(v, lo, hi);
    const pullDown = v > center ? 0.65 : v < center ? 0.35 : 0.5; // rappel vers l'axe
    return clamp(v + (rng() < pullDown ? -1 : 1), lo, hi);
  };
  const buildVertical = () => {
    const center = rint(7, COLS - 8), wig = 0.25 + rng() * 0.6, cells = [];
    let col = center;
    for (let rw = 0; rw < ROWS; rw++) { cells.push([col, rw]); col = meander(col, center, 1, COLS - 2, wig); }
    return cells;
  };
  const buildHorizontal = () => {
    const center = rint(4, ROWS - 5), wig = 0.25 + rng() * 0.6, cells = [];
    let row = center;
    for (let c = 0; c < COLS; c++) { cells.push([c, row]); row = meander(row, center, 1, ROWS - 2, wig); }
    return cells;
  };
  const buildDiagonal = () => {
    const down = rng() < 0.5, startR = down ? 0 : ROWS - 1, endR = down ? ROWS - 1 : 0, cells = [];
    let row = startR;
    for (let c = 0; c < COLS; c++) {
      const target = startR + (endR - startR) * (c / (COLS - 1));
      if (row < target - 0.5) row++;
      else if (row > target + 0.5) row--;
      else if (rng() < 0.4) row += rng() < 0.5 ? -1 : 1;
      row = clamp(row, 0, ROWS - 1);
      cells.push([c, row]);
    }
    return cells;
  };
  const buildBranch = (main) => {
    const [bc0, brw0] = main[rint(Math.floor(ROWS * 0.3), Math.floor(ROWS * 0.7))];
    const toRight = rng() < 0.5, end = toRight ? COLS - 2 : 1, cells = [];
    let c = bc0, rw = brw0;
    while (c !== end) { c += toRight ? 1 : -1; rw = clamp(rw + (rng() < 0.35 ? (rng() < 0.5 ? -1 : 1) : 0), 1, ROWS - 2); cells.push([c, rw]); }
    return cells;
  };

  const style = rint(0, 3);
  const path = style === 1 ? buildHorizontal() : style === 2 ? buildDiagonal() : buildVertical();
  const waterCells = style === 3 ? path.concat(buildBranch(path)) : path;
  for (const [c, rw] of waterCells) {
    const { q, r } = offsetToAxial(c, rw);
    terrain.set(key(q, r), 'sea');
  }

  // 3) Relief et étangs en amas : chaque amas croît depuis un centre par
  //    agrégation de voisins, en ne recouvrant que la plaine. Nombre, taille et
  //    position varient par seed → des cartes très différentes.
  const stamp = (type, count, minSize, maxSize) => {
    for (let i = 0; i < count; i++) {
      const size = rint(minSize, maxSize);
      const frontier = [offsetToAxial(rint(1, COLS - 2), rint(1, ROWS - 2))];
      const seen = new Set();
      let placed = 0;
      while (frontier.length && placed < size) {
        const cell = frontier.splice(Math.floor(rng() * frontier.length), 1)[0];
        const k = key(cell.q, cell.r);
        if (seen.has(k)) continue;
        seen.add(k);
        const cur = terrain.get(k);
        if (cur !== 'sand' && cur !== 'sand2') continue; // hors carte ou déjà occupé
        terrain.set(k, type);
        placed++;
        for (const [dq, dr] of DIRS) frontier.push({ q: cell.q + dq, r: cell.r + dr });
      }
    }
  };
  stamp('oasis', rint(4, 9), 4, 14); // bois
  stamp('rock', rint(3, 7), 3, 11);  // coteaux
  stamp('sea', rint(1, 4), 2, 6);    // étangs

  // 4) Berges : toute plaine bordant l'eau devient une berge.
  for (const [k, t] of [...terrain]) {
    if (t !== 'sea') continue;
    const [q, r] = k.split(',').map(Number);
    for (const [dq, dr] of DIRS) {
      const nk = key(q + dq, r + dr);
      if (terrain.get(nk) === 'sand' || terrain.get(nk) === 'sand2') terrain.set(nk, 'coast');
    }
  }

  // 5) Ponts sur le cours d'eau principal, répartis le long du tracé.
  const nBridges = rint(3, 5);
  for (let i = 1; i <= nBridges; i++) {
    const [c, rw] = path[Math.floor((path.length * i) / (nBridges + 1))];
    const { q, r } = offsetToAxial(c, rw);
    terrain.set(key(q, r), 'town');
  }

  // 6) Bases (elles priment sur tout) puis villes de terre, espacées et à
  //    l'écart des bases.
  const baseKeys = new Set();
  for (const [c, rw] of Object.values(BASES)) {
    const { q, r } = offsetToAxial(c, rw);
    terrain.set(key(q, r), 'base');
    baseKeys.add(key(q, r));
  }
  const townKeys = [];
  const near = (q, r) => townKeys.some((k) => {
    const [tq, tr] = k.split(',').map(Number);
    return (Math.abs(tq - q) + Math.abs(tq + tr - q - r) + Math.abs(tr - r)) / 2 < 3;
  });
  for (let placed = 0, tries = 0; placed < rint(4, 5) && tries < 500; tries++) {
    const { q, r } = offsetToAxial(rint(1, COLS - 2), rint(1, ROWS - 2));
    const k = key(q, r);
    if (!LAND.has(terrain.get(k)) || baseKeys.has(k) || near(q, r)) continue;
    terrain.set(k, 'town');
    townKeys.push(k);
    placed++;
  }

  // 7) Jouabilité : tant que les deux bases ne sont pas reliées par voie
  //    terrestre, on transforme un hex d'eau frontalier en pont.
  const passable = (k) => { const t = terrain.get(k); return t && TERRAIN[t].cost !== Infinity; };
  const baseKey = (side) => { const { q, r } = offsetToAxial(...BASES[side]); return key(q, r); };
  for (let guard = 0; guard < 60; guard++) {
    const seen = new Set([baseKey('axis')]);
    const stackF = [baseKey('axis')];
    while (stackF.length) {
      const [q, r] = stackF.pop().split(',').map(Number);
      for (const [dq, dr] of DIRS) {
        const nk = key(q + dq, r + dr);
        if (!seen.has(nk) && passable(nk)) { seen.add(nk); stackF.push(nk); }
      }
    }
    if (seen.has(baseKey('ally'))) break;
    let bridge = null;
    for (const k of [...seen].sort()) {
      const [q, r] = k.split(',').map(Number);
      for (const [dq, dr] of DIRS) {
        if (terrain.get(key(q + dq, r + dr)) === 'sea') { bridge = key(q + dq, r + dr); break; }
      }
      if (bridge) break;
    }
    if (!bridge) break;
    terrain.set(bridge, 'town');
  }

  const objectives = [...terrain.entries()]
    .filter(([, t]) => t === 'town')
    .map(([k]) => k);
  return { terrain, hexes, objectives };
}
