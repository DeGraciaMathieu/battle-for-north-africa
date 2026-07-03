// ===========================================================================
//  Génération de la carte — terrain, hexes et objectifs.
//  Déterministe (bruit à base de sinus), donc reproductible sans graine.
//  Géographie « type Loire » : une rivière méandreuse traverse la carte du
//  nord au sud, franchissable uniquement aux ponts (villes), au milieu de
//  plaines, de bois et de coteaux.
// ===========================================================================

import { COLS, ROWS, TOWNS, BASES } from './config.js';
import { key, offsetToAxial } from './geometry.js';

// Bruit pseudo-aléatoire déterministe : même (c, rw) → même valeur.
const rand = (a, b) => {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

// Colonne du lit de la rivière pour une ligne donnée : méandre en S autour du
// centre de la carte (pas de plus d'une colonne par ligne → barrière continue).
const riverCol = (rw) => Math.round(COLS / 2 + 4 * Math.sin((rw + 2) * 0.42));

// Lignes où un pont (ville) franchit la rivière — seuls passages d'une rive à
// l'autre. Le pont central est la ville principale de la région.
const BRIDGES = [4, 11, 18];

// Construit la carte : le lit de la rivière et ses berges, puis plaines/bois/
// coteaux autour, enfin les ponts, les villes et les camps de base. Renvoie le
// terrain, la liste des hexes et les clés des objectifs.
export function generateMap() {
  const terrain = new Map();
  const hexes = [];
  for (let c = 0; c < COLS; c++) {
    for (let rw = 0; rw < ROWS; rw++) {
      const { q, r } = offsetToAxial(c, rw);
      const dRiver = Math.abs(c - riverCol(rw));
      let t;
      if (dRiver === 0) t = 'sea';            // lit de la rivière (infranchissable)
      else if (dRiver === 1) t = 'coast';     // berge
      else {
        const n = rand(c, rw);
        t = n > 0.9 ? 'rock' : n > 0.82 ? 'oasis' : n > 0.5 ? 'sand' : 'sand2';
      }
      terrain.set(key(q, r), t);
      hexes.push({ q, r });
    }
  }
  // Ponts : une ville posée sur le lit relie les deux berges.
  for (const rw of BRIDGES) {
    const { q, r } = offsetToAxial(riverCol(rw), rw);
    terrain.set(key(q, r), 'town');
  }
  for (const [c, rw] of TOWNS) {
    const { q, r } = offsetToAxial(c, rw);
    if (terrain.has(key(q, r))) terrain.set(key(q, r), 'town');
  }
  for (const [c, rw] of Object.values(BASES)) {
    const { q, r } = offsetToAxial(c, rw);
    if (terrain.has(key(q, r))) terrain.set(key(q, r), 'base');
  }
  const objectives = [...terrain.entries()]
    .filter(([, t]) => t === 'town')
    .map(([k]) => k);
  return { terrain, hexes, objectives };
}
