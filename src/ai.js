// ===========================================================================
//  IA adverse — planificateur PUR, additif au moteur.
//
//  Ce module NE MODIFIE PAS les règles : il ne fait que LIRE l'état et
//  s'appuyer sur les fonctions publiques (`computeReachable`, `combatPlan`, …)
//  pour décider. Il ne mute jamais l'état réel — toute planification se fait sur
//  une COPIE (`sim`) — et renvoie des INTENTIONS au même format que le protocole
//  en ligne : `{ id, to }` (déplacement) et `{ atk:[ids], def }` (combat). La
//  couche de rendu les rejoue via son chemin habituel. Aucun aléa (`rng`) : la
//  planification est déterministe (compatible lockstep) — les combats sont
//  évalués en ESPÉRANCE, jamais tirés au dé.
//
//  Recherche « portefeuille + rollout à 1 coup », plus profonde que le glouton
//  mono-tour :
//   - MOUVEMENT : on construit plusieurs plans de tour complets sous des POSTURES
//     différentes (agressif, prudent, ruée-objectif, défensif, groupé), puis on
//     retient celui dont la position — APRÈS la meilleure riposte adverse
//     anticipée — maximise une fonction d'ÉVALUATION partagée. C'est le
//     « moins mono-tour » (anticipation) et le « moins dispersé » (coordination).
//   - COMBAT : on n'engage qu'avec la FORCE MINIMALE suffisante (on garde des
//     réserves) et seulement si le GAIN NET espéré (bénéfice − pertes probables
//     via la CRT) est positif. C'est le « moins glouton ».
// ===========================================================================

import { ARTY_RANGE, ODDS, CRT, TERRAIN, DIRS } from './config.js';
import { key, hexDistance } from './geometry.js';
import { eAtk, eDef, eDefBase, stackCount } from './units.js';
import { computeReachable, moveUnit } from './movement.js';
import { suppliedHexes, updateSupply } from './supply.js';
import { combatPlan } from './combat.js';
import { updateObjectives } from './game.js';

const IDX_1_1 = ODDS.indexOf('1:1');
const IDX_2_1 = ODDS.indexOf('2:1');
const NET_MIN = 0.25;              // gain net espéré minimal pour engager un combat

// Poids de la fonction d'évaluation d'une position (du point de vue d'un camp).
const W_MAT = 1.0;                 // matériel (force des pions vivants)
const W_OBJ = 25;                  // contrôle d'un objectif (enjeu de victoire)
const W_MARCH = 0.6;               // rapprochement d'un objectif non tenu
const W_SUP = 4;                   // ravitaillement (bonus/malus par unité, def & mvt ÷2 hors ravito)
const W_EXPOSE = 1.2;              // exposition à la riposte adverse (anticipation)
const EXPOSE_K = 0.6;              // sensibilité de l'exposition au scoring d'hex
const SUP_K = 0.25;               // pénalité (quadratique) d'éloignement au-delà du ravitaillement
const W_CONTACT = 3.0;             // occasion offensive au contact d'un ennemi battable

// Postures : jeux de poids passés au scoring d'hex, produisant des plans de tour
// de caractères différents. Le rollout choisit le meilleur.
const POSTURES = [
  { name: 'agressif', w: { goal: 1.0, contact: 1.0, terrainDef: 0.4, expose: 0.2, supply: 0.6, support: 0,   stack: 1 } },
  { name: 'prudent',  w: { goal: 0.8, contact: 0.6, terrainDef: 0.8, expose: 1.4, supply: 1.0, support: 0,   stack: 1 } },
  { name: 'objectif', w: { goal: 1.3, contact: 0.6, terrainDef: 0.4, expose: 0.6, supply: 0.6, support: 0,   stack: 1 } },
  { name: 'defensif', w: { goal: 0.5, contact: 0.7, terrainDef: 1.0, expose: 1.1, supply: 1.0, support: 0,   stack: 1 } },
  { name: 'groupe',   w: { goal: 0.9, contact: 0.8, terrainDef: 0.5, expose: 0.8, supply: 0.6, support: 1.0, stack: 1 } },
];

// --------------------------------------------------------------------------
//  Pathfinding : champ de distance réel depuis un but.
// --------------------------------------------------------------------------
// Fabrique une fonction mémoïsée `field(goalKey)` : Dijkstra depuis le but à
// travers le terrain (coût `TERRAIN.cost`, eau infranchissable exclue), renvoyant
// le coût de chemin réel vers chaque hex. Le mouvement s'y appuie pour CONTOURNER
// les rivières vers les ponts/routes au lieu de se coller à vol d'oiseau au but
// et de rester bloqué contre une berge. Le terrain est constant sur tout le tour
// → un cache par but suffit.
function buildFieldFn(terrain) {
  const cache = new Map();
  return (goalKey) => {
    if (cache.has(goalKey)) return cache.get(goalKey);
    const field = new Map([[goalKey, 0]]);
    const frontier = [{ k: goalKey, c: 0 }];
    while (frontier.length) {
      frontier.sort((a, b) => a.c - b.c);
      const cur = frontier.shift();
      if (cur.c > field.get(cur.k)) continue;
      const [q, r] = cur.k.split(',').map(Number);
      for (const [dq, dr] of DIRS) {
        const nk = key(q + dq, r + dr);
        if (!terrain.has(nk)) continue;
        const cost = TERRAIN[terrain.get(nk)].cost;
        if (!isFinite(cost)) continue;                        // eau : infranchissable
        const nc = cur.c + cost;
        if (field.get(nk) === undefined || nc < field.get(nk)) {
          field.set(nk, nc);
          frontier.push({ k: nk, c: nc });
        }
      }
    }
    cache.set(goalKey, field);
    return field;
  };
}

// Champ « distance au ravitaillement » : BFS multi-source depuis TOUS les hexes
// ravitaillés (coût 0), à travers le terrain franchissable. Donne, pour chaque
// hex, le nombre d'hexes qui le séparent du réseau (0 = dans le ravito). Sert à
// pénaliser l'étirement au-delà du ravitaillement — l'armée avance en restant
// ancrée à son réseau plutôt que de s'y perdre.
function buildSupplyDist(terrain, supplied) {
  const dist = new Map();
  const frontier = [];
  for (const k of supplied) { dist.set(k, 0); frontier.push({ k, c: 0 }); }
  while (frontier.length) {
    frontier.sort((a, b) => a.c - b.c);
    const cur = frontier.shift();
    if (cur.c > dist.get(cur.k)) continue;
    const [q, r] = cur.k.split(',').map(Number);
    for (const [dq, dr] of DIRS) {
      const nk = key(q + dq, r + dr);
      if (!terrain.has(nk) || !isFinite(TERRAIN[terrain.get(nk)].cost)) continue;
      const nc = cur.c + 1;
      if (dist.get(nk) === undefined || nc < dist.get(nk)) { dist.set(nk, nc); frontier.push({ k: nk, c: nc }); }
    }
  }
  return dist;
}

// --------------------------------------------------------------------------
//  Anticipation : carte des menaces adverses.
// --------------------------------------------------------------------------
// Pour chaque hex, la force d'attaque ennemie cumulée capable de l'atteindre au
// prochain tour (une unité menace tous les hexes bordant ses cases atteignables).
// Sert à pénaliser l'exposition, côté mouvement comme côté évaluation.
function buildThreatMap(sim, side) {
  const map = new Map();
  for (const e of sim.units) {
    if (e.side === side) continue;
    const { reachable } = computeReachable(sim, e);
    const struck = new Set();
    for (const fk of [key(e.q, e.r), ...reachable]) {
      const [q, r] = fk.split(',').map(Number);
      for (const [dq, dr] of DIRS) struck.add(key(q + dq, r + dr));
    }
    for (const hk of struck) map.set(hk, (map.get(hk) || 0) + eAtk(e));
  }
  return map;
}

// --------------------------------------------------------------------------
//  Évaluation d'une position complète, du point de vue de `side`.
// --------------------------------------------------------------------------
// Somme : matériel (nôtre − adverse), objectifs tenus (occupant courant prime
// sur le dernier contrôle connu), marche vers les objectifs non tenus,
// ravitaillement, exposition à la riposte adverse (menace) et occasions
// offensives au contact. Plus le score est haut, meilleure est la position.
function evaluate(sim, side, fieldFn) {
  let s = 0;
  const threat = buildThreatMap(sim, side);                 // riposte adverse anticipée (1 coup)
  const own = sim.units.filter((u) => u.side === side);
  for (const u of sim.units) {
    const val = eAtk(u) + eDefBase(u);
    if (u.side !== side) { s -= W_MAT * val; continue; }
    s += W_MAT * val;
    s += u.supplied ? W_SUP : -W_SUP;                       // rester ravitaillé compte double (bonus + malus évité)
    s -= (W_EXPOSE * (threat.get(key(u.q, u.r)) || 0)) / Math.max(1, eDef(u)); // exposition
    if (u.type === 'arty') continue;
    for (const e of sim.units) {                             // occasion offensive
      if (e.side === side || hexDistance(u.q, u.r, e.q, e.r) !== 1) continue;
      s += W_CONTACT * Math.min(2, eAtk(u) / Math.max(1, eDef(e)));
    }
  }
  for (const k of sim.objectives) {
    const [oq, or_] = k.split(',').map(Number);
    const occ = sim.units.find((u) => u.q === oq && u.r === or_);
    const ctrl = occ ? occ.side : sim.objControl.get(k);
    if (ctrl === side) s += W_OBJ;
    else {
      if (ctrl) s -= W_OBJ;
      const field = fieldFn(k);                              // distance RÉELLE (contourne l'eau)
      let dmin = Infinity;                                   // rapprochement d'un objectif à prendre
      for (const u of own) dmin = Math.min(dmin, field.get(key(u.q, u.r)) ?? Infinity);
      if (isFinite(dmin)) s -= W_MARCH * dmin;
    }
  }
  return s;
}

// --------------------------------------------------------------------------
//  Combat : force minimale suffisante et gain net espéré.
// --------------------------------------------------------------------------
// Espérance d'un assaut (moyenne sur les 6 faces de la CRT) : pertes probables
// du défenseur et des attaquants, exprimées en « valeur » (attaque + défense).
// Déterministe : aucun dé, on parcourt la colonne finale.
function attackExpectation(state, attackers, defender) {
  const plan = combatPlan(state, attackers, defender);
  const defVal = eAtk(defender) + eDefBase(defender);
  const atkTotal = attackers.reduce((sum, a) => sum + eAtk(a) + eDefBase(a), 0);
  let defLoss = 0, atkLoss = 0;
  for (const res of CRT[plan.col]) {
    if (res === 'DE') defLoss += defVal;
    else if (res === 'DR') defLoss += defVal * 0.15;                    // recul : gain positionnel léger
    else if (res === 'EX') { defLoss += defVal * 0.6; atkLoss += Math.min(atkTotal, defVal); }
    else if (res === 'AR') atkLoss += atkTotal * 0.1;
    else if (res === 'AE') atkLoss += atkTotal * 0.6;
  }
  return { plan, net: (defLoss - atkLoss) / 6 };
}

// On engage une cible tant qu'on trouve un assaut acceptable. Pour chaque cible,
// on cherche la FORCE MINIMALE suffisante (sous-ensemble des unités au contact,
// les plus fortes d'abord) qui atteint le seuil de colonne ET un gain net positif
// — le reste des unités reste en réserve. La meilleure cible du tour est engagée,
// ses attaquants retirés du réservoir, puis on recommence. L'artillerie appuie
// automatiquement (via `combatPlan`) et n'entre pas dans le corps à corps.
export function aiAttackPhase(state, side) {
  const enemies = state.units.filter((u) => u.side !== side);
  const objSet = new Set(state.objectives);
  const used = new Set();
  const engaged = new Set();                                // un défenseur n'est assailli qu'une fois
  const attacks = [];
  let progress = true;
  while (progress) {
    progress = false;
    let best = null;
    for (const e of enemies) {
      if (!state.units.includes(e) || engaged.has(e.id)) continue;
      const adj = state.units
        .filter((u) => u.side === side && u.type !== 'arty' && !u.hasFought
          && !used.has(u.id) && hexDistance(u.q, u.r, e.q, e.r) === 1)
        .sort((a, b) => eAtk(b) - eAtk(a));
      if (!adj.length) continue;
      const onObj = objSet.has(key(e.q, e.r));
      let group = null, exp = null;
      for (let k = 1; k <= adj.length; k++) {                // force minimale suffisante
        const cand = adj.slice(0, k);
        const ex = attackExpectation(state, cand, e);
        const gate = ex.plan.idx >= IDX_2_1 || (onObj && ex.plan.idx >= IDX_1_1);
        if (gate && ex.net > NET_MIN) { group = cand; exp = ex; break; }
      }
      if (!group) continue;
      const score = exp.net + (onObj ? 1.5 : 0) + exp.plan.idx * 0.1;
      if (!best || score > best.score) best = { e, group, score };
    }
    if (best) {
      attacks.push({ atk: best.group.map((u) => u.id), def: best.e.id });
      best.group.forEach((u) => used.add(u.id));
      engaged.add(best.e.id);
      progress = true;
    }
  }
  return attacks;
}

// --------------------------------------------------------------------------
//  Mouvement : portefeuille de postures évalué par rollout à 1 coup.
// --------------------------------------------------------------------------
// Pour chaque posture, on construit un plan de tour complet sur une copie, puis
// on évalue la position obtenue (qui intègre la riposte adverse anticipée via la
// carte des menaces). On retient les mouvements de la posture la mieux évaluée.
export function aiMovePhase(state, side) {
  const threat = buildThreatMap(state, side);               // menace adverse avant nos mouvements
  const supplyDist = buildSupplyDist(state.terrain, suppliedHexes(state, side)); // éloignement au ravito
  const fieldFn = buildFieldFn(state.terrain);              // champs de distance mémoïsés (par but)
  const objHexes = state.objectives.map((k) => { const [q, r] = k.split(',').map(Number); return { k, q, r }; });
  let best = null;
  for (const p of POSTURES) {
    // `objControl` propre au sim : on peut y refléter les peuplements capturés
    // sans corrompre l'état réel (partagé par référence sinon).
    const sim = { ...state, units: state.units.map((u) => ({ ...u })), objControl: new Map(state.objControl) };
    const moves = planMoves(sim, side, p.w, threat, supplyDist, objHexes, fieldFn);
    updateObjectives(sim);                                   // peuplements occupés → sources de ravito
    updateSupply(sim);                                       // recalcule `supplied` APRÈS les déplacements
    const val = evaluate(sim, side, fieldFn);
    if (!best || val > best.val) best = { val, moves };
  }
  return best ? best.moves : [];
}

// Construit un plan de mouvement (une destination par unité) sur `sim`, sous les
// poids `w`. Les unités suivantes voient les déplacements déjà planifiés.
function planMoves(sim, side, w, threat, supplyDist, objHexes, fieldFn) {
  const moves = [];
  for (const u of sim.units.filter((x) => x.side === side && x.mpLeft > 0)) {
    const enemies = sim.units.filter((e) => e.side !== side);
    // Une unité de combat déjà au contact reste sur place : elle frappera en
    // phase de combat plutôt que de rompre le contact.
    if (u.type !== 'arty' && enemies.some((e) => hexDistance(u.q, u.r, e.q, e.r) === 1)) continue;
    const goal = chooseGoal(sim, side, u, enemies, objHexes);
    if (!goal) continue;
    const field = fieldFn(key(goal.q, goal.r));               // chemin réel vers le but
    const { reachable, dist, eZOC } = computeReachable(sim, u);
    if (!reachable.size) continue;
    let bestK = null, bestScore = scoreHex(sim, side, u, key(u.q, u.r), field, enemies, supplyDist, w, threat);
    for (const hk of reachable) {
      const sc = scoreHex(sim, side, u, hk, field, enemies, supplyDist, w, threat);
      if (sc > bestScore) { bestScore = sc; bestK = hk; }
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

// Qualité d'un hexe pour une unité, pondérée par la posture : se rapprocher du
// but (stratégie), chercher le bon contact et le terrain défensif, rester
// ravitaillé et groupé, éviter l'exposition et le sur-empilement (tactique).
function scoreHex(sim, side, u, hk, field, enemies, supplyDist, w, threat) {
  const [q, r] = hk.split(',').map(Number);
  let s = -w.goal * (field.get(hk) ?? 999);                  // distance de chemin réel au but
  const adj = enemies.filter((e) => hexDistance(q, r, e.q, e.r) === 1);
  const terr = TERRAIN[sim.terrain.get(hk)];
  if (u.type === 'arty') {
    if (enemies.some((e) => hexDistance(q, r, e.q, e.r) <= ARTY_RANGE)) s += 1.5; // à portée d'appui
    if (adj.length) s -= 3;                                                       // ne pas s'exposer
  } else {
    for (const e of adj) s += w.contact * Math.min(3, eAtk(u) / Math.max(1, eDef(e))); // viser le plus faible
    if (adj.length && terr) s += w.terrainDef * terr.def * 0.4;                   // se poster sur du défensif
    s -= (w.expose * (threat.get(hk) || 0)) / Math.max(1, eDef(u)) * EXPOSE_K;    // fuir l'exposition
  }
  const over = supplyDist.get(hk) ?? 20;                     // hexes au-delà du réseau de ravito
  s -= w.supply * SUP_K * over * over;                       // s'en éloigner coûte de plus en plus cher
  if (w.support) {                                                                // rester groupé
    let friends = 0;
    for (const f of sim.units) if (f.side === side && f.id !== u.id && hexDistance(q, r, f.q, f.r) <= 2) friends++;
    s += w.support * 0.5 * friends;
  }
  s -= w.stack * stackCount(sim.units, q, r, side) * 0.4;                          // éviter le sur-empilement
  return s;
}
