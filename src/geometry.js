// ===========================================================================
//  Géométrie hexagonale (axiale) — fonctions pures, sans état ni effet.
//  Conversions coordonnées ⇄ pixels, distance, coins d'un hex.
// ===========================================================================

import { SIZE, SQRT3 } from './config.js';

export const key = (q, r) => q + ',' + r;

export const axialToPixel = (q, r) => ({ x: SIZE * 1.5 * q, y: SIZE * SQRT3 * (r + q / 2) });

export const axialRound = (q, r) => {
  let x = q, z = r;
  const y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
};

export const pixelToAxial = (x, y) =>
  axialRound((2 / 3 * x) / SIZE, (-1 / 3 * x + SQRT3 / 3 * y) / SIZE);

export const offsetToAxial = (c, rw) => ({ q: c, r: rw - (c - (c & 1)) / 2 });

export const hexDistance = (aq, ar, bq, br) =>
  (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;

export const hexCorners = (cx, cy) => {
  const p = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    p.push(cx + SIZE * Math.cos(a), cy + SIZE * Math.sin(a));
  }
  return p;
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
