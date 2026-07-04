// ===========================================================================
//  Unités — modèle de pion, roster initial et facteurs effectifs.
//
//  Chaque pion a une face recto (pleine force : atk/def/mov) et une face verso
//  réduite (ratk/rdef/rmov). Il encaisse un palier (recto → verso) avant d'être
//  éliminé. Les facteurs EFFECTIFS combinent la face courante et l'état de
//  ravitaillement (hors ravito : défense et mouvement de moitié).
// ===========================================================================

import { offsetToAxial, hexDistance } from './geometry.js';
import { UNIT_CATALOG, CATALOG_ORDER, COLS, ROWS, BASES } from './config.js';

// Roster par défaut (sans éditeur d'armée) : 10 pions par camp, exprimés en
// composition sur le catalogue. Bleu blindé/mobile, Rouge infanterie/défensif.
const DEFAULT_COMPOSITION = {
  axis: { armor: 4, mech: 2, moto: 2, arty: 2 },
  ally: { armor: 3, inf: 5, arty: 2 },
};

// Rayon de déploiement autour du camp de base (en hexes).
const DEPLOY_RANGE = 3;

// N positions de déploiement pour un camp : les hexes à ≤ DEPLOY_RANGE de son
// camp de base, du plus proche au plus loin. Si l'armée dépasse le nombre
// d'hexes disponibles, on empile (cycle). L'eau éventuelle est gérée par game.js.
function deployPositions(side, n) {
  const [bc, br] = BASES[side];
  const base = offsetToAxial(bc, br);
  const cand = [];
  for (let c = 0; c < COLS; c++) {
    for (let rw = 0; rw < ROWS; rw++) {
      const { q, r } = offsetToAxial(c, rw);
      const d = hexDistance(base.q, base.r, q, r);
      if (d <= DEPLOY_RANGE) cand.push({ col: c, row: rw, d });
    }
  }
  cand.sort((x, y) => x.d - y.d || x.col - y.col || x.row - y.row);
  return Array.from({ length: n }, (_, i) => cand[i % cand.length]);
}

// Construit un roster depuis une composition { axis:{type:n}, ally:{type:n} }.
function rosterFrom(composition) {
  const specs = [];
  for (const side of ['axis', 'ally']) {
    const counts = composition[side] || {};
    const total = CATALOG_ORDER.reduce((s, t) => s + (counts[t] || 0), 0);
    const pos = deployPositions(side, total);
    let i = 0;
    for (const t of CATALOG_ORDER) {
      const tpl = UNIT_CATALOG[t];
      for (let k = 0; k < (counts[t] || 0); k++) {
        const p = pos[i++];
        specs.push({
          side, type: tpl.type, ech: tpl.ech, name: `${tpl.abbr}-${k + 1}`, fullName: `${tpl.label} ${k + 1}`,
          atk: tpl.atk, def: tpl.def, mov: tpl.mov, ratk: tpl.ratk, rdef: tpl.rdef, rmov: tpl.rmov, col: p.col, row: p.row,
        });
      }
    }
  }
  return specs;
}

// Instancie les unités de jeu (état mutable par pion). Sans composition, on
// utilise le roster par défaut ; les pions se déploient à ≤ 3 hexes de leur base.
export function createUnits(composition) {
  return rosterFrom(composition ?? DEFAULT_COMPOSITION).map((u, i) => {
    const { q, r } = offsetToAxial(u.col, u.row);
    return { id: i, ...u, q, r, mpLeft: u.mov, hasFought: false, reduced: false, supplied: true };
  });
}

// -- Facteurs effectifs -----------------------------------------------------
// atk : face courante seule. def : face courante ÷2 si hors ravito (min 1).
// mov : face courante ÷2 si hors ravito (min 1).
export const eAtk = (u) => (u.reduced ? u.ratk : u.atk);
export const eDefBase = (u) => (u.reduced ? u.rdef : u.def);
export const eDef = (u) => Math.max(1, Math.ceil(eDefBase(u) * (u.supplied ? 1 : 0.5)));
export const eMov = (u) => {
  const m = u.reduced ? u.rmov : u.mov;
  return u.supplied ? m : Math.max(1, Math.floor(m / 2));
};

// -- Helpers de camp / d'occupation (opèrent sur une liste d'unités) --------
export const other = (s) => (s === 'axis' ? 'ally' : 'axis');
export const unitsAt = (units, q, r) => units.filter((u) => u.q === q && u.r === r);
export const enemyAt = (units, q, r, side) =>
  units.some((u) => u.q === q && u.r === r && u.side !== side);
export const stackCount = (units, q, r, side) =>
  units.filter((u) => u.q === q && u.r === r && u.side === side).length;

export const isArmor = (u) => u.type === 'armor';
export const isFoot = (u) => u.type === 'inf' || u.type === 'mech' || u.type === 'moto';
