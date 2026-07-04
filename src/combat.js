// ===========================================================================
//  Combat — table CRT, résolution, recul et avance après combat.
//
//  Le jet de dé passe par `state.rng` (Math.random par défaut) : injecter un
//  RNG déterministe rend les combats reproductibles dans les tests.
//  Les pertes n'émettent PAS de rendu : elles muent l'état et publient des
//  événements ('unitReduced' / 'unitRemoved') sur `state.bus`.
// ===========================================================================

import { STACK_MAX, TERRAIN, ODDS, CRT, RESULT_FR, ARTY_RANGE, DIRS } from './config.js';
import { key, hexDistance, clamp } from './geometry.js';
import { eAtk, eDef, other, unitsAt, enemyAt, stackCount, isArmor, isFoot } from './units.js';
import { zocOf } from './movement.js';

// Colonne d'odds (index dans ODDS) à partir du rapport atk/def.
export function oddsIndex(atk, def) {
  if (def <= 0) return 7;
  const r = atk / def;
  return r < 0.5 ? 0 : r < 1 ? 1 : r < 2 ? 2 : r < 3 ? 3 : r < 4 ? 4 : r < 5 ? 5 : r < 6 ? 6 : 7;
}

// Élimination définitive : retire le pion de l'état et notifie le rendu.
export function removeUnit(state, u) {
  state.units = state.units.filter((x) => x !== u);
  state.bus.emit('unitRemoved', u);
}

// Réduction par palier : recto → verso, puis élimination. true si l'unité survit.
export function hitUnit(state, u) {
  if (u.reduced) {
    removeUnit(state, u);
    return false;
  }
  u.reduced = true;
  state.bus.emit('unitReduced', u);
  return true;
}

// Cases de recul valides : terre, pas d'ennemi, empilement libre, hors ZOC ennemie.
export function retreatOptions(state, unit, awayQ, awayR) {
  const { units, terrain } = state;
  const eZOC = zocOf(units, other(unit.side), terrain);
  const opts = [];
  for (const [dq, dr] of DIRS) {
    const nq = unit.q + dq, nr = unit.r + dr, k = key(nq, nr);
    if (!terrain.has(k) || !isFinite(TERRAIN[terrain.get(k)].cost)) continue;
    if (enemyAt(units, nq, nr, unit.side)) continue;
    if (stackCount(units, nq, nr, unit.side) >= STACK_MAX) continue;
    if (eZOC.has(k)) continue;                              // reculer en ZOC = interdit
    opts.push({ nq, nr, d: hexDistance(nq, nr, awayQ, awayR) });
  }
  opts.sort((a, b) => b.d - a.d);                           // le plus loin de l'ennemi
  return opts;
}

// Recule d'un hex ; si aucun recul possible, le pion est éliminé.
export function retreatOrDie(state, unit, awayQ, awayR) {
  const o = retreatOptions(state, unit, awayQ, awayR);
  if (!o.length) {
    removeUnit(state, unit);
    return false;
  }
  unit.q = o[0].nq;
  unit.r = o[0].nr;
  return true;
}

// Résout un combat : calcule la colonne (odds + décalages), tire le dé,
// applique le résultat CRT, gère l'avance après combat. Renvoie { col, die, res }.
// Plan de combat : tout le déterministe AVANT le dé (aucune mutation, aucun jet).
// Permet d'afficher forces, décalages et colonne pour décider d'engager ou non.
export function combatPlan(state, attackers, defender) {
  const { terrain } = state;
  const atk = attackers.reduce((s, u) => s + eAtk(u), 0);   // attaque effective
  const terr = TERRAIN[terrain.get(key(defender.q, defender.r))].def; // décalage terrain
  // Armes combinées : au moins un blindé ET une unité à pied → +1 colonne.
  const combined = attackers.some(isArmor) && attackers.some(isFoot) ? 1 : 0;
  // Appui d'artillerie : pièces amies ravitaillées, à portée, HORS pile → +1 (max +2).
  const side = attackers[0].side;
  const inPile = new Set(attackers.map((a) => a.id));
  let arty = 0;
  for (const u of state.units) {
    if (u.side === side && u.type === 'arty' && !inPile.has(u.id) && u.supplied
        && hexDistance(u.q, u.r, defender.q, defender.r) <= ARTY_RANGE) arty++;
  }
  arty = Math.min(arty, 2);
  const def = eDef(defender);
  const idx = clamp(oddsIndex(atk, def) + combined + arty - terr, 0, 7);
  return {
    attackers: attackers.map((a) => a.fullName ?? a.name),
    breakdown: attackers.map((a) => ({ name: a.fullName ?? a.name, atk: eAtk(a), reduced: a.reduced })),
    atk,
    defender: defender.fullName ?? defender.name,
    def,
    defReduced: defender.reduced,
    defSupplied: defender.supplied,
    baseCol: ODDS[oddsIndex(atk, def)],                     // colonne avant décalages
    combined, arty, terr,
    idx, col: ODDS[idx],                                    // colonne finale
  };
}

export function resolveCombat(state, attackers, defender) {
  const { bus } = state;
  const plan = combatPlan(state, attackers, defender);
  const { col, combined, arty, terr } = plan;
  const die = 1 + Math.floor(state.rng() * 6);
  const res = CRT[col][die - 1];
  const defHex = { q: defender.q, r: defender.r };
  const atkRef = attackers[0];                              // point de fuite pour reculs

  // Conséquences narrées, remplies au fil de la résolution.
  const nm = (u) => u.fullName ?? u.name;
  const dName = plan.defender;
  const effects = [];
  const summary = { ...plan, die, res, result: RESULT_FR[res], effects };

  if (res === 'DE') {
    effects.push(hitUnit(state, defender) ? `${dName} est réduit.` : `${dName} est éliminé.`);
  } else if (res === 'DR') {
    effects.push(retreatOrDie(state, defender, atkRef.q, atkRef.r)
      ? `${dName} recule d'un hexe.` : `${dName}, sans repli possible, est éliminé.`);
  } else if (res === 'EX') {
    effects.push(hitUnit(state, defender) ? `${dName} est réduit.` : `${dName} est éliminé.`); // palier
    let lost = 0;
    const sorted = [...attackers].sort((a, b) => eAtk(a) - eAtk(b));
    for (const a of sorted) {
      if (lost >= eDef(defender)) break;
      lost += eAtk(a);
      effects.push(hitUnit(state, a) ? `${nm(a)} est réduit (échange).` : `${nm(a)} est éliminé (échange).`);
    }
  } else if (res === 'AR') {
    for (const a of [...attackers]) {
      effects.push(retreatOrDie(state, a, defender.q, defender.r)
        ? `${nm(a)} est repoussé d'un hexe.` : `${nm(a)}, sans repli possible, est éliminé.`);
    }
  } else if (res === 'AE') {
    for (const a of [...attackers]) {
      effects.push(hitUnit(state, a) ? `${nm(a)} est réduit.` : `${nm(a)} est éliminé.`);
    }
  }

  // Avance après combat : si l'hex du défenseur est libéré, un attaquant y entre.
  if ((res === 'DE' || res === 'DR') && unitsAt(state.units, defHex.q, defHex.r).length === 0) {
    const adv = attackers
      .filter((a) => state.units.includes(a) && hexDistance(a.q, a.r, defHex.q, defHex.r) === 1)
      .sort((a, b) => eAtk(b) - eAtk(a))[0];
    if (adv && stackCount(state.units, defHex.q, defHex.r, adv.side) < STACK_MAX) {
      adv.q = defHex.q;
      adv.r = defHex.r;
      effects.push(`${nm(adv)} avance sur la position conquise.`);
    }
  }
  if (!effects.length) effects.push('Aucune perte.');
  attackers.forEach((a) => {
    if (state.units.includes(a)) a.hasFought = true;
  });

  const mods = [];
  if (combined) mods.push('combiné +1');
  if (arty) mods.push(`artillerie +${arty}`);
  if (terr) mods.push(terr > 0 ? `terrain −${terr}` : `terrain +${-terr}`); // <0 = malus → +colonnes attaquant
  const modStr = mods.length ? ` (${mods.join(', ')})` : '';
  bus.emit('log', `<b>${col}</b>${modStr}, dé ${die} → ${RESULT_FR[res]}`);
  bus.emit('combatResolved', summary);
  return { col, die, res };
}
