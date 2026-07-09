// ===========================================================================
//  Plateau statique : tuiles de terrain, décors vectoriels, camps de base et
//  couche « stats » (heatmap PM/défense). Construit une fois à l'init, puis
//  rasterisé — le terrain ne change jamais en cours de partie.
// ===========================================================================

import { TERRAIN, BASES, DIRS, SIZE, SQRT3 } from '../src/config.js';
import { key, axialToPixel, offsetToAxial, hexCorners } from '../src/geometry.js';
import { FILL, DIR_TO_EDGE, UPPER_EDGES, LOWER_EDGES, strokeEdge, lerpColor } from './gfx.js';

const PIXI = window.PIXI;

// Tuiles de terrain (dossier assets/). Un terrain sans texture (route) reste
// tracé en vectoriel. Les pions, eux, restent entièrement vectoriels.
// URL résolue depuis ce module (import.meta) : robuste à l'URL propre /game
// et à un déploiement en sous-dossier.
const asset = (f) => new URL(`../assets/${f}`, import.meta.url).href;
const TERRAIN_TILES = ['plain', 'plain2', 'bank', 'river'];
// Variantes de forêt (type 'forest') : purement visuelles, pour varier les
// environnements. Une variante est choisie par hex de façon déterministe.
const FOREST_TILES = ['foret-deep', 'foret-dense', 'foret-grove'];
const FOREST_WEIGHTS = [1, 3, 2]; // deep raréfié au profit de dense
const FOREST_TOTAL = FOREST_WEIGHTS.reduce((a, b) => a + b, 0);
// Bruit 0..1 déterministe par hexe (salt s : plusieurs tirages indépendants).
const hash01 = (q, r, s = 0) => {
  const n = Math.sin(q * 91.7 + r * 47.3 + s * 13.131) * 43758.5453;
  return n - Math.floor(n);
};
const forestPick = (q, r) => {
  let t = hash01(q, r) * FOREST_TOTAL;
  for (let i = 0; i < FOREST_WEIGHTS.length; i++) if ((t -= FOREST_WEIGHTS[i]) < 0) return i;
  return FOREST_WEIGHTS.length - 1;
};

// Tissu urbain façon plan de ville : le fond clair de l'hexe fait office de
// voirie ; on pose dessus des ÎLOTS (pâtés de maisons) gris pâle aux liserés
// discrets, quelques bâtiments notables plus sombres, puis les axes blancs
// vers les hexes voisins. Quatre trames — grille orthogonale, tissu radial,
// boulevards obliques, place centrale — tournées et perturbées par hexe :
// deux hexes ne se ressemblent jamais. Purement visuel, aucune règle ici.
const URBAN_VARIANTS = [
  { blocks: [ // damier : quatre gros îlots réguliers
    [-26, -26, -2, -26, -2, -2, -26, -2],
    [2, -26, 26, -26, 26, -2, 2, -2],
    [-26, 2, -2, 2, -2, 26, -26, 26],
    [2, 2, 26, 2, 26, 26, 2, 26],
  ] },
  { blocks: [ // rangées décalées : deux gros îlots au nord, trois au sud
    [-26, -26, -2, -26, -2, -2, -26, -2],
    [2, -26, 26, -26, 26, -2, 2, -2],
    [-26, 2, -11, 2, -11, 26, -26, 26],
    [-7, 2, 7, 2, 7, 26, -7, 26],
    [11, 2, 26, 2, 26, 26, 11, 26],
  ] },
  { blocks: [ // boulevards : bandes traversantes parallèles
    [-26, -26, 26, -26, 26, -10, -26, -10],
    [-26, -6, 4, -6, 4, 6, -26, 6],
    [8, -6, 26, -6, 26, 6, 8, 6],
    [-26, 10, 26, 10, 26, 26, -26, 26],
  ] },
  { square: true, blocks: [ // place centrale dégagée, îlots en couronne
    [-26, -26, 26, -26, 26, -11, -26, -11],
    [-26, -7, -9, -7, -9, 26, -26, 26],
    [9, -7, 26, -7, 26, 26, 9, 26],
    [-5, 11, 5, 11, 5, 26, -5, 26],
  ] },
];
const URBAN_BLOCK = { fill: 0xaaa9a3, stroke: { width: 0.8, color: 0x908f8a, alpha: 0.8 } };
const URBAN_BLD = { fill: 0x8b8a85, stroke: { width: 0.7, color: 0x74736d, alpha: 0.9 } };
const URBAN_STREET = { width: 2.4, color: 0xdeddd8, alpha: 0.9 };

// Dessine le plan de ville d'un hexe : îlots de la trame (sommets gigués),
// bâtiments notables posés dessus, puis axes vers les bords reliés (voisins
// bâtis ou routiers) — les avenues découpent le tissu, comme sur un plan.
function drawUrban(g, x, y, q, r, mids) {
  const A = (hash01(q, r, 9) - 0.5) * 0.6; // orientation du quartier (±17°)
  const cosA = Math.cos(A), sinA = Math.sin(A);
  const at = (px, py) => [x + px * cosA - py * sinA, y + px * sinA + py * cosA];
  const v = URBAN_VARIANTS[Math.floor(hash01(q, r, 5) * URBAN_VARIANTS.length)];
  v.blocks.forEach((poly, i) => {
    const pts = [];
    for (let j = 0; j < poly.length; j += 2) {
      const jx = (hash01(q, r, 20 + i * 8 + j) - 0.5) * 2.4;
      const jy = (hash01(q, r, 60 + i * 8 + j) - 0.5) * 2.4;
      pts.push(...at(poly[j] + jx, poly[j + 1] + jy));
    }
    g.poly(pts).fill(URBAN_BLOCK.fill).stroke(URBAN_BLOCK.stroke);
  });
  // Bâtiments notables : 2-3 rectangles plus soutenus, posés sur des îlots.
  const nb = 2 + Math.floor(hash01(q, r, 12) * 2);
  for (let k = 0; k < nb; k++) {
    const poly = v.blocks[Math.floor(hash01(q, r, 130 + k) * v.blocks.length)];
    let cx = 0, cy = 0;
    for (let j = 0; j < poly.length; j += 2) { cx += poly[j]; cy += poly[j + 1]; }
    cx = cx / (poly.length / 2) + (hash01(q, r, 150 + k) - 0.5) * 4;
    cy = cy / (poly.length / 2) + (hash01(q, r, 170 + k) - 0.5) * 4;
    const w = 4.5 + hash01(q, r, 190 + k) * 3, h = 4 + hash01(q, r, 210 + k) * 3;
    const pts = [];
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push(...at(cx + (sx * w) / 2, cy + (sy * h) / 2));
    g.poly(pts).fill(URBAN_BLD.fill).stroke(URBAN_BLD.stroke);
  }
  // Axes principaux : rues blanches vers les bords reliés ; isolé → ruelle.
  for (const m of mids) g.moveTo(x, y).lineTo(m.x, m.y).stroke(URBAN_STREET);
  if (!mids.length) {
    const [ax, ay] = at(-26, 17), [bx, by] = at(26, -17);
    g.moveTo(ax, ay).lineTo(bx, by).stroke(URBAN_STREET);
  }
  if (v.square) { // la place est le fond dégagé au centre ; son monument
    const [sx, sy] = at(0, 0);
    g.circle(sx, sy, 1.8).fill(0x6f6e69);
  }
}

// Étagement d'altitude (palier par type de terrain) → teinte hypsométrique
// et courbes de niveau, à la manière d'une carte topographique. Palette
// sombre : vert foncé dans les bas-fonds → gris-vert → gris pierre en altitude.
// Purement visuel : aucune règle ne dépend de ces valeurs.
const ELEV = { river: 0, bank: 0, beach: 1, marsh: 1, wadi: 1, plain: 2, plain2: 2, desert: 2, dunes: 2, oasis: 2, snow: 2, forest: 2, road: 2, town: 2, village: 2, urban: 2, ruins: 2, base: 2, plateau: 3, rough: 3, hill: 4, mountain: 5 };
const WATER_R = new Set(['river', 'bank']);
const bandNoise = (q, r) => { // 0..1 déterministe, deux fréquences
  const a = Math.sin(q * 12.9898 + r * 78.233) * 43758.5453;
  const b = Math.sin(q * 39.3468 - r * 11.135) * 24634.6345;
  return (a - Math.floor(a)) * 0.6 + (b - Math.floor(b)) * 0.4;
};
const ELEV_RAMP = [[0, 0x2f3a2a], [0.3, 0x445040], [0.55, 0x666b5e], [0.78, 0x808079], [1, 0x9a9a95]];
const elevColor = (a) => {
  a = Math.max(0, Math.min(1, a));
  for (let i = 1; i < ELEV_RAMP.length; i++) {
    if (a <= ELEV_RAMP[i][0]) {
      const [a0, c0] = ELEV_RAMP[i - 1], [a1, c1] = ELEV_RAMP[i];
      return lerpColor(c0, c1, (a - a0) / (a1 - a0));
    }
  }
  return ELEV_RAMP[ELEV_RAMP.length - 1][1];
};

// Échelle de défense −1..+3 → rouge → jaune → vert (couche stats).
const defColor = (d) => {
  const t = Math.max(0, Math.min(1, (d + 1) / 4));
  return t < 0.5 ? lerpColor(0xd23b2b, 0xd9c04a, t / 0.5) : lerpColor(0xd9c04a, 0x3f8f3a, (t - 0.5) / 0.5);
};
const statLabel = (s, sz) => {
  const t = new PIXI.Text({ text: s, style: { fontFamily: 'Arial', fontSize: sz, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x0c0f08, width: 3 } } });
  t.anchor.set(0.5);
  return t;
};

export async function buildBoard(state, stage) {
  const { tile: tileLayer, map: mapLayer, deco: decoLayer, stats: statsLayer } = stage.layers;

  const terrainTex = {};
  const forestTex = [];
  await Promise.all([
    ...TERRAIN_TILES.map(async (t) => { terrainTex[t] = await PIXI.Assets.load(asset(`terrain-${t}.png`)); }),
    ...FOREST_TILES.map(async (f, i) => { forestTex[i] = await PIXI.Assets.load(asset(`terrain-${f}.png`)); }),
  ]);

  // Altitude continue d'un hex (palier + bruit doux) normalisée sur [0, 1].
  const altAt = (q, r) => ((ELEV[state.terrain.get(key(q, r))] ?? 2) + (bandNoise(q, r) - 0.5) * 1.1) / 5;
  for (const { q, r } of state.hexes) {
    const { x, y } = axialToPixel(q, r);
    const type = state.terrain.get(key(q, r));
    const c = hexCorners(x, y);
    const tex = type === 'forest' ? forestTex[forestPick(q, r)] : terrainTex[type];
    if (tex) { // tuile texturée : sprite flat-top
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5);
      sp.position.set(x, y);
      sp.width = SIZE * 2; sp.height = SIZE * SQRT3;
      // Ombrage d'altitude sur la terre (l'eau garde sa teinte propre).
      if (type === 'plain' || type === 'plain2' || type === 'forest') sp.tint = lerpColor(0xffffff, elevColor(altAt(q, r)), 0.45);
      tileLayer.addChild(sp);
    } else { // terrain sans tuile (relief, peuplements, route) : aplat vectoriel
      const t = TERRAIN[type];
      mapLayer.poly(c).fill(t.fill).stroke({ width: 1, color: t.stroke, alpha: 0.4 });
    }
    // Relief : arêtes hautes éclairées, arêtes basses ombrées → profondeur.
    // Biseau discret pour ne pas concurrencer les contours de zone.
    for (const e of UPPER_EDGES) strokeEdge(mapLayer, c, e, 0xffffff, 0.05, 1.5);
    for (const e of LOWER_EDGES) strokeEdge(mapLayer, c, e, 0x000000, 0.06, 1.5);
  }
  for (const { q, r } of state.hexes) {
    const type = state.terrain.get(key(q, r));
    const { x, y } = axialToPixel(q, r);
    // Courbe de niveau : trait fin sur l'arête franchie entre deux paliers
    // d'altitude. Tracée du seul côté amont → un seul trait par frontière.
    if (!WATER_R.has(type)) {
      const cc = hexCorners(x, y);
      const myB = ELEV[type] ?? 2;
      for (let d = 0; d < 6; d++) {
        const nt = state.terrain.get(key(q + DIRS[d][0], r + DIRS[d][1]));
        if (!nt || WATER_R.has(nt)) continue;
        if (myB > (ELEV[nt] ?? 2)) strokeEdge(decoLayer, cc, DIR_TO_EDGE[d], 0x161c12, 0.4, 1.6);
      }
    }
    // Villes et villages : pas de marqueur statique ici — leur drapeau de
    // contrôle (drawFlag, dans l'overlay) fait office de repère.
    if (type === 'urban') {
      // zone urbaine : rues reliées aux entrées (route/ville/base) et à une
      // partie des voisins urbains — arêtes élaguées par un hash SYMÉTRIQUE
      // (les deux hexes décident pareil), sinon les grappes denses deviennent
      // une toile de rues. Puis îlots bâtis variés par-dessus.
      const mids = [];
      for (const [dq, dr] of DIRS) {
        const nq = q + dq, nr = r + dr;
        const nt = state.terrain.get(key(nq, nr));
        const open = nt === 'urban'
          ? hash01(q + nq, r + nr, 3) < 0.45
          : nt === 'road' || nt === 'town' || nt === 'village' || nt === 'base';
        if (open) {
          const np = axialToPixel(nq, nr);
          mids.push({ x: (x + np.x) / 2, y: (y + np.y) / 2 });
        }
      }
      drawUrban(decoLayer, x, y, q, r, mids);
    } else if (type === 'hill') {
      // coteau : deux bosses.
      decoLayer.poly([x - 9, y + 4, x - 3, y - 5, x + 3, y + 4]).fill(0x6e6c5e).stroke({ width: 1, color: 0xb0ac96 });
      decoLayer.poly([x + 1, y + 5, x + 6, y - 3, x + 10, y + 5]).fill(0x7b7869).stroke({ width: 1, color: 0xb0ac96 });
    } else if (type === 'mountain') {
      // montagne : pic marqué, versant éclairé et arête sommitale claire.
      decoLayer.poly([x - 11, y + 6, x, y - 9, x + 11, y + 6]).fill(0x6f6f77).stroke({ width: 1, color: 0xb9b9c2 });
      decoLayer.poly([x, y - 9, x + 5, y - 1, x - 1, y + 1]).fill(0x9a9aa2);
      decoLayer.moveTo(x - 3, y - 3).lineTo(x, y - 9).lineTo(x + 3, y - 3).stroke({ width: 1, color: 0xe6e6ec, alpha: 0.75 });
    } else if (type === 'marsh') {
      // marais : touffes de roseaux et flaques.
      decoLayer.moveTo(x - 7, y + 3).lineTo(x - 3, y + 3).stroke({ width: 1, color: 0x8fa07a, alpha: 0.7 });
      decoLayer.moveTo(x + 1, y - 1).lineTo(x + 6, y - 1).stroke({ width: 1, color: 0x8fa07a, alpha: 0.7 });
      decoLayer.moveTo(x - 2, y + 6).lineTo(x + 4, y + 6).stroke({ width: 1, color: 0x6f88b0, alpha: 0.6 });
    } else if (type === 'dunes') {
      // dunes : crêtes de sable ondulantes.
      decoLayer.moveTo(x - 8, y + 2).quadraticCurveTo(x - 3, y - 3, x + 1, y + 1).quadraticCurveTo(x + 5, y + 4, x + 9, y - 1).stroke({ width: 1, color: 0xe7d6a6, alpha: 0.8 });
      decoLayer.moveTo(x - 7, y + 6).quadraticCurveTo(x - 2, y + 2, x + 3, y + 6).stroke({ width: 1, color: 0xb59a5c, alpha: 0.7 });
    } else if (type === 'oasis') {
      // oasis : point d'eau cerné de palmes.
      decoLayer.circle(x, y + 2, 3).fill({ color: 0x4aa6c9 }).stroke({ width: 1, color: 0xcfeaf2 });
      for (const dx of [-6, 0, 6]) decoLayer.moveTo(x + dx, y - 1).lineTo(x + dx, y - 8).stroke({ width: 1, color: 0x2f7d47 });
    } else if (type === 'rough') {
      // rocaille : éclats de roche épars.
      decoLayer.poly([x - 8, y + 3, x - 5, y - 2, x - 2, y + 3]).fill(0x6f6a5e);
      decoLayer.poly([x + 1, y + 5, x + 5, y - 1, x + 9, y + 5]).fill(0x7d786a);
      decoLayer.circle(x - 1, y - 3, 1.6).fill(0x60594d);
    } else if (type === 'ruins') {
      // ruines : pans de murs brisés.
      decoLayer.rect(x - 8, y - 4, 4, 6).fill(0x5f5b57).stroke({ width: 1, color: 0x2f2c29 });
      decoLayer.rect(x - 1, y - 6, 4, 8).fill(0x6b6763).stroke({ width: 1, color: 0x2f2c29 });
      decoLayer.rect(x + 5, y - 1, 3, 4).fill(0x565350).stroke({ width: 1, color: 0x2f2c29 });
    } else if (type === 'wadi') {
      // oued : lit asséché sinueux.
      decoLayer.moveTo(x - 8, y - 2).quadraticCurveTo(x - 2, y + 3, x + 2, y - 1).quadraticCurveTo(x + 6, y - 4, x + 9, y + 1).stroke({ width: 2, color: 0x8a7846, alpha: 0.8 });
    } else if (type === 'river') {
      // rivière : rides.
      decoLayer.moveTo(x - 6, y - 3).quadraticCurveTo(x - 3, y - 5, x, y - 3).quadraticCurveTo(x + 3, y - 1, x + 6, y - 3).stroke({ width: 1, color: 0xaed3e2, alpha: 0.5 });
      decoLayer.moveTo(x - 6, y + 4).quadraticCurveTo(x - 3, y + 2, x, y + 4).quadraticCurveTo(x + 3, y + 6, x + 6, y + 4).stroke({ width: 1, color: 0xaed3e2, alpha: 0.5 });
    } else if (type === 'road') {
      // route : ruban reliant les voisins carrossables (route/ville/base) en
      // courbes passant par le centre → rendu organique plutôt qu'en segments
      // droits. Vers un voisin URBAIN le tronçon est droit (style rue) — la rue
      // urbaine tend vers le même milieu d'arête : jonction nette, sans rosace.
      const mids = [], urbMids = [];
      for (const [dq, dr] of DIRS) {
        const nt = state.terrain.get(key(q + dq, r + dr));
        if (nt === 'road' || nt === 'town' || nt === 'base' || nt === 'urban') {
          const np = axialToPixel(q + dq, r + dr);
          (nt === 'urban' ? urbMids : mids).push({ x: (x + np.x) / 2, y: (y + np.y) / 2 });
        }
      }
      const RSTROKE = { width: 3, color: 0x8a7550 };
      const n = Math.sin(q * 127.1 + r * 311.7) * 43758.5453;
      const wig = (n - Math.floor(n) - 0.5) * 5; // gigue déterministe par hex (±2.5px)
      for (const m of urbMids) decoLayer.moveTo(x, y).lineTo(m.x, m.y).stroke(RSTROKE);
      if (mids.length === 0) {
        if (!urbMids.length) decoLayer.circle(x, y, 2.5).fill(0x8a7550);
      } else if (mids.length === 2) {
        // traversée : une seule courbe d'un bord à l'autre, incurvée via le centre.
        const [a, b] = mids;
        decoLayer.moveTo(a.x, a.y).quadraticCurveTo(x + wig, y - wig, b.x, b.y).stroke(RSTROKE);
      } else {
        // extrémité ou carrefour : une courbe du centre vers chaque bord relié.
        for (const m of mids) {
          const cx = (x + m.x) / 2 - (m.y - y) * 0.25, cy = (y + m.y) / 2 + (m.x - x) * 0.25;
          decoLayer.moveTo(x, y).quadraticCurveTo(cx, cy, m.x, m.y).stroke(RSTROKE);
        }
      }
    }
    // Rivage : arête entre eau et terre soulignée d'écume.
    if (type === 'river') {
      const c = hexCorners(x, y);
      for (let d = 0; d < 6; d++) {
        const nt = state.terrain.get(key(q + DIRS[d][0], r + DIRS[d][1]));
        if (nt && nt !== 'river') strokeEdge(decoLayer, c, DIR_TO_EDGE[d], 0xcde7ef, 0.6, 1.5);
      }
    }
  }
  // Camps de base : encadré + fanion à la couleur du camp.
  for (const s of ['blue', 'red']) {
    const [c, rw] = BASES[s];
    const { q, r } = offsetToAxial(c, rw);
    const { x, y } = axialToPixel(q, r);
    const col = FILL[s];
    decoLayer.rect(x - 9, y - 9, 18, 18).fill(0x241d10).stroke({ width: 2, color: col });
    decoLayer.rect(x - 1, y - 10, 2, 9).fill(col);
    decoLayer.poly([x + 1, y - 10, x + 8, y - 8, x + 1, y - 6]).fill(col);
  }

  // Aplatissement des couches statiques : le terrain vectoriel (mapLayer) et
  // les décors (decoLayer) ne changent JAMAIS après l'init → on les rasterise
  // chacun en une texture. Des milliers d'opérations de tracé (biseaux, courbes
  // de niveau, décors) deviennent un seul quad par rendu. Résolution 2 pour
  // rester net à un zoom modéré ; léger flou au zoom maximal (compromis assumé).
  mapLayer.cacheAsTexture({ resolution: 2, antialias: true });
  decoLayer.cacheAsTexture({ resolution: 2, antialias: true });

  // -- Filtre « stats » : heatmap de défense + chiffres PM/DÉF par hexe. -----
  // Le terrain est fixe sur la partie → couche construite une fois, simplement
  // montrée/masquée par le bouton STAT. Chaque hexe est teinté selon sa défense
  // (rouge = exposé → vert = bon abri) en SEMI-TRANSPARENT : la carte reste
  // lisible dessous. Les deux chiffres se lisent par-dessus (∞ = infranchissable).
  statsLayer.visible = false;
  const statFill = new PIXI.Graphics(); // teintes (une seule géométrie)
  for (const { q, r } of state.hexes) {
    const tp = TERRAIN[state.terrain.get(key(q, r))];
    if (!tp) continue;
    const { x, y } = axialToPixel(q, r);
    const impassable = tp.cost === Infinity;
    const cost = impassable ? '∞' : tp.cost;
    const def = tp.def > 0 ? `+${tp.def}` : `${tp.def}`;
    const col = impassable ? 0x2a3340 : defColor(tp.def); // infranchissable → ardoise neutre
    statFill.poly(hexCorners(x, y)).fill({ color: col, alpha: 0.5 }).stroke({ width: 1, color: 0x0c0f08, alpha: 0.35 });
    const pm = statLabel(`PM ${cost}`, 11); pm.position.set(x, y - 8);
    const df = statLabel(`DÉF ${def}`, 11); df.position.set(x, y + 9);
    statsLayer.addChild(pm, df);
  }
  statsLayer.addChildAt(statFill, 0); // teintes sous les chiffres
}
