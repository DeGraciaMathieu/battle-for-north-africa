// ===========================================================================
//  Génération de la carte — terrain, hexes et objectifs.
//  Reproductible via une seed : même seed → même carte (PRNG mulberry32).
//  La seed choisit un style de cours d'eau (vertical / horizontal / diagonal /
//  fourchu), sème le relief (bois, coteaux) et l'eau (étangs) en amas variés,
//  puis garantit la jouabilité : routes de franchissement ajoutées jusqu'à relier les deux bases,
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

const LAND = new Set(['plain', 'plain2', 'forest', 'hill', 'plateau']);

// Registre des biomes de génération procédurale. Un biome est une fonction
// (seed, options) → { terrain, hexes, objectives } produisant une carte
// reproductible. Ajouter un biome (aride, hiver…) = une seule entrée ici.
// `generateMap` dispatche sur l'option `biome` (défaut : tempéré), de sorte que
// le comportement historique reste inchangé quand aucun biome n'est précisé.
export const BIOMES = {
  tempere: { name: 'Tempéré', gen: generateTempere },
  aride: { name: 'Aride', gen: generateAride },
};

export function generateMap(seed = 1, { fair = false, biome = 'tempere' } = {}) {
  return (BIOMES[biome] ?? BIOMES.tempere).gen(seed, { fair });
}

// Biome TEMPÉRÉ : plaines bicolores, hydrographie (fleuve transversal ou réseau
// fragmenté), reliefs (bois, coteaux, montagnes, plateaux), peuplements et réseau
// routier. Renvoie le terrain, la liste des hexes et les clés des objectifs.
// `fair` : place les peuplements sur un maillage régulier (équidistants) au lieu
// d'un tirage aléatoire ; le reste du terrain (rivière, reliefs, urbain, routes)
// demeure aléatoire.
function generateTempere(seed = 1, { fair = false } = {}) {
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
      terrain.set(key(q, r), noise(c, rw) > 0.5 ? 'plain' : 'plain2');
      hexes.push({ q, r });
    }
  }

  // 2) Hydrographie. Selon la seed, deux régimes très différents :
  //    — une grande transversale bord-à-bord (ligne de front + franchissements goulots) ;
  //    — un réseau fragmenté : quelques lacs, des rivières courtes qui en
  //      naissent, et une ou deux rivières indépendantes.
  //    Dans les deux cas, `path` (clés axiales) porte les franchissements et garantit,
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
    for (const [c, rw] of water) { const { q, r } = offsetToAxial(c, rw); terrain.set(key(q, r), 'river'); }
    path = trace.map(([c, rw]) => { const { q, r } = offsetToAxial(c, rw); return key(q, r); });
  } else {
    // Régime fragmenté : quelques lacs, des rivières qui en naissent, et une ou
    // deux rivières indépendantes. La plus longue rivière portera les franchissements.
    const rivers = [];
    for (let i = 0, nLakes = rint(1, 2); i < nLakes; i++) {
      const lake = growBlob(offsetToAxial(rint(3, COLS - 4), rint(3, ROWS - 4)), rint(2, 4));
      for (const k of lake) terrain.set(k, 'river');
      if (lake.length && rng() < 0.7) {                       // une rivière issue du lac
        const [sq, sr] = lake[Math.floor(rng() * lake.length)].split(',').map(Number);
        const river = growRiver({ q: sq, r: sr }, rint(4, 9));
        for (const k of river) terrain.set(k, 'river');
        rivers.push(river);
      }
    }
    for (let i = 0, nExtra = rint(1, 2); i < nExtra; i++) {   // rivières indépendantes
      const river = growRiver(offsetToAxial(rint(2, COLS - 3), rint(2, ROWS - 3)), rint(5, 10));
      for (const k of river) terrain.set(k, 'river');
      rivers.push(river);
    }
    path = rivers.sort((a, b) => b.length - a.length)[0] ?? [];
  }

  // 3) Relief et eau en amas. Deux formes complémentaires :
  //    — BOIS et étangs croissent depuis un centre par agrégation de voisins (sur
  //      la plaine seulement), biaisée selon un axe → amas ALLONGÉS plutôt que
  //      ronds ; les bois naissent au bord de l'eau (`centers`) ;
  //    — les COTEAUX forment des CHAÎNES orientées (`growRidge`) percées de
  //      passes : ils font barrière et canalisent les manœuvres.
  const stamp = (type, count, minSize, maxSize, { centers = null, elongate = false } = {}) => {
    for (let i = 0; i < count; i++) {
      const size = rint(minSize, maxSize);
      const center = centers && centers.length
        ? centers[Math.floor(rng() * centers.length)]
        : offsetToAxial(rint(1, COLS - 2), rint(1, ROWS - 2));
      const mainDir = rint(0, 5);
      const frontier = [center];
      const seen = new Set();
      let placed = 0;
      while (frontier.length && placed < size) {
        const cell = frontier.splice(Math.floor(rng() * frontier.length), 1)[0];
        const k = key(cell.q, cell.r);
        if (seen.has(k)) continue;
        seen.add(k);
        const cur = terrain.get(k);
        if (cur !== 'plain' && cur !== 'plain2') continue; // hors carte ou déjà occupé
        terrain.set(k, type);
        placed++;
        for (let di = 0; di < 6; di++) {
          // Allongement : on suit l'axe (di et son opposé), on raréfie les côtés.
          if (elongate && di !== mainDir && di !== (mainDir + 3) % 6 && rng() < 0.6) continue;
          frontier.push({ q: cell.q + DIRS[di][0], r: cell.r + DIRS[di][1] });
        }
      }
    }
  };

  // Chaîne de coteaux : une crête qui serpente depuis un point intérieur dans une
  // direction dominante, épaissie latéralement, percée de 1–2 passes laissées en
  // plaine (goulots franchissables). Ne recouvre que la plaine.
  const setRock = (q, r) => {
    const cur = terrain.get(key(q, r));
    if (cur === 'plain' || cur === 'plain2') terrain.set(key(q, r), 'hill');
  };
  const growRidge = () => {
    const start = offsetToAxial(rint(4, COLS - 5), rint(4, ROWS - 5));
    const spine = [];
    let d = rint(0, 5), q = start.q, r = start.r;
    for (let i = 0, len = rint(9, 16); i < len; i++) {
      if (rng() < 0.25) d = (d + (rng() < 0.5 ? 1 : 5)) % 6;  // dévie d'un cran
      q += DIRS[d][0]; r += DIRS[d][1];
      if (!terrain.has(key(q, r))) break;                     // sort de la carte
      spine.push({ q, r, d });
    }
    if (spine.length < 4) return;
    const gaps = new Set();
    for (let i = 0, n = rint(1, 2); i < n; i++) gaps.add(rint(1, spine.length - 2));
    spine.forEach((cell, i) => {
      if (gaps.has(i)) return;                                 // passe : rien ici
      setRock(cell.q, cell.r);
      for (const pd of [(cell.d + 2) % 6, (cell.d + 4) % 6]) { // épaississement latéral
        if (rng() < 0.55) setRock(cell.q + DIRS[pd][0], cell.r + DIRS[pd][1]);
      }
    });
    for (const g of gaps) {                                    // garantir la trouée
      const k = key(spine[g].q, spine[g].r);
      if (terrain.get(k) === 'hill') terrain.set(k, 'plain');
    }
  };

  // Bois au bord de l'eau : centres = plaines bordant une rivière ou un lac.
  const waterside = [];
  for (const [k, t] of terrain) {
    if (t !== 'plain' && t !== 'plain2') continue;
    const [q, r] = k.split(',').map(Number);
    if (DIRS.some(([dq, dr]) => terrain.get(key(q + dq, r + dr)) === 'river')) waterside.push({ q, r });
  }
  stamp('forest', rint(14, 24), 5, 16, { centers: waterside, elongate: true }); // bois près de l'eau
  for (let i = 0, n = rint(4, 5); i < n; i++) growRidge();                     // chaînes de coteaux
  stamp('river', rint(1, 3), 2, 5, { elongate: true });                         // étangs

  // 3b) Étagement du relief. Deux bandes d'altitude greffées sur les coteaux :
  //     — MONTAGNES au cœur des massifs (un coteau cerné de reliefs devient un
  //       sommet : plus coûteux, plus défensif) ;
  //     — PLATEAUX au pied des reliefs (les plaines qui les bordent forment une
  //       terrasse intermédiaire). Donne une pente plaine → plateau → coteau → sommet.
  for (const [k, t] of [...terrain]) {
    if (t !== 'hill') continue;
    const [q, r] = k.split(',').map(Number);
    const relief = DIRS.filter(([dq, dr]) => {
      const nt = terrain.get(key(q + dq, r + dr));
      return nt === 'hill' || nt === 'mountain';
    }).length;
    if (relief >= 4 && rng() < 0.5) terrain.set(k, 'mountain');
  }
  for (const [k, t] of [...terrain]) {
    if (t !== 'plain' && t !== 'plain2') continue;
    const [q, r] = k.split(',').map(Number);
    const foot = DIRS.some(([dq, dr]) => {
      const nt = terrain.get(key(q + dq, r + dr));
      return nt === 'hill' || nt === 'mountain';
    });
    if (foot && rng() < 0.45) terrain.set(k, 'plateau');
  }

  // 4) Bordures d'eau : une partie des plaines riveraines devient une berge
  //    (sèche) ou, plus rarement, un marais (bas-fond humide, pénible et exposé).
  //    Liseré irrégulier (tirage) plutôt que continu, pour ne pas élargir les rivières.
  for (const [k, t] of [...terrain]) {
    if (t !== 'river') continue;
    const [q, r] = k.split(',').map(Number);
    for (const [dq, dr] of DIRS) {
      const nk = key(q + dq, r + dr);
      const nt = terrain.get(nk);
      if (nt !== 'plain' && nt !== 'plain2') continue;
      const roll = rng();
      if (roll < 0.40) terrain.set(nk, 'bank');
      else if (roll < 0.52) terrain.set(nk, 'marsh');
    }
  }

  // 5) Franchissements (routes) sur le cours d'eau principal, répartis le long du tracé.
  const nBridges = rint(2, 3);
  for (let i = 1; path.length && i <= nBridges; i++) {
    const bk = path[Math.floor((path.length * i) / (nBridges + 1))];
    if (terrain.get(bk) === 'river') terrain.set(bk, 'road');
  }

  // 6) Bases (elles priment sur tout) puis peuplements de terre, espacés et à
  //    l'écart des bases : chacun est une ville (objectif, portée 6) ou un
  //    village (relais de ravito seul, portée 4). Les ponts sont des routes.
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
  // Deux villes ne peuvent pas être collées : vrai si un voisin direct est déjà
  // une ville (lecture directe du terrain, indépendante de townKeys).
  const townAdjacent = (q, r) =>
    DIRS.some(([dq, dr]) => terrain.get(key(q + dq, r + dr)) === 'town');
  // Un peuplement doit tenir sur une terre libre, hors base et à l'écart des
  // autres, avec au moins un voisin terrestre (jamais un îlot).
  const canSettle = (q, r) => {
    const k = key(q, r);
    if (!LAND.has(terrain.get(k)) || baseKeys.has(k) || near(q, r)) return false;
    return DIRS.some(([dq, dr]) => LAND.has(terrain.get(key(q + dq, r + dr))));
  };
  if (fair) {
    // Maillage régulier : peuplements équidistants sur l'intérieur jouable.
    // Décalage triangulaire une ligne sur deux ; une case sur trois est une ville.
    for (let ri = 0, rw = 3; rw <= ROWS - 3; rw += 4, ri++) {
      const shift = ri % 2 ? 3 : 0;
      for (let c = 3 + shift; c <= COLS - 3; c += 6) {
        const { q, r } = offsetToAxial(c, rw);
        if (!canSettle(q, r)) continue;
        terrain.set(key(q, r), townKeys.length % 3 === 0 && !townAdjacent(q, r) ? 'town' : 'village');
        townKeys.push(key(q, r));
      }
    }
  } else {
    for (let placed = 0, tries = 0; placed < rint(9, 13) && tries < 1500; tries++) {
      const { q, r } = offsetToAxial(rint(1, COLS - 2), rint(1, ROWS - 2));
      if (!canSettle(q, r)) continue;
      // grande majorité de villages ; ville seulement si aucune ville adjacente.
      terrain.set(key(q, r), rng() < 0.85 || townAdjacent(q, r) ? 'village' : 'town');
      townKeys.push(key(q, r));
      placed++;
    }
  }

  // 7) Jouabilité : tant que les deux bases ne sont pas reliées par voie
  //    terrestre, on transforme un hex d'eau frontalier en route.
  const passable = (k) => { const t = terrain.get(k); return t && TERRAIN[t].cost !== Infinity; };
  const baseKey = (side) => { const { q, r } = offsetToAxial(...BASES[side]); return key(q, r); };
  for (let guard = 0; guard < 60; guard++) {
    const seen = new Set([baseKey('blue')]);
    const stackF = [baseKey('blue')];
    while (stackF.length) {
      const [q, r] = stackF.pop().split(',').map(Number);
      for (const [dq, dr] of DIRS) {
        const nk = key(q + dq, r + dr);
        if (!seen.has(nk) && passable(nk)) { seen.add(nk); stackF.push(nk); }
      }
    }
    if (seen.has(baseKey('red'))) break;
    let crossing = null;
    for (const k of [...seen].sort()) {
      const [q, r] = k.split(',').map(Number);
      for (const [dq, dr] of DIRS) {
        if (terrain.get(key(q + dq, r + dr)) === 'river') { crossing = key(q + dq, r + dr); break; }
      }
      if (crossing) break;
    }
    if (!crossing) break;
    terrain.set(crossing, 'road');
  }

  // 7b) Zones urbaines : périphérie bâtie autour des peuplements. Denses autour
  //     des villes, plus clairsemées autour des villages. Elles offrent la
  //     protection d'une ville mais n'apportent aucun ravitaillement.
  for (const [k, t] of [...terrain]) {
    const density = t === 'town' ? 0.85 : t === 'village' ? 0.5 : 0;
    if (!density) continue;
    const [q, r] = k.split(',').map(Number);
    for (const [dq, dr] of DIRS) {
      const nk = key(q + dq, r + dr);
      if (LAND.has(terrain.get(nk)) && rng() < density) terrain.set(nk, 'urban');
    }
  }

  // 8) Réseau routier : relie villes, villages et bases par un arbre couvrant
  //    minimal (arêtes reliant les nœuds les plus proches). Chaque arête est
  //    tracée par un Dijkstra pondéré : la route préfère la plaine, contourne
  //    relief et eau (franchissables mais coûteux), et RÉUTILISE les routes déjà
  //    posées (coût quasi nul) → tronçons partagés, embranchements, tracé
  //    organique. Un bruit seedé donne le méandre.
  const SETTLE = (t) => t === 'town' || t === 'village' || t === 'base';
  const BASE_COST = { road: 0.2, plain: 1, plain2: 1, plateau: 1.4, forest: 2, hill: 3, mountain: 5, bank: 3, marsh: 4, river: 6 };
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
      if (!SETTLE(terrain.get(k)) && terrain.get(k) !== 'urban') terrain.set(k, 'road'); // n'écrase ni peuplements ni zones urbaines
    }
  }

  // Objectifs de victoire : posés indépendamment du terrain (ville et objectif
  // sont deux notions distinctes). Répartis sur la terre franchissable, hors
  // base et espacés les uns des autres — ils peuvent tomber sur n'importe quel
  // terrain, pas seulement une ville.
  const objectives = [];
  const objNear = (q, r) => objectives.some((k) => {
    const [oq, or] = k.split(',').map(Number);
    return (Math.abs(oq - q) + Math.abs(oq + or - q - r) + Math.abs(or - r)) / 2 < 4;
  });
  for (let placed = 0, tries = 0; placed < rint(4, 6) && tries < 2000; tries++) {
    const { q, r } = offsetToAxial(rint(1, COLS - 2), rint(1, ROWS - 2));
    const k = key(q, r);
    if (baseKeys.has(k) || !passable(k) || objNear(q, r)) continue;
    objectives.push(k);
    placed++;
  }
  return { terrain, hexes, objectives };
}

// Biome ARIDE : désert de sable et de dunes, oueds (lits asséchés serpentants),
// jebels rocheux (hamada, coteaux, quelques sommets), oasis (points d'eau =
// sources de ravitaillement ET objectifs naturels) et pistes reliant de rares
// peuplements. Tout y est FRANCHISSABLE (aucune barrière d'eau) → les bases sont
// toujours reliées. `fair` : peuplements sur maillage régulier.
function generateAride(seed = 1, { fair = false } = {}) {
  const rng = mulberry32(seed);
  const rint = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const terrain = new Map();
  const hexes = [];
  const K = (c, rw) => { const { q, r } = offsetToAxial(c, rw); return key(q, r); };
  const dist = (a, b) => { const [aq, ar] = a.split(',').map(Number), [bq, br] = b.split(',').map(Number); return hexDistance(aq, ar, bq, br); };

  // 1) Fond désertique.
  for (let c = 0; c < COLS; c++) {
    for (let rw = 0; rw < ROWS; rw++) { const { q, r } = offsetToAxial(c, rw); terrain.set(key(q, r), 'desert'); hexes.push({ q, r }); }
  }
  // Amas organique borné, ne recouvrant que les terrains autorisés.
  const grow = (c0, rw0, size, type, allow) => {
    const frontier = [K(c0, rw0)]; const seen = new Set(); let placed = 0;
    while (frontier.length && placed < size) {
      const k = frontier.splice(Math.floor(rng() * frontier.length), 1)[0];
      if (seen.has(k)) continue;
      seen.add(k);
      if (!terrain.has(k) || (allow && !allow(terrain.get(k)))) continue;
      terrain.set(k, type);
      placed++;
      const [q, r] = k.split(',').map(Number);
      for (const [dq, dr] of DIRS) frontier.push(key(q + dq, r + dr));
    }
  };
  const sand = (t) => t === 'desert' || t === 'dunes';

  // 2) Champs de dunes ; 3) hamada rocheuse et jebels (coteaux + sommets).
  for (let i = 0, n = rint(6, 10); i < n; i++) grow(rint(1, COLS - 2), rint(1, ROWS - 2), rint(6, 18), 'dunes', (t) => t === 'desert');
  for (let i = 0, n = rint(4, 7); i < n; i++) grow(rint(1, COLS - 2), rint(1, ROWS - 2), rint(4, 10), 'rough', sand);
  for (let i = 0, n = rint(2, 4); i < n; i++) { const c = rint(3, COLS - 4), rw = rint(3, ROWS - 4); grow(c, rw, rint(4, 9), 'hill', sand); grow(c, rw, rint(1, 3), 'mountain', (t) => t === 'hill'); }

  // 4) Oueds : lits asséchés serpentant (franchissables).
  for (let i = 0, n = rint(2, 4); i < n; i++) {
    let d = rint(0, 5); let { q, r } = offsetToAxial(rint(2, COLS - 3), rint(2, ROWS - 3));
    for (let s = 0, len = rint(6, 13); s < len; s++) {
      if (rng() < 0.3) d = (d + (rng() < 0.5 ? 1 : 5)) % 6;
      q += DIRS[d][0]; r += DIRS[d][1];
      if (!terrain.has(key(q, r))) break;
      terrain.set(key(q, r), 'wadi');
    }
  }

  // 5) Bases (priment sur tout).
  const baseKeys = new Set();
  for (const [c, rw] of Object.values(BASES)) { terrain.set(K(c, rw), 'base'); baseKeys.add(K(c, rw)); }

  // 6) Oasis : de préférence en bordure d'oued (résurgences). Espacées.
  const oasisKeys = [];
  const wadiCells = [...terrain].filter(([, t]) => t === 'wadi').map(([k]) => k);
  for (let i = 0, tries = 0, want = rint(3, 5); oasisKeys.length < want && tries < 400; tries++) {
    let k;
    if (wadiCells.length && rng() < 0.7) {
      const [q, r] = wadiCells[Math.floor(rng() * wadiCells.length)].split(',').map(Number);
      const [dq, dr] = DIRS[rint(0, 5)];
      k = key(q + dq, r + dr);
    } else k = K(rint(1, COLS - 2), rint(1, ROWS - 2));
    if (!terrain.has(k) || baseKeys.has(k) || oasisKeys.some((ok) => dist(ok, k) < 3)) continue;
    terrain.set(k, 'oasis'); oasisKeys.push(k);
  }

  // 7) Peuplements (villages, rares villes), espacés, hors base et oasis.
  const settleKeys = [];
  const trySettle = (c, rw, i) => {
    const k = K(c, rw);
    if (!['desert', 'dunes', 'rough'].includes(terrain.get(k)) || baseKeys.has(k)) return;
    if (settleKeys.some((s) => dist(s, k) < 3) || oasisKeys.some((o) => dist(o, k) < 2)) return;
    terrain.set(k, i % 4 === 0 ? 'town' : 'village'); settleKeys.push(k);
  };
  if (fair) {
    let ri = 0, i = 0;
    for (let rw = 3; rw <= ROWS - 3; rw += 4, ri++) { const shift = ri % 2 ? 3 : 0; for (let c = 3 + shift; c <= COLS - 3; c += 6) { trySettle(c, rw, i); i++; } }
  } else {
    for (let placed = 0, tries = 0, want = rint(5, 8); placed < want && tries < 1500; tries++) { const before = settleKeys.length; trySettle(rint(1, COLS - 2), rint(1, ROWS - 2), placed); if (settleKeys.length > before) placed++; }
  }

  // 8) Pistes : arbre couvrant reliant bases, peuplements et oasis. Chaque arête
  //    est tracée par une ligne d'hexes (glouton vers la cible → tracé contigu).
  const trail = (a, b) => {
    let q = a.q, r = a.r;
    for (let guard = 0; (q !== b.q || r !== b.r) && guard < 200; guard++) {
      let best = null;
      for (const [dq, dr] of DIRS) {
        const nq = q + dq, nr = r + dr;
        if (!terrain.has(key(nq, nr))) continue;
        const d = hexDistance(nq, nr, b.q, b.r);
        if (!best || d < best.d) best = { nq, nr, d };
      }
      if (!best) break;
      q = best.nq; r = best.nr;
      const t = terrain.get(key(q, r));
      if (t && !['base', 'town', 'village', 'oasis'].includes(t)) terrain.set(key(q, r), 'road');
    }
  };
  const nodes = [...baseKeys, ...settleKeys, ...oasisKeys].map((k) => { const [q, r] = k.split(',').map(Number); return { q, r }; });
  const inTree = new Set([0]);
  while (nodes.length > 1 && inTree.size < nodes.length) {
    let best = null;
    for (const i of inTree) for (let j = 0; j < nodes.length; j++) {
      if (inTree.has(j)) continue;
      const d = hexDistance(nodes[i].q, nodes[i].r, nodes[j].q, nodes[j].r);
      if (!best || d < best.d) best = { i, j, d };
    }
    inTree.add(best.j); trail(nodes[best.i], nodes[best.j]);
  }

  // 9) Objectifs : oasis en priorité (points d'eau vitaux), complétés au besoin
  //    sur terre franchissable, hors base et espacés.
  const objectives = [];
  const objNear = (q, r) => objectives.some((k) => { const [oq, or] = k.split(',').map(Number); return hexDistance(oq, or, q, r) < 4; });
  const want = rint(4, 6);
  for (const k of oasisKeys) { if (objectives.length >= want) break; const [q, r] = k.split(',').map(Number); if (!objNear(q, r)) objectives.push(k); }
  for (let tries = 0; objectives.length < want && tries < 2000; tries++) {
    const { q, r } = offsetToAxial(rint(1, COLS - 2), rint(1, ROWS - 2));
    const k = key(q, r);
    if (baseKeys.has(k) || TERRAIN[terrain.get(k)].cost === Infinity || objNear(q, r)) continue;
    objectives.push(k);
  }
  return { terrain, hexes, objectives };
}

// Construit une carte jouable à partir de données exportées par l'éditeur
// (`{ terrain: { "q,r": type }, objectives: ["q,r", …] }`). Mêmes sorties que
// `generateMap` : terrain, liste des hexes et objectifs. Les objectifs sont une
// liste explicite indépendante du terrain ; à défaut (anciennes cartes), on
// retombe sur les villes. Les bases priment (positions fixées par le moteur),
// garantissant les sources de ravitaillement de chaque camp.
export function loadMap(data) {
  const terrain = new Map();
  const hexes = [];
  for (const [k, t] of Object.entries(data.terrain ?? {})) {
    terrain.set(k, TERRAIN[t] ? t : 'plain');
    const [q, r] = k.split(',').map(Number);
    hexes.push({ q, r });
  }
  for (const [c, rw] of Object.values(BASES)) {
    const { q, r } = offsetToAxial(c, rw);
    terrain.set(key(q, r), 'base');
  }
  const objectives = Array.isArray(data.objectives)
    ? data.objectives.filter((k) => terrain.has(k))
    : [...terrain.entries()].filter(([, t]) => t === 'town').map(([k]) => k);
  return { terrain, hexes, objectives };
}
