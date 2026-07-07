// ===========================================================================
//  Générateur de cartes à THÈME (outil de développement, hors jeu).
//  Chaque thème produit une carte 30×20 reproductible (PRNG seedé) sérialisée
//  au format attendu par loadMap : { cols, rows, terrain: { "q,r": type },
//  objectives: ["q,r", …] }. Les fichiers sont écrits dans maps/ et enregistrés
//  dans maps/index.json.
//
//  Lancer :  node tools/gen-maps.js
//
//  Contraintes garanties par finalize() : terre jouable autour des deux bases
//  (déploiement), bases reliées par voie terrestre (percement au besoin),
//  objectifs espacés sur terre franchissable.
// ===========================================================================

import { writeFile } from 'node:fs/promises';
import { COLS, ROWS, BASES, DIRS, TERRAIN, SIZE } from '../src/config.js';
import { offsetToAxial, key, hexDistance, axialToPixel } from '../src/geometry.js';

// PRNG déterministe (mulberry32) — même seed → même carte.
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Clé axiale depuis des coordonnées offset (col, row) — même convention que le moteur.
const K = (c, rw) => { const { q, r } = offsetToAxial(c, rw); return key(q, r); };
const passable = (terrain, k) => { const t = terrain.get(k); return t && TERRAIN[t].cost !== Infinity; };
const isSettle = (t) => t === 'base' || t === 'town' || t === 'village';

// Ensemble des clés valides (grille complète) + carte initiale (plaine bicolore).
function blankMap(rng) {
  const terrain = new Map();
  const valid = new Set();
  for (let c = 0; c < COLS; c++) {
    for (let rw = 0; rw < ROWS; rw++) {
      const k = K(c, rw);
      valid.add(k);
      terrain.set(k, rng() < 0.5 ? 'plain' : 'plain2');
    }
  }
  return { terrain, valid };
}

// Amas organique : croît depuis un hexe de départ par agrégation de voisins,
// borné à `size`, ne recouvrant que les terrains autorisés par `allow`.
function grow(terrain, valid, rng, startKey, size, type, allow) {
  const frontier = [startKey];
  const seen = new Set();
  let placed = 0;
  while (frontier.length && placed < size) {
    const k = frontier.splice(Math.floor(rng() * frontier.length), 1)[0];
    if (seen.has(k)) continue;
    seen.add(k);
    if (!valid.has(k)) continue;
    if (allow && !allow(terrain.get(k))) continue;
    terrain.set(k, type);
    placed++;
    const [q, r] = k.split(',').map(Number);
    for (const [dq, dr] of DIRS) frontier.push(key(q + dq, r + dr));
  }
}

// Trace une route/digue en diagonale de a → b (coordonnées offset). Traverse
// l'eau si `overWater`. N'écrase jamais un peuplement ni une base.
function trail(terrain, aOff, bOff, { overWater = true } = {}) {
  let [c, rw] = aOff;
  const [tc, trw] = bOff;
  for (let guard = 0; (c !== tc || rw !== trw) && guard < 400; guard++) {
    if (c < tc) c++; else if (c > tc) c--;
    if (rw < trw) rw++; else if (rw > trw) rw--;
    const k = K(c, rw);
    const t = terrain.get(k);
    if (isSettle(t)) continue;
    if (t === 'river' && !overWater) continue;
    terrain.set(k, 'road');
  }
}

// Terre jouable au plus près de chaque base : convertit en plaine les hexes
// infranchissables à distance ≤ 2 (les unités se déploient au plus proche ;
// relocateOffWater gère le reliquat). Rayon volontairement serré pour laisser
// la mer approcher les côtes (têtes de pont, îles).
function ensureDeployLand(terrain) {
  for (const [c, rw] of Object.values(BASES)) {
    const base = offsetToAxial(c, rw);
    for (let cc = 0; cc < COLS; cc++) {
      for (let rr = 0; rr < ROWS; rr++) {
        const { q, r } = offsetToAxial(cc, rr);
        if (hexDistance(base.q, base.r, q, r) > 2) continue;
        const k = key(q, r);
        if (!isSettle(terrain.get(k)) && !passable(terrain, k)) terrain.set(k, 'plain');
      }
    }
  }
}

// Relie les deux bases par voie terrestre : tant qu'elles ne le sont pas, on
// convertit un hexe d'eau frontalier en route (percement minimal, cf. map.js §7).
function connectBases(terrain) {
  const bk = (s) => { const [c, rw] = BASES[s]; return K(c, rw); };
  for (let guard = 0; guard < 300; guard++) {
    const seen = new Set([bk('blue')]);
    const stack = [bk('blue')];
    while (stack.length) {
      const [q, r] = stack.pop().split(',').map(Number);
      for (const [dq, dr] of DIRS) {
        const nk = key(q + dq, r + dr);
        if (!seen.has(nk) && terrain.has(nk) && passable(terrain, nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    if (seen.has(bk('red'))) return;
    let crossing = null;
    for (const k of [...seen].sort()) {
      const [q, r] = k.split(',').map(Number);
      for (const [dq, dr] of DIRS) {
        if (terrain.get(key(q + dq, r + dr)) === 'river') { crossing = key(q + dq, r + dr); break; }
      }
      if (crossing) break;
    }
    if (!crossing) return;
    terrain.set(crossing, 'road');
  }
}

// Objectifs de victoire : hexes franchissables, hors bases, espacés entre eux et
// à l'écart des bases. `preferType` (optionnel) tente d'abord ce terrain (ex.
// 'mountain' pour poser les objectifs sur les sommets), avec repli sur tout terrain.
function placeObjectives(terrain, rng, n, preferType = null) {
  const baseKeys = Object.values(BASES).map(([c, rw]) => K(c, rw));
  const cells = [];
  for (let c = 0; c < COLS; c++) for (let rw = 0; rw < ROWS; rw++) cells.push([c, rw]);
  const objs = [];
  const far = (q, r, list, d) => list.every((k) => {
    const [aq, ar] = k.split(',').map(Number);
    return hexDistance(aq, ar, q, r) >= d;
  });
  const pass = (want) => {
    for (let tries = 0; objs.length < n && tries < 8000; tries++) {
      const [c, rw] = cells[Math.floor(rng() * cells.length)];
      const k = K(c, rw);
      if (!passable(terrain, k)) continue;
      if (want && terrain.get(k) !== want) continue;
      const [q, r] = k.split(',').map(Number);
      if (!far(q, r, baseKeys, 4) || !far(q, r, objs, 4)) continue;
      objs.push(k);
    }
  };
  if (preferType) pass(preferType);
  pass(null);
  return objs;
}

// Anneau autour d'une base (barrière naturelle) : pose `type` sur les hexes à
// distance `radius`, en laissant `nGaps` ouvertures (percées) réparties, où l'on
// pose `gapType` à la place. Sert aux têtes de pont (river/road) et aux poches
// (hill/plain).
function arc(terrain, baseOff, radius, type, nGaps, gapType) {
  const base = offsetToAxial(...baseOff);
  const bp = axialToPixel(base.q, base.r);
  const ring = [];
  for (let c = 0; c < COLS; c++) {
    for (let rw = 0; rw < ROWS; rw++) {
      const { q, r } = offsetToAxial(c, rw);
      if (hexDistance(base.q, base.r, q, r) !== radius) continue;
      const p = axialToPixel(q, r);
      ring.push({ k: key(q, r), a: Math.atan2(p.y - bp.y, p.x - bp.x) });
    }
  }
  ring.sort((x, y) => x.a - y.a);
  const gaps = new Set();
  for (let g = 0; g < nGaps; g++) {
    const center = Math.floor((ring.length * (g + 0.5)) / nGaps);
    for (let d = -1; d <= 1; d++) gaps.add((center + d + ring.length) % ring.length);
  }
  ring.forEach((cell, i) => {
    if (isSettle(terrain.get(cell.k))) return;
    terrain.set(cell.k, gaps.has(i) ? gapType : type);
  });
}

// Pose les bases, garantit terre de déploiement, connexité et objectifs.
function finalize(terrain, rng, nObj = 5, preferType = null) {
  for (const [c, rw] of Object.values(BASES)) terrain.set(K(c, rw), 'base');
  ensureDeployLand(terrain);
  connectBases(terrain);
  const objectives = placeObjectives(terrain, rng, nObj, preferType);
  return { terrain, objectives };
}

// ---------------------------------------------------------------------------
//  Thèmes
// ---------------------------------------------------------------------------

// La Grande Forêt : couvert forestier dense percé de clairières, rivières
// franchissables par des gués, quelques coteaux, sentiers reliant les bases.
function greatForest(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  // Deux rivières sinueuses (traits fins) avec quelques gués.
  for (let i = 0; i < 2; i++) {
    let c = 4 + Math.floor(rng() * (COLS - 8));
    let rw = 0;
    for (; rw < ROWS; rw++) {
      terrain.set(K(c, rw), 'river');
      if (rng() < 0.5) c += rng() < 0.5 ? -1 : 1;
      c = Math.max(1, Math.min(COLS - 2, c));
    }
  }
  // Couvert forestier : nombreux amas larges sur la plaine.
  for (let i = 0; i < 26; i++) {
    grow(terrain, valid, rng, K(1 + Math.floor(rng() * (COLS - 2)), 1 + Math.floor(rng() * (ROWS - 2))),
      6 + Math.floor(rng() * 16), 'forest', (t) => t === 'plain' || t === 'plain2');
  }
  // Quelques coteaux boisés.
  for (let i = 0; i < 5; i++) {
    grow(terrain, valid, rng, K(2 + Math.floor(rng() * (COLS - 4)), 2 + Math.floor(rng() * (ROWS - 4))),
      3 + Math.floor(rng() * 5), 'hill', (t) => t === 'forest' || t === 'plain' || t === 'plain2');
  }
  // Clairières habitées : villages dans une trouée de plaine.
  const clearings = [[8, 5], [15, 12], [22, 6], [12, 16], [20, 15]];
  clearings.forEach(([c, rw], i) => {
    grow(terrain, valid, rng, K(c, rw), 4, 'plain', (t) => t === 'forest');
    terrain.set(K(c, rw), i % 3 === 0 ? 'town' : 'village');
  });
  // Sentiers : gués sur les rivières et liaison des bases aux clairières.
  trail(terrain, BASES.blue, [12, 16], { overWater: true });
  trail(terrain, [12, 16], [15, 12], { overWater: true });
  trail(terrain, [15, 12], BASES.red, { overWater: true });
  return finalize(terrain, rng, 5);
}

// Le Débarquement : mer dans l'angle bas-gauche, plage (berges) et zones
// inondées (marais), bocage épars, hauteurs et ville fortifiée à l'intérieur.
function dDay(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  // Mer : bande sud à rivage ondulant (la tête de pont bleue dans l'angle bas-
  // gauche sera dégagée par finalize, formant une plage isolée). Le camp rouge
  // (haut-droite) reste sur les terres hautes.
  for (let c = 0; c < COLS; c++) {
    const shore = 16 + (rng() < 0.5 ? 0 : 1) + Math.round(Math.sin(c * 0.7) * 0.6);
    for (let rw = shore; rw < ROWS; rw++) terrain.set(K(c, rw), 'river');
  }
  // Plage & marais : liseré terre/mer.
  for (const [k, t] of [...terrain]) {
    if (t !== 'river') continue;
    const [q, r] = k.split(',').map(Number);
    for (const [dq, dr] of DIRS) {
      const nk = key(q + dq, r + dr);
      const nt = terrain.get(nk);
      if (nt !== 'plain' && nt !== 'plain2') continue;
      const roll = rng();
      if (roll < 0.55) terrain.set(nk, 'bank');
      else if (roll < 0.75) terrain.set(nk, 'marsh');
    }
  }
  // Bocage : petits bosquets-haies au centre.
  for (let i = 0; i < 14; i++) {
    grow(terrain, valid, rng, K(6 + Math.floor(rng() * (COLS - 10)), 4 + Math.floor(rng() * (ROWS - 6))),
      2 + Math.floor(rng() * 4), 'forest', (t) => t === 'plain' || t === 'plain2');
  }
  // Hauteurs tenues à l'intérieur (côté rouge) + ville fortifiée (objectif exit).
  for (let i = 0; i < 4; i++) {
    grow(terrain, valid, rng, K(18 + Math.floor(rng() * 8), 2 + Math.floor(rng() * 8)),
      4 + Math.floor(rng() * 5), 'hill', (t) => t === 'plain' || t === 'plain2' || t === 'forest');
  }
  terrain.set(K(21, 9), 'town');
  terrain.set(K(14, 13), 'village');
  // Routes de sortie de plage vers l'intérieur.
  trail(terrain, BASES.blue, [14, 13], { overWater: false });
  trail(terrain, [14, 13], [21, 9], { overWater: false });
  trail(terrain, [21, 9], BASES.red, { overWater: false });
  return finalize(terrain, rng, 5);
}

// L'Archipel : mer parsemée d'îles reliées par des digues (goulots). Les deux
// bases occupent les grandes îles opposées.
function archipelago(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  for (const k of valid) terrain.set(k, 'river'); // tout en mer
  // Îles : centres semés, la première bas-gauche (bleu), la dernière haut-droite (rouge).
  const centers = [[3, 16], [9, 12], [15, 15], [14, 7], [8, 4], [21, 10], [24, 4], [27, 3]];
  centers.forEach(([c, rw], i) => {
    grow(terrain, valid, rng, K(c, rw), 10 + Math.floor(rng() * 12), 'plain', (t) => t === 'river');
    // relief sur l'île
    grow(terrain, valid, rng, K(c, rw), 3 + Math.floor(rng() * 4), i % 2 ? 'hill' : 'forest',
      (t) => t === 'plain' || t === 'plain2');
    if (i === 2 || i === 5) terrain.set(K(c, rw), 'town');
    else if (i % 2 === 0) terrain.set(K(c, rw), 'village');
  });
  // Digues : chaîne d'îles reliée de la base bleue à la base rouge.
  const chain = [BASES.blue, [9, 12], [15, 15], [21, 10], [24, 4], BASES.red];
  for (let i = 0; i < chain.length - 1; i++) trail(terrain, chain[i], chain[i + 1], { overWater: true });
  return finalize(terrain, rng, 5);
}

// Le Col : barrière de montagnes et plateaux en travers de la carte, percée de
// passes (goulots en plaine/route). Bases dans les basses terres opposées.
function mountainPass(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  // Crête diagonale : colonne charnière variable selon la ligne.
  const passes = new Set([5, 13]); // lignes laissées en passe
  for (let rw = 0; rw < ROWS; rw++) {
    const spine = 6 + Math.round((rw / (ROWS - 1)) * (COLS - 12)) + (rng() < 0.5 ? -1 : 0);
    for (let d = -2; d <= 2; d++) {
      const c = spine + d;
      if (c < 1 || c >= COLS - 1) continue;
      if (passes.has(rw) && Math.abs(d) <= 1) continue; // trouée franchissable
      const type = Math.abs(d) <= 1 ? 'mountain' : 'plateau';
      terrain.set(K(c, rw), type);
    }
  }
  // Plateaux d'assise au pied du massif.
  for (let i = 0; i < 6; i++) {
    grow(terrain, valid, rng, K(4 + Math.floor(rng() * (COLS - 8)), 2 + Math.floor(rng() * (ROWS - 4))),
      3 + Math.floor(rng() * 4), 'plateau', (t) => t === 'plain' || t === 'plain2');
  }
  // Bois épars dans les vallées.
  for (let i = 0; i < 8; i++) {
    grow(terrain, valid, rng, K(2 + Math.floor(rng() * (COLS - 4)), 2 + Math.floor(rng() * (ROWS - 4))),
      3 + Math.floor(rng() * 4), 'forest', (t) => t === 'plain' || t === 'plain2');
  }
  // Villages de vallée + routes par les passes.
  terrain.set(K(7, 5), 'village');
  terrain.set(K(22, 13), 'village');
  trail(terrain, BASES.blue, [10, 13], { overWater: false });  // vers la passe basse
  trail(terrain, [10, 13], [18, 5], { overWater: false });     // vers la passe haute
  trail(terrain, [18, 5], BASES.red, { overWater: false });
  return finalize(terrain, rng, 5);
}

// Le Défilé fluvial : un large fleuve en travers, franchissable seulement par
// 2-3 ponts → bataille pour les têtes de pont.
function riverDefile(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  // Fleuve vertical épais (2-3 hexes), au tracé ondulant.
  let c = 14;
  const bridges = [];
  for (let rw = 0; rw < ROWS; rw++) {
    for (let w = 0; w <= 1 + (rng() < 0.5 ? 1 : 0); w++) terrain.set(K(c + w, rw), 'river');
    if (rng() < 0.5) c += rng() < 0.5 ? -1 : 1;
    c = Math.max(6, Math.min(COLS - 8, c));
    bridges.push(c);
  }
  // 3 ponts (routes) traversant toute la largeur du fleuve, échelonnés.
  for (const rw of [3, 10, 16]) {
    for (let w = -1; w <= 2; w++) { const k = K(bridges[rw] + w, rw); if (terrain.get(k) === 'river') terrain.set(k, 'road'); }
  }
  // Reliefs de rive (têtes de pont défendables) et bois.
  for (let i = 0; i < 5; i++) grow(terrain, valid, rng, K(4 + Math.floor(rng() * (COLS - 8)), 2 + Math.floor(rng() * (ROWS - 4))), 4, 'hill', (t) => t === 'plain' || t === 'plain2');
  for (let i = 0; i < 8; i++) grow(terrain, valid, rng, K(2 + Math.floor(rng() * (COLS - 4)), 2 + Math.floor(rng() * (ROWS - 4))), 4, 'forest', (t) => t === 'plain' || t === 'plain2');
  trail(terrain, BASES.blue, [14, 10], { overWater: true });
  trail(terrain, [14, 10], BASES.red, { overWater: true });
  return finalize(terrain, rng, 5);
}

// La Trouée (Fulda) : deux massifs encadrant un couloir de plaine diagonal reliant
// les bases → tout passe par le milieu.
function theGap(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  const a = offsetToAxial(...BASES.blue), b = offsetToAxial(...BASES.red);
  const pa = axialToPixel(a.q, a.r), pb = axialToPixel(b.q, b.r);
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  for (let c = 0; c < COLS; c++) {
    for (let rw = 0; rw < ROWS; rw++) {
      const { q, r } = offsetToAxial(c, rw);
      const p = axialToPixel(q, r);
      // Distance perpendiculaire au couloir base→base.
      const dist = Math.abs((pb.x - pa.x) * (pa.y - p.y) - (pa.x - p.x) * (pb.y - pa.y)) / len;
      const band = dist / SIZE;
      if (band > 9) terrain.set(K(c, rw), 'mountain');
      else if (band > 5.5) terrain.set(K(c, rw), rng() < 0.6 ? 'plateau' : 'hill');
    }
  }
  // Quelques bois et un village dans le couloir pour l'intérêt tactique.
  for (let i = 0; i < 5; i++) grow(terrain, valid, rng, K(6 + Math.floor(rng() * (COLS - 12)), 4 + Math.floor(rng() * (ROWS - 8))), 3, 'forest', (t) => t === 'plain' || t === 'plain2');
  terrain.set(K(14, 10), 'village');
  trail(terrain, BASES.blue, BASES.red, { overWater: false });
  return finalize(terrain, rng, 5);
}

// La Forteresse : une grande ville tentaculaire au centre (ville + zone urbaine
// dense), à prendre et tenir → combat urbain, défense partout.
function fortress(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  // Cœur urbain dense autour du centre.
  grow(terrain, valid, rng, K(14, 10), 34, 'urban', (t) => t === 'plain' || t === 'plain2');
  // Noyaux bâtis (villes/objectifs) dans la nappe urbaine.
  for (const [c, rw] of [[14, 10], [12, 8], [16, 12], [15, 7], [11, 12]]) terrain.set(K(c, rw), 'town');
  // Faubourgs urbains autour des villes.
  for (const [k, t] of [...terrain]) {
    if (t !== 'town') continue;
    const [q, r] = k.split(',').map(Number);
    for (const [dq, dr] of DIRS) { const nk = key(q + dq, r + dr); if (terrain.get(nk) === 'plain' || terrain.get(nk) === 'plain2') terrain.set(nk, 'urban'); }
  }
  // Approches : quelques bois et coteaux, routes rayonnant vers la ville.
  for (let i = 0; i < 6; i++) grow(terrain, valid, rng, K(3 + Math.floor(rng() * (COLS - 6)), 2 + Math.floor(rng() * (ROWS - 4))), 4, 'forest', (t) => t === 'plain' || t === 'plain2');
  for (let i = 0; i < 3; i++) grow(terrain, valid, rng, K(3 + Math.floor(rng() * (COLS - 6)), 2 + Math.floor(rng() * (ROWS - 4))), 4, 'hill', (t) => t === 'plain' || t === 'plain2');
  trail(terrain, BASES.blue, [14, 10], { overWater: false });
  trail(terrain, [14, 10], BASES.red, { overWater: false });
  return finalize(terrain, rng, 5);
}

// La Steppe : quasi tout plaine, très peu de couvert → guerre de mouvement,
// les blindés dominent, peu d'abris.
function steppe(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  // Rares reliefs isolés et bosquets.
  for (let i = 0; i < 3; i++) grow(terrain, valid, rng, K(4 + Math.floor(rng() * (COLS - 8)), 3 + Math.floor(rng() * (ROWS - 6))), 3, 'hill', (t) => t === 'plain' || t === 'plain2');
  for (let i = 0; i < 3; i++) grow(terrain, valid, rng, K(4 + Math.floor(rng() * (COLS - 8)), 3 + Math.floor(rng() * (ROWS - 6))), 2, 'forest', (t) => t === 'plain' || t === 'plain2');
  terrain.set(K(10, 8), 'village');
  terrain.set(K(19, 11), 'village');
  trail(terrain, BASES.blue, BASES.red, { overWater: false });
  return finalize(terrain, rng, 6);
}

// Le Bocage : damier serré de petits bois-haies (coût 2, +déf) → progression
// lente, embuscades. L'inverse de la steppe.
function bocage(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  // Semis régulier de bosquets (haies) sur toute la carte.
  for (let c = 2; c < COLS - 1; c += 2) {
    for (let rw = 2; rw < ROWS - 1; rw += 2) {
      if (rng() < 0.75) grow(terrain, valid, rng, K(c + (rng() < 0.5 ? 0 : 1), rw), 1 + Math.floor(rng() * 3), 'forest', (t) => t === 'plain' || t === 'plain2');
    }
  }
  // Chemins creux (routes) et hameaux.
  terrain.set(K(9, 6), 'village');
  terrain.set(K(20, 13), 'village');
  trail(terrain, BASES.blue, [9, 6], { overWater: false });
  trail(terrain, [9, 6], [20, 13], { overWater: false });
  trail(terrain, [20, 13], BASES.red, { overWater: false });
  return finalize(terrain, rng, 5);
}

// Le Marais (Pripet) : vastes marais et rivières, étroites langues de terre ferme
// (routes-digues) → mouvement pénible, défense exposée.
function marshland(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  // Grands amas de marais recouvrant l'essentiel de la plaine.
  for (let i = 0; i < 11; i++) grow(terrain, valid, rng, K(2 + Math.floor(rng() * (COLS - 4)), 2 + Math.floor(rng() * (ROWS - 4))), 20 + Math.floor(rng() * 24), 'marsh', (t) => t === 'plain' || t === 'plain2');
  // Rivières serpentant dans les marais.
  for (let i = 0; i < 3; i++) {
    let c = 3 + Math.floor(rng() * (COLS - 6)), rw = 0;
    for (; rw < ROWS; rw++) { terrain.set(K(c, rw), 'river'); if (rng() < 0.5) c += rng() < 0.5 ? -1 : 1; c = Math.max(1, Math.min(COLS - 2, c)); }
  }
  // Îlots de terre ferme habités.
  for (const [c, rw] of [[8, 6], [15, 11], [21, 7]]) { grow(terrain, valid, rng, K(c, rw), 4, 'plain', (t) => t === 'marsh'); terrain.set(K(c, rw), 'village'); }
  // Digues (routes) reliant les bases par la terre ferme.
  trail(terrain, BASES.blue, [8, 6], { overWater: true });
  trail(terrain, [8, 6], [15, 11], { overWater: true });
  trail(terrain, [15, 11], [21, 7], { overWater: true });
  trail(terrain, [21, 7], BASES.red, { overWater: true });
  return finalize(terrain, rng, 5);
}

// Le Massif : montagnes et plateaux dominants, vallées étroites, sommets = clés
// de victoire (objectifs posés en altitude).
function massif(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  // Grands massifs (montagne cernée de plateau).
  for (const [c, rw] of [[9, 6], [14, 13], [20, 8], [23, 14], [7, 14]]) {
    grow(terrain, valid, rng, K(c, rw), 12 + Math.floor(rng() * 12), 'mountain', (t) => t === 'plain' || t === 'plain2');
    grow(terrain, valid, rng, K(c, rw), 8 + Math.floor(rng() * 8), 'plateau', (t) => t === 'plain' || t === 'plain2');
  }
  // Bois dans les vallées.
  for (let i = 0; i < 6; i++) grow(terrain, valid, rng, K(3 + Math.floor(rng() * (COLS - 6)), 2 + Math.floor(rng() * (ROWS - 4))), 3, 'forest', (t) => t === 'plain' || t === 'plain2');
  // Routes de vallée reliant les bases.
  trail(terrain, BASES.blue, [12, 10], { overWater: false });
  trail(terrain, [12, 10], BASES.red, { overWater: false });
  return finalize(terrain, rng, 5, 'mountain');
}

// Les Cols jumeaux : muraille montagneuse en travers, percée de DEUX passes
// éloignées → il faut choisir/diviser son axe d'effort.
function twinPasses(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  const passes = new Set([4, 15]); // lignes des deux passes
  for (let rw = 0; rw < ROWS; rw++) {
    const spine = 15 + (rng() < 0.5 ? -1 : 0);
    for (let d = -2; d <= 2; d++) {
      const c = spine + d;
      if (c < 1 || c >= COLS - 1) continue;
      const nearPass = [...passes].some((pr) => Math.abs(rw - pr) <= 1);
      if (nearPass && Math.abs(d) <= 1) continue; // trouée franchissable
      terrain.set(K(c, rw), Math.abs(d) <= 1 ? 'mountain' : 'plateau');
    }
  }
  for (let i = 0; i < 6; i++) grow(terrain, valid, rng, K(2 + Math.floor(rng() * (COLS - 4)), 2 + Math.floor(rng() * (ROWS - 4))), 3, 'forest', (t) => t === 'plain' || t === 'plain2');
  // Routes vers les deux passes.
  trail(terrain, BASES.blue, [15, 15], { overWater: false });
  trail(terrain, [15, 15], BASES.red, { overWater: false });
  trail(terrain, BASES.blue, [15, 4], { overWater: false });
  trail(terrain, [15, 4], BASES.red, { overWater: false });
  return finalize(terrain, rng, 6);
}

// La Poche : le camp bleu est enfermé dans un réduit (anneau de reliefs à deux
// brèches) et doit percer vers les objectifs autour ; le rouge resserre l'étau.
function pocket(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  // Anneau de coteaux/bois autour de la base bleue, avec deux percées.
  arc(terrain, BASES.blue, 5, 'hill', 2, 'plain');
  arc(terrain, BASES.blue, 6, 'forest', 2, 'plain');
  // Terrain ouvert au-delà, tenu par le rouge, quelques reliefs d'appui.
  for (let i = 0; i < 5; i++) grow(terrain, valid, rng, K(12 + Math.floor(rng() * (COLS - 14)), 2 + Math.floor(rng() * (ROWS - 4))), 4, 'hill', (t) => t === 'plain' || t === 'plain2');
  for (let i = 0; i < 6; i++) grow(terrain, valid, rng, K(8 + Math.floor(rng() * (COLS - 10)), 2 + Math.floor(rng() * (ROWS - 4))), 3, 'forest', (t) => t === 'plain' || t === 'plain2');
  trail(terrain, BASES.blue, [10, 10], { overWater: false });
  trail(terrain, [10, 10], BASES.red, { overWater: false });
  return finalize(terrain, rng, 5);
}

// La Tête de pont fluviale : le camp bleu a franchi et tient un réduit ceint d'un
// fleuve (deux ponts dans son dos) qu'il doit élargir vers le rouge.
function bridgehead(seed) {
  const rng = mulberry32(seed);
  const { terrain, valid } = blankMap(rng);
  // Fleuve épais en arc de cercle isolant la tête de pont bleue, percé de 2 ponts.
  for (const radius of [4, 5, 6]) arc(terrain, BASES.blue, radius, 'river', 2, 'road');
  // Au-delà du fleuve : terrain contesté, reliefs et bois tenus par le rouge.
  for (let i = 0; i < 5; i++) grow(terrain, valid, rng, K(12 + Math.floor(rng() * (COLS - 14)), 2 + Math.floor(rng() * (ROWS - 4))), 4, 'hill', (t) => t === 'plain' || t === 'plain2');
  for (let i = 0; i < 7; i++) grow(terrain, valid, rng, K(8 + Math.floor(rng() * (COLS - 10)), 2 + Math.floor(rng() * (ROWS - 4))), 3, 'forest', (t) => t === 'plain' || t === 'plain2');
  terrain.set(K(18, 8), 'village');
  trail(terrain, BASES.blue, [18, 8], { overWater: true });
  trail(terrain, [18, 8], BASES.red, { overWater: false });
  return finalize(terrain, rng, 5);
}

// ---------------------------------------------------------------------------
//  Sérialisation & écriture
// ---------------------------------------------------------------------------

function serialize({ terrain, objectives }) {
  const out = {};
  for (let c = 0; c < COLS; c++) {
    for (let rw = 0; rw < ROWS; rw++) { const k = K(c, rw); out[k] = terrain.get(k) ?? 'plain'; }
  }
  return JSON.stringify({ cols: COLS, rows: ROWS, terrain: out, objectives }, null, 2) + '\n';
}

const THEMES = [
  { file: 'grande-foret', name: 'La Grande Forêt', gen: greatForest, seed: 101 },
  { file: 'debarquement', name: 'Le Débarquement', gen: dDay, seed: 202 },
  { file: 'archipel', name: "L'Archipel", gen: archipelago, seed: 303 },
  { file: 'col', name: 'Le Col', gen: mountainPass, seed: 404 },
  { file: 'defile-fluvial', name: 'Le Défilé fluvial', gen: riverDefile, seed: 505 },
  { file: 'trouee', name: 'La Trouée', gen: theGap, seed: 606 },
  { file: 'forteresse', name: 'La Forteresse', gen: fortress, seed: 707 },
  { file: 'steppe', name: 'La Steppe', gen: steppe, seed: 808 },
  { file: 'bocage', name: 'Le Bocage', gen: bocage, seed: 909 },
  { file: 'marais', name: 'Le Marais', gen: marshland, seed: 1010 },
  { file: 'massif', name: 'Le Massif', gen: massif, seed: 1111 },
  { file: 'cols-jumeaux', name: 'Les Cols jumeaux', gen: twinPasses, seed: 1212 },
  { file: 'poche', name: 'La Poche', gen: pocket, seed: 1313 },
  { file: 'tete-de-pont', name: 'La Tête de pont fluviale', gen: bridgehead, seed: 1414 },
];

const dir = new URL('../maps/', import.meta.url);
const index = [{ file: 'angers', name: 'Angers' }];
for (const t of THEMES) {
  const map = t.gen(t.seed);
  await writeFile(new URL(`${t.file}.json`, dir), serialize(map));
  index.push({ file: t.file, name: t.name });
  console.log(`✓ ${t.name} → maps/${t.file}.json (${map.objectives.length} objectifs)`);
}
await writeFile(new URL('index.json', dir), JSON.stringify(index, null, 2) + '\n');
console.log(`✓ maps/index.json (${index.length} cartes)`);
