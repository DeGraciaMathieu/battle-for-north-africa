// ===========================================================================
//  Génération de la carte — terrain, hexes et objectifs.
//  Déterministe (bruit à base de sinus), donc reproductible sans graine.
// ===========================================================================

import { COLS, ROWS, TOWNS, BASES } from './config.js';
import { key, offsetToAxial } from './geometry.js';

// Bruit pseudo-aléatoire déterministe : même (c, rw) → même valeur.
const rand = (a, b) => {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

// Construit la carte : mer/littoral au nord, désert (avec rocaille/oasis) au sud,
// puis pose les villes/ports. Renvoie le terrain, la liste des hexes et les
// clés des objectifs.
export function generateMap() {
  const terrain = new Map();
  const hexes = [];
  for (let c = 0; c < COLS; c++) {
    for (let rw = 0; rw < ROWS; rw++) {
      const { q, r } = offsetToAxial(c, rw);
      let t;
      if (rw <= 1) t = 'sea';
      else if (rw === 2) t = 'coast';
      else {
        const n = rand(c, rw);
        t = n > 0.9 ? 'rock' : n > 0.86 ? 'oasis' : n > 0.5 ? 'sand' : 'sand2';
      }
      terrain.set(key(q, r), t);
      hexes.push({ q, r });
    }
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
