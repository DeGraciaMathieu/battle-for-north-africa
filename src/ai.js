// ===========================================================================
//  IA adverse — planificateur PUR, additif au moteur.
//
//  Ce module NE MODIFIE PAS les règles : il ne fait que LIRE l'état et
//  s'appuyer sur les fonctions publiques (`computeReachable`, `combatPlan`, …)
//  pour décider. Il ne mute jamais l'état de règles — toute planification se
//  fait sur une COPIE (`sim`) ; seule une mémoire de tour (`state.aiMemo`,
//  hystérésis des buts) est conservée entre ses propres tours. Il renvoie des
//  INTENTIONS au même format que le protocole en ligne : `{ id, to }`
//  (déplacement), `{ atk:[ids], def }` (combat) et `{ ids }` (ordre de pile).
//  La couche de rendu les rejoue via son chemin habituel. Aucun aléa (`rng`) :
//  la planification est déterministe (compatible lockstep) — les combats sont
//  évalués en ESPÉRANCE, jamais tirés au dé.
//
//  Recherche « portefeuille + rollout à 1 coup », plus profonde que le glouton
//  mono-tour :
//   - MOUVEMENT : on construit plusieurs plans de tour complets sous des POSTURES
//     différentes (agressif, prudent, ruée-objectif, défensif, groupé), puis on
//     retient celui dont la position — APRÈS la meilleure riposte adverse
//     anticipée (à PM PLEINS : l'ennemi rejouera reposé) — maximise une fonction
//     d'ÉVALUATION partagée. Les attaquants d'un assaut déjà viable restent
//     cloués ; les autres, même au contact, restent libres de se redéployer.
//     Les postures offensives MONTENT des assauts : plusieurs unités convergent
//     sur une cible pour créer la colonne dès la phase de combat du tour, et
//     l'artillerie se poste en appui de la cible retenue. Les objectifs tenus
//     et menacés reçoivent une garnison.
//   - COMBAT : on n'engage qu'avec la FORCE MINIMALE suffisante (on garde des
//     réserves) et seulement si le GAIN NET espéré (bénéfice − pertes probables
//     via la CRT, encerclements compris) est positif. Seule l'unité au SOMMET
//     d'une pile est ciblée — même règle que pour le joueur. Les seuils
//     s'adaptent au tour et au score : mené, l'IA force ; en tête, elle
//     temporise.
// ===========================================================================

import { ARTY_RANGE, ODDS, CRT, TERRAIN, DIRS, STACK_MAX, MAX_TURNS } from './config.js';
import { key, hexDistance, clamp } from './geometry.js';
import { eAtk, eDef, eDefBase, eMov, other, stackCount, unitsAt, isArmor, isFoot } from './units.js';
import { computeReachable, moveUnit } from './movement.js';
import { suppliedHexes, updateSupply } from './supply.js';
import { combatPlan, retreatOptions } from './combat.js';
import { updateObjectives, victoryScore } from './game.js';

const IDX_1_1 = ODDS.indexOf('1:1');
const IDX_2_1 = ODDS.indexOf('2:1');
const NET_MIN = 0.25;              // gain net espéré minimal pour engager un combat
const ASSAULT_MAX = 4;             // taille maximale d'une coalition d'assaut
const GOAL_STICKY = 1;             // hexes de bonus : conserver le but du tour précédent
const BACKTRACK = 1.5;             // malus : revenir sur l'hex quitté au tour précédent

// Poids de la fonction d'évaluation d'une position (du point de vue d'un camp).
const W_MAT = 1.0;                 // matériel (force des pions vivants)
const W_OBJ = 25;                  // contrôle d'un objectif (enjeu de victoire)
const W_MARCH = 0.6;               // rapprochement d'un objectif non tenu
const W_SUP = 4;                   // ravitaillement (bonus/malus par unité, def & mvt ÷2 hors ravito)
const W_EXPOSE = 1.2;              // exposition à la riposte adverse (anticipation)
const EXPOSE_K = 0.6;              // sensibilité de l'exposition au scoring d'hex
const SUP_K = 0.25;               // pénalité (quadratique) d'éloignement au-delà du ravitaillement
const W_CONTACT = 3.0;             // occasion offensive au contact d'un ennemi battable
const W_ASSAULT = 2.0;             // gain net espéré des assauts jouables depuis la position

// Postures : jeux de poids passés au scoring d'hex, produisant des plans de tour
// de caractères différents (`assault` : la posture monte des assauts coordonnés).
// Le rollout choisit le meilleur.
const POSTURES = [
  { name: 'agressif', w: { goal: 1.0, contact: 1.0, terrainDef: 0.4, expose: 0.2, supply: 0.6, support: 0,   stack: 1, assault: 1 } },
  { name: 'prudent',  w: { goal: 0.8, contact: 0.6, terrainDef: 0.8, expose: 1.4, supply: 1.0, support: 0,   stack: 1, assault: 0 } },
  { name: 'objectif', w: { goal: 1.3, contact: 0.6, terrainDef: 0.4, expose: 0.6, supply: 0.6, support: 0,   stack: 1, assault: 1 } },
  { name: 'defensif', w: { goal: 0.5, contact: 0.7, terrainDef: 1.0, expose: 1.1, supply: 1.0, support: 0,   stack: 1, assault: 0 } },
  { name: 'groupe',   w: { goal: 0.9, contact: 0.8, terrainDef: 0.5, expose: 0.8, supply: 0.6, support: 1.0, stack: 1, assault: 1 } },
];

// --------------------------------------------------------------------------
//  Contexte stratégique : le tour et l'écart de score modulent l'agressivité.
// --------------------------------------------------------------------------
// `pressure` ∈ [−1, 1] : positif quand on est mené (forcer le destin), négatif
// en tête (préserver l'acquis). Sur les deux derniers tours, un camp mené ou à
// égalité sprinte vers les objectifs ; un camp en tête temporise.
function strategicContext(state, side) {
  const diff = victoryScore(state, side) - victoryScore(state, other(side));
  const late = state.G.turn >= MAX_TURNS - 1;
  const pressure = clamp(-diff / 6, -1, 1);
  return {
    netMin: NET_MIN * (1 - 0.5 * pressure),                                      // mené : engage plus volontiers
    minIdx: pressure >= 0.5 || (late && diff < 0) ? IDX_1_1 : IDX_2_1,           // mené : accepte le 1:1 partout
    objMul: 1 + 0.5 * Math.max(0, pressure) + (late && diff <= 0 ? 0.75 : 0),    // sprint final sur les objectifs
    exposeMul: 1 + 0.75 * Math.max(0, -pressure) + (late && diff > 0 ? 0.5 : 0), // en tête : prudence accrue
    supplyMul: Math.max(0.2, 1 - 0.75 * Math.max(0, pressure) - (late && diff < 0 ? 0.35 : 0)), // mené : ose s'étirer hors réseau
  };
}

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
// Chaque ennemi est évalué à PM PLEINS (ses PM restants de ce tour-ci ne disent
// rien de sa portée une fois son mouvement refait) et SANS nos pions comme
// obstacles : nos ZOC bougent avec nous, un couloir « bouché » aujourd'hui ne le
// sera plus si la ligne se déplace. La carte ne dépend donc que de l'ennemi et
// du terrain — constante pendant toute notre planification.
function buildThreatMap(sim, side) {
  const map = new Map();
  const foesOnly = { ...sim, units: sim.units.filter((x) => x.side !== side) };
  for (const e of foesOnly.units) {
    const { reachable } = computeReachable(foesOnly, { ...e, mpLeft: eMov(e) });
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
// sur le dernier contrôle connu ; un objectif tenu mais VIDE et menacé ne vaut
// qu'une fraction), marche vers les objectifs non tenus, ravitaillement,
// exposition à la riposte adverse (menace) et occasions offensives au contact.
// Le contexte stratégique (`ctx`) amplifie objectifs ou prudence selon le score ;
// `threat` (riposte adverse anticipée à 1 coup) est fournie par l'appelant — elle
// ne dépend pas de nos mouvements.
function evaluate(sim, side, fieldFn, ctx, threat) {
  let s = 0;
  const own = sim.units.filter((u) => u.side === side);
  for (const u of sim.units) {
    const val = eAtk(u) + eDefBase(u);
    if (u.side !== side) { s -= W_MAT * val; continue; }
    s += W_MAT * val;
    s += u.supplied ? W_SUP : -W_SUP;                       // rester ravitaillé compte double (bonus + malus évité)
    // Exposition : rapport menace/défense plafonné à 6 — au-delà de 6:1, la CRT
    // ne s'aggrave plus, la masse ennemie supplémentaire ne change rien.
    s -= W_EXPOSE * ctx.exposeMul * Math.min(6, (threat.get(key(u.q, u.r)) || 0) / Math.max(1, eDef(u)));
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
    if (ctrl === side) {
      s += W_OBJ * ctx.objMul * ((occ || !(threat.get(k) > 0)) ? 1 : 0.4); // vide et menacé : contrôle fragile
    } else {
      if (ctrl) s -= W_OBJ * ctx.objMul;
      const field = fieldFn(k);                              // distance RÉELLE (contourne l'eau)
      let dmin = Infinity;                                   // rapprochement d'un objectif à prendre
      for (const u of own) dmin = Math.min(dmin, field.get(key(u.q, u.r)) ?? Infinity);
      if (isFinite(dmin)) s -= W_MARCH * ctx.objMul * dmin;
    }
  }
  return s;
}

// --------------------------------------------------------------------------
//  Combat : force minimale suffisante et gain net espéré.
// --------------------------------------------------------------------------
// Espérance d'un assaut (moyenne sur les 6 faces de la CRT) : pertes probables
// du défenseur et des attaquants, exprimées en « valeur » (attaque + défense).
// Un pion sans case de repli meurt sur un recul : l'encerclement transforme
// DR (défenseur piégé) et AR (attaquant piégé) en éliminations dans l'espérance.
// Déterministe : aucun dé, on parcourt la colonne finale.
function attackExpectation(state, attackers, defender) {
  const plan = combatPlan(state, attackers, defender);
  const defVal = eAtk(defender) + eDefBase(defender);
  const atkTotal = attackers.reduce((sum, a) => sum + eAtk(a) + eDefBase(a), 0);
  const defTrapped = !retreatOptions(state, defender, attackers[0].q, attackers[0].r).length;
  const arLoss = attackers.reduce((sum, a) => {
    const val = eAtk(a) + eDefBase(a);
    return sum + (retreatOptions(state, a, defender.q, defender.r).length ? val * 0.1 : val);
  }, 0);
  let defLoss = 0, atkLoss = 0;
  for (const res of CRT[plan.col]) {
    if (res === 'DE') defLoss += defVal;
    else if (res === 'DR') defLoss += defTrapped ? defVal : defVal * 0.15;      // recul : léger, sauf sans repli
    else if (res === 'EX') { defLoss += defVal * 0.6; atkLoss += Math.min(atkTotal, defVal); }
    else if (res === 'AR') atkLoss += arLoss;
    else if (res === 'AE') atkLoss += atkTotal * 0.6;
  }
  return { plan, net: (defLoss - atkLoss) / 6 };
}

// Variantes d'un groupe d'effectif k : les k plus fortes têtes de liste, plus,
// si un type y manque, l'échange du membre le plus faible contre la meilleure
// unité du type absent — le bonus d'armes combinées (+1 colonne) peut rendre
// « blindé + à pied » supérieur à deux blindés.
function groupVariants(adj, k) {
  const base = adj.slice(0, k);
  const variants = [base];
  for (const want of [isArmor, isFoot]) {
    if (base.some(want)) continue;
    const swap = adj.slice(k).find(want);
    if (swap) variants.push([...base.slice(0, k - 1), swap]);
  }
  return variants;
}

// Cherche l'assaut acceptable de FORCE MINIMALE contre `e` parmi `pool` : à
// effectif croissant, la meilleure variante qui atteint le seuil de colonne ET
// un gain net suffisant. Le seuil s'abaisse sur un objectif ou sous pression.
function findAssault(state, e, pool, ctx, objSet) {
  const onObj = objSet.has(key(e.q, e.r));
  const adj = pool
    .filter((u) => u.type !== 'arty' && !u.hasFought && hexDistance(u.q, u.r, e.q, e.r) === 1)
    .sort((a, b) => eAtk(b) - eAtk(a) || a.id - b.id);
  for (let k = 1; k <= adj.length; k++) {
    let best = null;
    for (const group of groupVariants(adj, k)) {
      const exp = attackExpectation(state, group, e);
      const gate = exp.plan.idx >= ctx.minIdx || (onObj && exp.plan.idx >= IDX_1_1);
      if (gate && exp.net > ctx.netMin && (!best || exp.net > best.exp.net)) best = { group, exp };
    }
    if (best) return { ...best, onObj };
  }
  return null;
}

// On engage une cible tant qu'on trouve un assaut acceptable. Seule l'unité au
// SOMMET d'une pile est attaquable — même règle que pour le joueur. Pour chaque
// cible, on cherche la force minimale suffisante — le reste des unités reste en
// réserve. La meilleure cible du tour est engagée, ses attaquants retirés du
// réservoir, puis on recommence. L'artillerie appuie automatiquement (via
// `combatPlan`) et n'entre pas dans le corps à corps.
function planAttacks(state, side, ctx) {
  const objSet = new Set(state.objectives);
  const used = new Set();
  const engaged = new Set();                                // un défenseur n'est assailli qu'une fois
  const attacks = [];
  let progress = true;
  while (progress) {
    progress = false;
    let best = null;
    for (const e of state.units) {
      if (e.side === side || engaged.has(e.id)) continue;
      const stack = unitsAt(state.units, e.q, e.r);
      if (stack[stack.length - 1] !== e) continue;          // seul le dessus d'une pile se bat
      const pool = state.units.filter((u) => u.side === side && !used.has(u.id));
      const found = findAssault(state, e, pool, ctx, objSet);
      if (!found) continue;
      const score = found.exp.net + (found.onObj ? 1.5 : 0) + found.exp.plan.idx * 0.1;
      if (!best || score > best.score) best = { e, group: found.group, score, net: found.exp.net, onObj: found.onObj };
    }
    if (best) {
      attacks.push({ atk: best.group.map((u) => u.id), def: best.e.id, net: best.net, onObj: best.onObj });
      best.group.forEach((u) => used.add(u.id));
      engaged.add(best.e.id);
      progress = true;
    }
  }
  return attacks;
}

export function aiAttackPhase(state, side) {
  return planAttacks(state, side, strategicContext(state, side)).map(({ atk, def }) => ({ atk, def }));
}

// --------------------------------------------------------------------------
//  Piles : présenter le meilleur défenseur au sommet.
// --------------------------------------------------------------------------
// Un combat ne cible que l'unité du dessus : chaque pile amie est réordonnée
// par défense effective croissante (le plus solide dessus, l'artillerie au
// fond). Renvoie des intentions `{ ids }` (bas → haut) au format du protocole
// en ligne, à rejouer via `reorderStack`.
export function aiReorderPhase(state, side) {
  const seen = new Set();
  const orders = [];
  for (const u of state.units) {
    if (u.side !== side) continue;
    const k = key(u.q, u.r);
    if (seen.has(k)) continue;
    seen.add(k);
    const stack = unitsAt(state.units, u.q, u.r);
    if (stack.length < 2) continue;
    const want = [...stack].sort((a, b) => eDef(a) - eDef(b) || eAtk(a) - eAtk(b) || a.id - b.id);
    if (want.every((x, i) => x === stack[i])) continue;
    orders.push({ ids: want.map((x) => x.id) });
  }
  return orders;
}

// --------------------------------------------------------------------------
//  Assauts montés : converger à plusieurs sur une cible dès le mouvement.
// --------------------------------------------------------------------------
// Pour chaque cible non déjà engagée (sommet de pile), on assemble une coalition
// d'unités libres pouvant terminer adjacentes CE tour-ci ; si son espérance
// passe la porte, chaque membre reçoit sa case d'assaut — la colonne se crée à
// la phase de combat du même tour. Renvoie { assign: Map<unitId, hexKey>,
// targets: [{q,r}] } — les cibles retenues servent à poster l'artillerie.
function planAssaults(state, side, ctx, anchored, engagedIds) {
  const assign = new Map();
  const targets = [];
  const objSet = new Set(state.objectives);
  const free = state.units.filter((u) => u.side === side && u.type !== 'arty' && u.mpLeft > 0 && !anchored.has(u.id));
  if (!free.length) return { assign, targets };
  const reach = new Map(free.map((u) => [u.id, computeReachable(state, u)]));
  const foes = state.units
    .filter((e) => e.side !== side && !engagedIds.has(e.id))
    .filter((e) => { const st = unitsAt(state.units, e.q, e.r); return st[st.length - 1] === e; })
    .sort((a, b) => (objSet.has(key(b.q, b.r)) ? 1 : 0) - (objSet.has(key(a.q, a.r)) ? 1 : 0) || eDef(a) - eDef(b) || a.id - b.id);
  const hexLoad = new Map();                                // arrivées déjà planifiées par hex
  for (const e of foes) {
    const onObj = objSet.has(key(e.q, e.r));
    const cands = [];
    for (const u of free) {
      if (assign.has(u.id)) continue;
      if (hexDistance(u.q, u.r, e.q, e.r) === 1) { cands.push({ u, dest: key(u.q, u.r), cost: 0 }); continue; }
      const { reachable, dist } = reach.get(u.id);
      let dest = null, cost = Infinity;
      for (const [dq, dr] of DIRS) {                        // meilleure case d'assaut atteignable
        const hk = key(e.q + dq, e.r + dr);
        if (!reachable.has(hk)) continue;
        if ((hexLoad.get(hk) || 0) + stackCount(state.units, e.q + dq, e.r + dr, side) >= STACK_MAX) continue;
        if (dist[hk] < cost || (dist[hk] === cost && hk < dest)) { dest = hk; cost = dist[hk]; }
      }
      if (dest) cands.push({ u, dest, cost });
    }
    cands.sort((a, b) => eAtk(b.u) - eAtk(a.u) || a.cost - b.cost || a.u.id - b.u.id);
    const group = [];
    let ok = false;
    for (const c of cands) {                                // force minimale, membres les plus forts d'abord
      group.push(c);
      const exp = attackExpectation(state, group.map((x) => x.u), e);
      const gate = exp.plan.idx >= ctx.minIdx || (onObj && exp.plan.idx >= IDX_1_1);
      if (gate && exp.net > ctx.netMin) { ok = true; break; }
      if (group.length >= ASSAULT_MAX) break;
    }
    if (!ok) continue;
    for (const c of group) {
      assign.set(c.u.id, c.dest);
      if (c.cost > 0) hexLoad.set(c.dest, (hexLoad.get(c.dest) || 0) + 1);
    }
    targets.push({ q: e.q, r: e.r });
  }
  return { assign, targets };
}

// --------------------------------------------------------------------------
//  Mouvement : portefeuille de postures évalué par rollout à 1 coup.
// --------------------------------------------------------------------------
// Pour chaque posture, on construit un plan de tour complet sur une copie, puis
// on évalue la position obtenue (qui intègre la riposte adverse anticipée via la
// carte des menaces). On retient les mouvements de la posture la mieux évaluée.
// Les attaquants du plan d'assaut courant restent cloués ; une mémoire de tour
// (`state.aiMemo`) fournit l'hystérésis anti-oscillation.
export function aiMovePhase(state, side) {
  const ctx = strategicContext(state, side);
  const threat = buildThreatMap(state, side);               // menace adverse avant nos mouvements
  const supplyDist = buildSupplyDist(state.terrain, suppliedHexes(state, side)); // éloignement au ravito
  const fieldFn = buildFieldFn(state.terrain);              // champs de distance mémoïsés (par but)
  const objHexes = state.objectives.map((k) => { const [q, r] = k.split(',').map(Number); return { k, q, r }; });
  const memo = state.aiMemo?.[side];
  // Assauts déjà viables depuis les positions courantes : leurs attaquants ne
  // bougent pas (ils frapperont) ; les autres unités au contact restent LIBRES
  // de se redéployer — plus de pion gelé face à un ennemi inattaquable.
  const dry = planAttacks(state, side, ctx);
  const anchored = new Set(dry.flatMap((a) => a.atk));
  const engagedIds = new Set(dry.map((a) => a.def));
  const engagedTargets = dry
    .map((a) => state.units.find((u) => u.id === a.def))
    .filter(Boolean)
    .map((d) => ({ q: d.q, r: d.r }));
  const assault = planAssaults(state, side, ctx, anchored, engagedIds);
  const none = { assign: new Map(), targets: [] };
  let best = null;
  for (const p of POSTURES) {
    // `objControl` propre au sim : on peut y refléter les peuplements capturés
    // sans corrompre l'état réel (partagé par référence sinon).
    const sim = { ...state, units: state.units.map((u) => ({ ...u })), objControl: new Map(state.objControl) };
    const plan = planMoves(sim, side, p.w, {
      threat, supplyDist, objHexes, fieldFn, memo, anchored,
      assault: p.w.assault ? assault : none, engagedTargets, supplyMul: ctx.supplyMul,
    });
    updateObjectives(sim);                                   // peuplements occupés → sources de ravito
    updateSupply(sim);                                       // recalcule `supplied` APRÈS les déplacements
    // Le rollout crédite aussi le GAIN des assauts jouables depuis la position :
    // sans lui, l'approche n'aurait que des coûts d'exposition et l'IA
    // s'installerait dans une impasse pacifiste.
    const gain = planAttacks(sim, side, ctx).reduce((g, a) => g + a.net + (a.onObj ? 1.5 : 0), 0);
    const val = evaluate(sim, side, fieldFn, ctx, threat) + W_ASSAULT * gain;
    if (!best || val > best.val) best = { val, ...plan };
  }
  // Mémoire d'hystérésis : buts retenus et positions de départ de ce tour.
  const lastPos = new Map(state.units.filter((u) => u.side === side).map((u) => [u.id, key(u.q, u.r)]));
  state.aiMemo = { ...state.aiMemo, [side]: { goals: best.goals, lastPos } };
  return best.moves;
}

// Construit un plan de mouvement (une destination par unité) sur `sim`, sous les
// poids `w` et l'environnement partagé `env`. Les unités suivantes voient les
// déplacements déjà planifiés. Renvoie { moves, goals } — les buts alimentent
// l'hystérésis du tour suivant.
function planMoves(sim, side, w, env) {
  const { threat, supplyDist, objHexes, fieldFn, memo, anchored, assault, engagedTargets } = env;
  const we = { ...w, supply: w.supply * (env.supplyMul ?? 1) }; // ancre de ravito modulée par le score
  const moves = [];
  const goals = new Map();
  const supportGoal = assault.targets[0] ?? engagedTargets[0] ?? null; // cible d'appui pour l'artillerie
  for (const u of sim.units.filter((x) => x.side === side && x.mpLeft > 0)) {
    if (anchored.has(u.id)) continue;                       // cloué : il frappera en phase de combat
    const here = key(u.q, u.r);
    const assaultK = assault.assign.get(u.id);
    if (assaultK === here) continue;                        // déjà sur sa case d'assaut : ancre
    const enemies = sim.units.filter((e) => e.side !== side);
    if (assaultK) {
      const { reachable, dist, eZOC } = computeReachable(sim, u);
      if (reachable.has(assaultK)) {                        // converge sur la cible d'assaut
        moveUnit(u, assaultK, dist, eZOC);
        moves.push({ id: u.id, to: assaultK });
        goals.set(u.id, assaultK);
        continue;
      }                                                      // case devenue injouable : scoring normal
    }
    const goal = chooseGoal(sim, side, u, enemies, objHexes, threat, memo, u.type === 'arty' ? supportGoal : null);
    if (!goal) continue;
    const goalK = key(goal.q, goal.r);
    goals.set(u.id, goalK);
    const field = fieldFn(goalK);                            // chemin réel vers le but
    const { reachable, dist, eZOC } = computeReachable(sim, u);
    if (!reachable.size) continue;
    let bestK = null, bestScore = scoreHex(sim, side, u, here, field, enemies, supplyDist, we, threat, memo, goal);
    for (const hk of reachable) {
      const sc = scoreHex(sim, side, u, hk, field, enemies, supplyDist, we, threat, memo, goal);
      if (sc > bestScore) { bestScore = sc; bestK = hk; }
    }
    if (bestK) { moveUnit(u, bestK, dist, eZOC); moves.push({ id: u.id, to: bestK }); }
  }
  return { moves, goals };
}

// Plus proche élément de `arr` (unités ou `{k,q,r}`) au sens de la distance
// hexagonale ; le but du tour précédent (`prev`, clé d'hex) compte GOAL_STICKY
// hexes de moins — l'hystérésis évite de basculer de but à distance quasi égale.
function nearestOf(u, arr, filt, prev) {
  let best = null, bd = Infinity;
  for (const o of arr) {
    if (filt && !filt(o)) continue;
    const d = hexDistance(u.q, u.r, o.q, o.r) - (prev && o.k === prev ? GOAL_STICKY : 0);
    if (d < bd) { bd = d; best = o; }
  }
  return best && { hex: best, d: bd };
}

// But d'une unité : au plus proche entre l'ennemi, un objectif à prendre et un
// objectif tenu à GARDER (menacé et sans garnison). Une unité déjà postée sur
// un objectif menacé tient sa position. L'artillerie vise la cible d'assaut à
// appuyer, sinon le front.
function chooseGoal(sim, side, u, enemies, objHexes, threat, memo, supportGoal) {
  if (u.type === 'arty') {
    if (supportGoal) return supportGoal;
    const enemy = nearestOf(u, enemies);
    const objective = nearestOf(u, objHexes, (o) => sim.objControl.get(o.k) !== side);
    return enemy ? enemy.hex : objective && objective.hex;
  }
  const here = key(u.q, u.r);
  if (objHexes.some((o) => o.k === here) && sim.objControl.get(here) === side
      && (threat.get(here) || 0) > 0) return { q: u.q, r: u.r };   // garnison : tenir
  const prev = memo?.goals?.get(u.id);
  const enemy = nearestOf(u, enemies, null, prev);
  const objective = nearestOf(u, objHexes, (o) => sim.objControl.get(o.k) !== side, prev);
  const guard = nearestOf(u, objHexes, (o) =>
    sim.objControl.get(o.k) === side && (threat.get(o.k) || 0) > 0
    && !sim.units.some((f) => f.side === side && f.q === o.q && f.r === o.r), prev);
  let best = null;
  for (const c of [guard, enemy, objective]) if (c && (!best || c.d < best.d)) best = c;
  return best && best.hex;
}

// Qualité d'un hexe pour une unité, pondérée par la posture : se rapprocher du
// but (stratégie), chercher le bon contact et le terrain défensif, rester
// ravitaillé et groupé, éviter l'exposition, le sur-empilement et les
// allers-retours (hystérésis).
function scoreHex(sim, side, u, hk, field, enemies, supplyDist, w, threat, memo, goal) {
  const [q, r] = hk.split(',').map(Number);
  let s = -w.goal * (field.get(hk) ?? 999);                  // distance de chemin réel au but
  const adj = enemies.filter((e) => hexDistance(q, r, e.q, e.r) === 1);
  const terr = TERRAIN[sim.terrain.get(hk)];
  if (u.type === 'arty') {
    if (hexDistance(q, r, goal.q, goal.r) <= ARTY_RANGE) s += 1.5;                // à portée d'appui de SA cible
    if (adj.length) s -= 3;                                                       // ne pas s'exposer
  } else {
    for (const e of adj) s += w.contact * Math.min(3, eAtk(u) / Math.max(1, eDef(e))); // viser le plus faible
    if (adj.length && terr) s += w.terrainDef * terr.def * 0.4;                   // se poster sur du défensif
    s -= w.expose * Math.min(6, (threat.get(hk) || 0) / Math.max(1, eDef(u))) * EXPOSE_K; // fuir l'exposition (plafond CRT)
  }
  const over = supplyDist.get(hk) ?? 20;                     // hexes au-delà du réseau de ravito
  s -= w.supply * SUP_K * over * over;                       // s'en éloigner coûte de plus en plus cher
  if (w.support) {                                                                // rester groupé
    let friends = 0;
    for (const f of sim.units) if (f.side === side && f.id !== u.id && hexDistance(q, r, f.q, f.r) <= 2) friends++;
    s += w.support * 0.5 * friends;
  }
  // Sur-empilement : soi-même exclu, sinon rester sur place serait pénalisé
  // face à un hex voisin équivalent — un moteur d'oscillation.
  s -= w.stack * (stackCount(sim.units, q, r, side) - (u.q === q && u.r === r ? 1 : 0)) * 0.4;
  if (memo && memo.lastPos.get(u.id) === hk && key(u.q, u.r) !== hk) s -= BACKTRACK; // ne pas revenir sur ses pas
  return s;
}
