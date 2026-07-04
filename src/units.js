// ===========================================================================
//  Unités — modèle de pion, roster initial et facteurs effectifs.
//
//  Chaque pion a une face recto (pleine force : atk/def/mov) et une face verso
//  réduite (ratk/rdef/rmov). Il encaisse un palier (recto → verso) avant d'être
//  éliminé. Les facteurs EFFECTIFS combinent la face courante et l'état de
//  ravitaillement (hors ravito : défense et mouvement de moitié).
// ===========================================================================

import { offsetToAxial, hexDistance } from './geometry.js';
import { UNIT_CATALOG, CATALOG_ORDER, COLS, ROWS } from './config.js';

// Roster de départ : facteurs recto (pleine force) puis verso (réduit),
// position initiale en coordonnées offset (col, row). `name` = libellé court
// imprimé sur le pion ; `fullName` = nom complet affiché dans l'inspecteur.
export const raw = [
  { side: 'axis', type: 'armor', ech: 'XX', name: 'BLD-1', fullName: 'Blindés 1',    atk: 8, def: 7, mov: 6, ratk: 5, rdef: 4, rmov: 5, col: 9,  row: 13 },
  { side: 'axis', type: 'armor', ech: 'XX', name: 'BLD-2', fullName: 'Blindés 2',    atk: 8, def: 7, mov: 6, ratk: 5, rdef: 4, rmov: 5, col: 9,  row: 15 },
  { side: 'axis', type: 'mech',  ech: 'XX', name: 'MEC-1', fullName: 'Mécanisée 1',  atk: 6, def: 6, mov: 5, ratk: 4, rdef: 4, rmov: 4, col: 11, row: 14 },
  { side: 'axis', type: 'armor', ech: 'XX', name: 'BLD-3', fullName: 'Blindés 3',    atk: 6, def: 5, mov: 5, ratk: 3, rdef: 3, rmov: 4, col: 8,  row: 17 },
  { side: 'axis', type: 'moto',  ech: 'XX', name: 'MOT-1', fullName: 'Motorisée 1',  atk: 4, def: 5, mov: 5, ratk: 2, rdef: 3, rmov: 4, col: 11, row: 17 },
  { side: 'axis', type: 'arty',  ech: 'X',  name: 'ART-1', fullName: 'Artillerie 1', atk: 2, def: 3, mov: 3, ratk: 1, rdef: 2, rmov: 3, col: 7,  row: 15 },
  { side: 'axis', type: 'armor', ech: 'XX', name: 'BLD-4', fullName: 'Blindés 4',    atk: 7, def: 6, mov: 6, ratk: 4, rdef: 4, rmov: 5, col: 7,  row: 13 },
  { side: 'axis', type: 'mech',  ech: 'XX', name: 'MEC-2', fullName: 'Mécanisée 2',  atk: 6, def: 6, mov: 5, ratk: 4, rdef: 4, rmov: 4, col: 12, row: 15 },
  { side: 'axis', type: 'moto',  ech: 'XX', name: 'MOT-2', fullName: 'Motorisée 2',  atk: 4, def: 5, mov: 5, ratk: 2, rdef: 3, rmov: 4, col: 9,  row: 18 },
  { side: 'axis', type: 'arty',  ech: 'X',  name: 'ART-2', fullName: 'Artillerie 2', atk: 2, def: 3, mov: 3, ratk: 1, rdef: 2, rmov: 3, col: 6,  row: 16 },
  { side: 'ally', type: 'armor', ech: 'XX', name: 'BLD-1', fullName: 'Blindés 1',    atk: 7, def: 7, mov: 6, ratk: 4, rdef: 4, rmov: 5, col: 22, row: 3 },
  { side: 'ally', type: 'armor', ech: 'XX', name: 'BLD-2', fullName: 'Blindés 2',    atk: 6, def: 6, mov: 6, ratk: 4, rdef: 4, rmov: 5, col: 22, row: 5 },
  { side: 'ally', type: 'inf',   ech: 'XX', name: 'INF-1', fullName: 'Infanterie 1', atk: 6, def: 6, mov: 4, ratk: 4, rdef: 4, rmov: 3, col: 20, row: 2 },
  { side: 'ally', type: 'inf',   ech: 'XX', name: 'INF-2', fullName: 'Infanterie 2', atk: 5, def: 6, mov: 3, ratk: 3, rdef: 4, rmov: 3, col: 20, row: 6 },
  { side: 'ally', type: 'inf',   ech: 'XX', name: 'INF-3', fullName: 'Infanterie 3', atk: 5, def: 6, mov: 3, ratk: 3, rdef: 4, rmov: 3, col: 24, row: 6 },
  { side: 'ally', type: 'arty',  ech: 'X',  name: 'ART-1', fullName: 'Artillerie 1', atk: 2, def: 3, mov: 3, ratk: 1, rdef: 2, rmov: 3, col: 25, row: 4 },
  { side: 'ally', type: 'armor', ech: 'XX', name: 'BLD-3', fullName: 'Blindés 3',    atk: 6, def: 6, mov: 6, ratk: 4, rdef: 4, rmov: 5, col: 24, row: 3 },
  { side: 'ally', type: 'inf',   ech: 'XX', name: 'INF-4', fullName: 'Infanterie 4', atk: 5, def: 6, mov: 3, ratk: 3, rdef: 4, rmov: 3, col: 26, row: 5 },
  { side: 'ally', type: 'inf',   ech: 'XX', name: 'INF-5', fullName: 'Infanterie 5', atk: 6, def: 6, mov: 4, ratk: 4, rdef: 4, rmov: 3, col: 22, row: 7 },
  { side: 'ally', type: 'arty',  ech: 'X',  name: 'ART-2', fullName: 'Artillerie 2', atk: 2, def: 3, mov: 3, ratk: 1, rdef: 2, rmov: 3, col: 27, row: 6 },
];

// Ancre de déploiement (coin de départ) de chaque camp.
const DEPLOY_ANCHOR = { axis: [8, 15], ally: [COLS - 8, 4] };

// N positions de déploiement pour un camp : les N hexes les plus proches de son
// ancre (blob compact dans le coin). L'eau éventuelle est gérée par game.js.
function deployPositions(side, n) {
  const [ac, ar] = DEPLOY_ANCHOR[side];
  const a = offsetToAxial(ac, ar);
  const cand = [];
  for (let c = 1; c < COLS - 1; c++) {
    for (let rw = 1; rw < ROWS - 1; rw++) {
      const { q, r } = offsetToAxial(c, rw);
      cand.push({ col: c, row: rw, d: hexDistance(a.q, a.r, q, r) });
    }
  }
  cand.sort((x, y) => x.d - y.d || x.col - y.col || x.row - y.row);
  return cand.slice(0, n);
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
// utilise le roster fixe par défaut ; sinon on la construit depuis le catalogue.
export function createUnits(composition) {
  const list = composition ? rosterFrom(composition) : raw;
  return list.map((u, i) => {
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
