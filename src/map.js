// ===========================================================================
//  Génération de la carte — terrain, hexes et objectifs.
//  Reproductible via une seed : même seed → même carte (PRNG mulberry32).
//  La seed choisit un style de cours d'eau (vertical / horizontal / diagonal /
//  fourchu), sème le relief (bois, coteaux) et l'eau (étangs) en amas variés,
//  puis garantit la jouabilité : ponts ajoutés jusqu'à relier les deux bases,
//  unités tombées dans l'eau repoussées à terre (voir game.js).
// ===========================================================================

import { COLS, ROWS, BASES, DIRS, TERRAIN } from './config.js';
import { key, offsetToAxial, clamp, hexDistance } from './geometry.js';

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

  // 2) Hydrographie. Selon la seed, deux régimes très différents :
  //    — une grande transversale bord-à-bord (ligne de front + ponts goulots) ;
  //    — un réseau fragmenté : quelques lacs, des rivières courtes qui en
  //      naissent, et une ou deux rivières indépendantes.
  //    Dans les deux cas, `path` (clés axiales) porte les ponts et garantit,
  //    avec l'étape 7, la jouabilité.
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

  // Amas d'eau compact (lac) : agrégation de voisins depuis un centre.
  const growBlob = (center, size) => {
    const cells = [], frontier = [center], seen = new Set();
    while (frontier.length && cells.length < size) {
      const cell = frontier.splice(Math.floor(rng() * frontier.length), 1)[0];
      const k = key(cell.q, cell.r);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!terrain.has(k)) continue;                          // hors carte
      cells.push(k);
      for (const [dq, dr] of DIRS) frontier.push({ q: cell.q + dq, r: cell.r + dr });
    }
    return cells;
  };
  // Rivière courte : marche depuis `start` dans une direction, en méandrant,
  // jusqu'à `len` pas ou la sortie de carte. Renvoie les clés axiales franchies.
  const growRiver = (start, len) => {
    const cells = [];
    let d = rint(0, 5), q = start.q, r = start.r;
    for (let i = 0; i < len; i++) {
      if (rng() < 0.3) d = (d + (rng() < 0.5 ? 1 : 5)) % 6;   // dévie d'un cran
      q += DIRS[d][0]; r += DIRS[d][1];
      const k = key(q, r);
      if (!terrain.has(k)) break;                             // sort de la carte
      cells.push(k);
    }
    return cells;
  };

  let path;
  if (rng() < 0.5) {
    // Régime transversal : un ruban qui serpente d'un bord à l'autre.
    const style = rint(0, 3);
    const trace = style === 1 ? buildHorizontal() : style === 2 ? buildDiagonal() : buildVertical();
    const water = style === 3 ? trace.concat(buildBranch(trace)) : trace;
    for (const [c, rw] of water) { const { q, r } = offsetToAxial(c, rw); terrain.set(key(q, r), 'sea'); }
    path = trace.map(([c, rw]) => { const { q, r } = offsetToAxial(c, rw); return key(q, r); });
  } else {
    // Régime fragmenté : quelques lacs, des rivières qui en naissent, et une ou
    // deux rivières indépendantes. La plus longue rivière portera les ponts.
    const rivers = [];
    for (let i = 0, nLakes = rint(2, 3); i < nLakes; i++) {
      const lake = growBlob(offsetToAxial(rint(3, COLS - 4), rint(3, ROWS - 4)), rint(3, 7));
      for (const k of lake) terrain.set(k, 'sea');
      if (lake.length && rng() < 0.7) {                       // une rivière issue du lac
        const [sq, sr] = lake[Math.floor(rng() * lake.length)].split(',').map(Number);
        const river = growRiver({ q: sq, r: sr }, rint(4, 9));
        for (const k of river) terrain.set(k, 'sea');
        rivers.push(river);
      }
    }
    for (let i = 0, nExtra = rint(1, 2); i < nExtra; i++) {   // rivières indépendantes
      const river = growRiver(offsetToAxial(rint(2, COLS - 3), rint(2, ROWS - 3)), rint(5, 10));
      for (const k of river) terrain.set(k, 'sea');
      rivers.push(river);
    }
    path = rivers.sort((a, b) => b.length - a.length)[0] ?? [];
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
  stamp('rock', rint(6, 11), 2, 5);  // coteaux
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
  const nBridges = rint(2, 3);
  for (let i = 1; path.length && i <= nBridges; i++) {
    const bk = path[Math.floor((path.length * i) / (nBridges + 1))];
    if (terrain.get(bk) === 'sea') terrain.set(bk, 'town');
  }

  // 6) Bases (elles priment sur tout) puis peuplements de terre, espacés et à
  //    l'écart des bases : chacun est une ville (objectif, portée 6) ou un
  //    village (relais de ravito seul, portée 4). Les ponts restent des villes.
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
  for (let placed = 0, tries = 0; placed < rint(9, 13) && tries < 1500; tries++) {
    const { q, r } = offsetToAxial(rint(1, COLS - 2), rint(1, ROWS - 2));
    const k = key(q, r);
    if (!LAND.has(terrain.get(k)) || baseKeys.has(k) || near(q, r)) continue;
    // Jamais un îlot : au moins un voisin terrestre (accès par la terre garanti).
    if (!DIRS.some(([dq, dr]) => LAND.has(terrain.get(key(q + dq, r + dr))))) continue;
    terrain.set(k, rng() < 0.85 ? 'village' : 'town'); // grande majorité de villages sur les terres
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

  // 8) Réseau routier : relie villes, villages et bases par un arbre couvrant
  //    minimal (arêtes reliant les nœuds les plus proches). Chaque arête est
  //    tracée par un Dijkstra pondéré : la route préfère la plaine, contourne
  //    relief et eau (franchissables mais coûteux), et RÉUTILISE les routes déjà
  //    posées (coût quasi nul) → tronçons partagés, embranchements, tracé
  //    organique. Un bruit seedé donne le méandre.
  const SETTLE = (t) => t === 'town' || t === 'village' || t === 'base';
  const BASE_COST = { road: 0.2, sand: 1, sand2: 1, oasis: 2, rock: 3, coast: 3, sea: 6 };
  const stepCost = (q, r) => {
    const t = terrain.get(key(q, r));
    if (!t) return Infinity;                                 // hors carte
    if (SETTLE(t)) return 0.4;                               // traverse un peuplement
    return (BASE_COST[t] ?? 1) * (0.8 + noise(q, r) * 0.7);  // + jitter organique
  };
  // Chemin de moindre coût entre deux hexes (Dijkstra), renvoie les clés
  // intermédiaires (hors extrémités).
  const roadPath = (a, b) => {
    const start = key(a.q, a.r), goal = key(b.q, b.r);
    const dist = new Map([[start, 0]]);
    const prev = new Map();
    const done = new Set();
    for (;;) {
      let ck = null, cd = Infinity;
      for (const [k, d] of dist) if (!done.has(k) && d < cd) { cd = d; ck = k; }
      if (ck === null || ck === goal) break;
      done.add(ck);
      const [q, r] = ck.split(',').map(Number);
      for (const [dq, dr] of DIRS) {
        const nq = q + dq, nr = r + dr, nk = key(nq, nr);
        if (done.has(nk) || !terrain.has(nk)) continue;
        const nd = cd + stepCost(nq, nr);
        if (nd < (dist.get(nk) ?? Infinity)) { dist.set(nk, nd); prev.set(nk, ck); }
      }
    }
    const path = [];
    for (let cur = goal; cur !== start && cur !== undefined; cur = prev.get(cur)) {
      if (cur !== goal) path.push(cur);                       // exclut les deux extrémités
    }
    return path;
  };

  const nodes = [];
  for (const [k, t] of terrain) {
    if (SETTLE(t)) { const [q, r] = k.split(',').map(Number); nodes.push({ q, r }); }
  }
  const inTree = new Set([0]);
  while (nodes.length > 1 && inTree.size < nodes.length) {
    let best = null;
    for (const i of inTree) {
      for (let j = 0; j < nodes.length; j++) {
        if (inTree.has(j)) continue;
        const d = hexDistance(nodes[i].q, nodes[i].r, nodes[j].q, nodes[j].r);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    inTree.add(best.j);
    for (const k of roadPath(nodes[best.i], nodes[best.j])) {
      if (!SETTLE(terrain.get(k))) terrain.set(k, 'road');    // n'écrase pas les peuplements traversés
    }
  }

  // Plancher d'objectifs : garantir au moins 3 villes (on promeut des villages
  // si les tirages en ont laissé trop peu).
  let villes = [...terrain.values()].filter((t) => t === 'town').length;
  for (const [k, t] of terrain) {
    if (villes >= 3) break;
    if (t === 'village') { terrain.set(k, 'town'); villes++; }
  }

  const objectives = [...terrain.entries()]
    .filter(([, t]) => t === 'town')
    .map(([k]) => k);
  return { terrain, hexes, objectives };
}
