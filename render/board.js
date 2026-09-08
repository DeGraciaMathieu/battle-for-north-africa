// ===========================================================================
//  Plateau statique : tuiles de terrain en aplats, icônes de décor et couche
//  « stats » (heatmap PM/défense). Construit une fois à l'init, puis rasterisé
//  — le terrain ne change jamais en cours de partie.
//
//  Style « moderne épuré » : chaque hexe est un aplat propre bordé d'un trait
//  net, surmonté d'une icône vectorielle simple (arbres, montagne, dépôt…).
//  Aucune texture, aucun relief chargé — la lisibilité prime, façon jeu de
//  plateau. Purement visuel : aucune règle ne vit ici.
// ===========================================================================

import { TERRAIN, BASES, DIRS } from '../src/config.js';
import { key, axialToPixel, offsetToAxial, hexCorners } from '../src/geometry.js';
import { FILL, lerpColor } from './gfx.js';

const PIXI = window.PIXI;

// Bruit 0..1 déterministe par hexe : gigue légère du ruban routier.
const hash01 = (q, r, s = 0) => {
  const n = Math.sin(q * 91.7 + r * 47.3 + s * 13.131) * 43758.5453;
  return n - Math.floor(n);
};

// Décor vectoriel par terrain : couleur d'encre + type d'icône. Les terrains
// absents (plaine, désert, neige, plateau, berge, camp) restent en aplat nu.
const DECOR = {
  river:   { ink: 0xffffff, icon: 'water' },
  beach:   { ink: 0xc7a86a, icon: 'dots' },
  marsh:   { ink: 0x3f4d2f, icon: 'reed' },
  wadi:    { ink: 0x8a6f3c, icon: 'curve' },
  dunes:   { ink: 0xa98944, icon: 'dune' },
  oasis:   { ink: 0x1f6e3a, icon: 'palm' },
  rough:   { ink: 0x6f6656, icon: 'rocks' },
  hill:    { ink: 0x7c6f55, icon: 'bump' },
  mountain:{ ink: 0x5c5964, icon: 'mount' },
  depot:   { ink: 0x7a6a3f, icon: 'crate' },
  dump:    { ink: 0x7a6a3f, icon: 'crateS' },
  urban:   { ink: 0x8a877f, icon: 'blocks' },
  ruins:   { ink: 0x6f6a63, icon: 'ruin' },
  forest:  { ink: 0x2c6636, icon: 'trees' },
};

const tri = (g, x, y, s, color) =>
  g.poly([x, y - s, x - s * 0.9, y + s * 0.7, x + s * 0.9, y + s * 0.7]).fill(color);

// Dessine l'icône du terrain, centrée sur (x, y), sur le Graphics `g`.
function drawDecor(g, x, y, def) {
  const ink = def.ink;
  switch (def.icon) {
    case 'trees':
      for (const [dx, dy] of [[-12, 4], [8, -3], [-1, 12]]) tri(g, x + dx, y + dy, 10, ink);
      break;
    case 'mount':
      g.poly([x, y - 15, x - 18, y + 9, x + 18, y + 9]).fill(ink);
      g.poly([x, y - 15, x - 6, y - 3, x + 6, y - 3]).fill(0xffffff);
      break;
    case 'bump':
      g.moveTo(x - 13, y + 6).quadraticCurveTo(x - 4, y - 8, x + 2, y + 4)
        .quadraticCurveTo(x + 8, y - 4, x + 14, y + 6).stroke({ width: 2.5, color: ink });
      break;
    case 'rocks':
      for (const [dx, dy, rr] of [[-9, 3, 5], [6, 6, 5], [0, -4, 4]]) g.circle(x + dx, y + dy, rr).fill(ink);
      break;
    case 'palm':
      g.moveTo(x, y + 11).lineTo(x, y - 5).stroke({ width: 2.5, color: ink });
      for (const a of [-1.1, -0.4, 0.4, 1.1])
        g.moveTo(x, y - 5).lineTo(x + Math.sin(a) * 13, y - 5 - Math.cos(a) * 10).stroke({ width: 2, color: ink });
      break;
    case 'dune':
      g.moveTo(x - 15, y + 4).quadraticCurveTo(x - 4, y - 7, x + 3, y + 3)
        .quadraticCurveTo(x + 10, y + 9, x + 16, y + 2).stroke({ width: 2.5, color: ink });
      break;
    case 'curve':
      g.moveTo(x - 15, y - 4).quadraticCurveTo(x, y + 9, x + 15, y - 4).stroke({ width: 2.5, color: ink });
      break;
    case 'water':
      for (const dy of [-7, 2, 11])
        g.moveTo(x - 14, y + dy).quadraticCurveTo(x, y + dy - 6, x + 14, y + dy).stroke({ width: 1.6, color: ink, alpha: 0.6 });
      break;
    case 'reed':
      for (const dx of [-10, 0, 10]) g.moveTo(x + dx, y + 11).lineTo(x + dx, y - 7).stroke({ width: 2, color: ink });
      break;
    case 'dots':
      for (const [dx, dy] of [[-10, -4], [5, 3], [-2, 9], [11, -5]]) g.circle(x + dx, y + dy, 2).fill(ink);
      break;
    case 'blocks':
      for (const [dx, dy, w, h] of [[-15, -2, 9, 15], [-3, -9, 9, 22], [9, -1, 9, 14]]) g.rect(x + dx, y + dy, w, h).fill(ink);
      break;
    case 'ruin':
      for (const [dx, dy, w, h] of [[-14, 0, 7, 11], [-3, -4, 7, 15], [8, 3, 6, 8]]) g.rect(x + dx, y + dy, w, h).fill(ink);
      break;
    case 'crate':
    case 'crateS': {
      const s = def.icon === 'crate' ? 13 : 9;
      g.rect(x - s, y - s, s * 2, s * 2).stroke({ width: 2, color: ink });
      g.moveTo(x - s, y - s).lineTo(x + s, y + s).moveTo(x + s, y - s).lineTo(x - s, y + s).stroke({ width: 2, color: ink });
      break;
    }
  }
}

// Ruban routier : relie les voisins carrossables (route/dépôt/base/urbain) par
// des courbes passant par le centre → tracé organique plutôt qu'en segments
// droits. Donne au réseau routier un vrai poids visuel de plateau.
function drawRoad(g, state, q, r, x, y) {
  const mids = [];
  for (const [dq, dr] of DIRS) {
    const nt = state.terrain.get(key(q + dq, r + dr));
    if (nt === 'road' || nt === 'depot' || nt === 'dump' || nt === 'base' || nt === 'urban') {
      const np = axialToPixel(q + dq, r + dr);
      mids.push({ x: (x + np.x) / 2, y: (y + np.y) / 2 });
    }
  }
  const RSTROKE = { width: 5, color: 0xc9ad66 };
  const wig = (hash01(q, r, 1) - 0.5) * 5; // gigue déterministe (±2.5px)
  if (mids.length === 0) {
    g.circle(x, y, 3).fill(0xc9ad66);
  } else if (mids.length === 2) {
    const [a, b] = mids;
    g.moveTo(a.x, a.y).quadraticCurveTo(x + wig, y - wig, b.x, b.y).stroke(RSTROKE);
  } else {
    for (const m of mids) {
      const cx = (x + m.x) / 2 - (m.y - y) * 0.25, cy = (y + m.y) / 2 + (m.x - x) * 0.25;
      g.moveTo(x, y).quadraticCurveTo(cx, cy, m.x, m.y).stroke(RSTROKE);
    }
  }
}

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
  const { map: mapLayer, deco: decoLayer, stats: statsLayer } = stage.layers;

  // Aplats de terrain : remplissage plein + trait de bord net (effet « tuile »).
  for (const { q, r } of state.hexes) {
    const { x, y } = axialToPixel(q, r);
    const t = TERRAIN[state.terrain.get(key(q, r))];
    if (!t) continue;
    mapLayer.poly(hexCorners(x, y)).fill(t.fill).stroke({ width: 1.4, color: t.stroke, alpha: 0.9 });
  }

  // Décor : icône par terrain, ou ruban routier pour les routes.
  for (const { q, r } of state.hexes) {
    const type = state.terrain.get(key(q, r));
    const { x, y } = axialToPixel(q, r);
    if (type === 'road') drawRoad(decoLayer, state, q, r, x, y);
    else if (DECOR[type]) drawDecor(decoLayer, x, y, DECOR[type]);
  }

  // Camps de base : encadré + fanion à la couleur du camp.
  for (const s of ['blue', 'red']) {
    const [c, rw] = (state.bases ?? BASES)[s];
    const { q, r } = offsetToAxial(c, rw);
    const { x, y } = axialToPixel(q, r);
    const col = FILL[s];
    decoLayer.rect(x - 9, y - 9, 18, 18).fill(0x241d10).stroke({ width: 2, color: col });
    decoLayer.rect(x - 1, y - 10, 2, 9).fill(col);
    decoLayer.poly([x + 1, y - 10, x + 8, y - 8, x + 1, y - 6]).fill(col);
  }

  // Aplatissement des couches statiques : terrain (mapLayer) et décors
  // (decoLayer) ne changent JAMAIS après l'init → on les rasterise chacun en
  // une texture. Résolution 2 pour rester net à un zoom modéré.
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
