// ===========================================================================
//  IA adverse — planificateur PUR, additif au moteur.
//
//  Ce module NE MODIFIE PAS les règles : il ne fait que LIRE l'état et
//  s'appuyer sur les fonctions publiques (`computeReachable`, `combatPlan`, …)
//  pour décider. Il ne mute jamais l'état réel — la planification du mouvement
//  se fait sur une COPIE (`sim`) — et renvoie des INTENTIONS au même format que
//  le protocole en ligne : `{ id, to }` (déplacement) et `{ atk:[ids], def }`
//  (combat). La couche de rendu les rejoue via son chemin habituel.
//
//  Deux niveaux mêlés :
//   - stratégique : marcher sur les objectifs non tenus (condition de victoire) ;
//   - tactique    : chercher le contact favorable, concentrer la force, garder
//                   l'artillerie à portée d'appui, rester ravitaillé, n'engager
//                   un combat que si la colonne d'odds est favorable.
// ===========================================================================

import { ARTY_RANGE, ODDS, CRT, TERRAIN } from './config.js';
import { key, hexDistance } from './geometry.js';
import { eAtk, eDef, stackCount } from './units.js';
import { computeReachable, moveUnit } from './movement.js';
import { suppliedHexes } from './supply.js';
import { combatPlan } from './combat.js';

// Valeur d'un résultat CRT du point de vue de l'attaquant.
const RES_VALUE = { DE: 2, DR: 1, EX: 0, AR: -1, AE: -2 };
// Espérance d'une colonne d'odds (moyenne sur les 6 faces du dé).
const columnEV = (col) => CRT[col].reduce((s, res) => s + RES_VALUE[res], 0) / CRT[col].length;

const IDX_1_1 = ODDS.indexOf('1:1');
const IDX_2_1 = ODDS.indexOf('2:1');

// --------------------------------------------------------------------------
//  Phase de combat : quels groupes attaquent quelles cibles.
// --------------------------------------------------------------------------
// On engage une cible tant qu'on trouve un assaut acceptable : colonne ≥ 2:1,
// ou ≥ 1:1 si la cible tient un objectif (enjeu stratégique). Les attaquants au
// contact sont concentrés sur la meilleure cible, puis retirés du réservoir ;
// l'artillerie appuie automatiquement (calculée par `combatPlan`) et peut servir
// plusieurs combats — on ne l'inclut donc pas dans le corps à corps.
export function aiAttackPhase(state, side) {
  const enemies = state.units.filter((u) => u.side !== side);
  const objSet = new Set(state.objectives);
  const used = new Set();
  const attacks = [];
  let progress = true;
  while (progress) {
    progress = false;
    let best = null;
    for (const e of enemies) {
      const adj = state.units.filter((u) => u.side === side && u.type !== 'arty'
        && !u.hasFought && !used.has(u.id) && hexDistance(u.q, u.r, e.q, e.r) === 1);
      if (!adj.length) continue;
      const plan = combatPlan(state, adj, e);
      const onObj = objSet.has(key(e.q, e.r));
      const acceptable = plan.idx >= IDX_2_1 || (onObj && plan.idx >= IDX_1_1);
      if (!acceptable) continue;
      const score = plan.idx + columnEV(plan.col) + (onObj ? 0.5 : 0);
      if (!best || score > best.score) best = { e, adj, score };
    }
    if (best) {
      attacks.push({ atk: best.adj.map((u) => u.id), def: best.e.id });
      best.adj.forEach((u) => used.add(u.id));
      progress = true;
    }
  }
  return attacks;
}

// --------------------------------------------------------------------------
//  Phase de mouvement : une destination par unité, choisie sur une copie de
//  l'état (pour que les unités suivantes voient les déplacements déjà planifiés).
// --------------------------------------------------------------------------
export function aiMovePhase(state, side) {
  const sim = { ...state, units: state.units.map((u) => ({ ...u })) };
  const supplied = suppliedHexes(sim, side);
  const objHexes = state.objectives.map((k) => { const [q, r] = k.split(',').map(Number); return { k, q, r }; });
  const moves = [];
  for (const u of sim.units.filter((x) => x.side === side && x.mpLeft > 0)) {
    const enemies = sim.units.filter((e) => e.side !== side);
    // Une unité de combat déjà au contact reste sur place : elle frappera en
    // phase de combat plutôt que de rompre le contact.
    if (u.type !== 'arty' && enemies.some((e) => hexDistance(u.q, u.r, e.q, e.r) === 1)) continue;
    const goal = chooseGoal(sim, side, u, enemies, objHexes);
    if (!goal) continue;
    const { reachable, dist, eZOC } = computeReachable(sim, u);
    if (!reachable.size) continue;
    let bestK = null, bestScore = scoreHex(sim, side, u, key(u.q, u.r), goal, enemies, supplied);
    for (const hk of reachable) {
      const s = scoreHex(sim, side, u, hk, goal, enemies, supplied);
      if (s > bestScore) { bestScore = s; bestK = hk; }
    }
    if (bestK) { moveUnit(u, bestK, dist, eZOC); moves.push({ id: u.id, to: bestK }); }
  }
  return moves;
}

// But d'une unité : au plus proche entre l'ennemi et un objectif non tenu ;
// l'artillerie vise toujours le front (elle gardera ses distances au scoring).
function chooseGoal(sim, side, u, enemies, objHexes) {
  const nearest = (arr, filt) => {
    let best = null, bd = Infinity;
    for (const o of arr) {
      if (filt && !filt(o)) continue;
      const d = hexDistance(u.q, u.r, o.q, o.r);
      if (d < bd) { bd = d; best = o; }
    }
    return best && { hex: best, d: bd };
  };
  const enemy = nearest(enemies);
  const objective = nearest(objHexes, (o) => sim.objControl.get(o.k) !== side);
  if (u.type === 'arty') return enemy ? enemy.hex : objective && objective.hex;
  if (enemy && objective) return (enemy.d <= objective.d ? enemy : objective).hex;
  return (enemy || objective || {}).hex || null;
}

// Qualité d'un hexe pour une unité : se rapprocher du but (stratégie) tout en
// cherchant le bon contact, un terrain défensif et le ravitaillement (tactique).
function scoreHex(sim, side, u, hk, goal, enemies, supplied) {
  const [q, r] = hk.split(',').map(Number);
  let s = -hexDistance(q, r, goal.q, goal.r);
  const adj = enemies.filter((e) => hexDistance(q, r, e.q, e.r) === 1);
  const terr = TERRAIN[sim.terrain.get(hk)];
  if (u.type === 'arty') {
    if (enemies.some((e) => hexDistance(q, r, e.q, e.r) <= ARTY_RANGE)) s += 1.5; // à portée d'appui
    if (adj.length) s -= 3;                                                       // ne pas s'exposer
  } else {
    for (const e of adj) s += Math.min(3, eAtk(u) / Math.max(1, eDef(e)));        // viser le plus faible
    if (adj.length && terr) s += terr.def * 0.4;                                  // se poster sur du défensif
  }
  if (supplied.has(hk)) s += 0.6;
  s -= stackCount(sim.units, q, r, side) * 0.4;                                   // éviter le sur-empilement
  return s;
}
