// ===========================================================================
//  Fabrique des fragments HTML du HUD, des info-bulles et de la modale de
//  combat. Fonctions PURES : elles lisent l'état et renvoient des chaînes,
//  sans toucher au DOM ni à PixiJS — c'est la partie testable du rendu.
// ===========================================================================

import { TERRAIN, MAX_TURNS, CRT, ODDS, ARTY_RANGE } from '../src/config.js';
import { eAtk, eDef, eMov, unitsAt, isArmor, isFoot } from '../src/units.js';
import { supplyRoutes } from '../src/supply.js';
import { objCount, victoryScore } from '../src/game.js';

export const sideLabel = (s) => (s === 'blue' ? 'BLEU' : 'ROUGE');

// -- Info-bulle de survol : récap de l'hexe k -------------------------------
export function hexRecapHtml(state, k) {
  const [q, r] = k.split(',').map(Number);
  const t = TERRAIN[state.terrain.get(k)];
  let html = `<div class="kv"><span>Terrain</span><span><b>${t.name}</b></span></div>`;
  if (isFinite(t.cost)) html += `<div class="kv"><span>Coût / Déf</span><span>${t.cost} PM · +${t.def} déf</span></div>`;
  else html += '<div class="sub">Infranchissable</div>';
  if (state.objectives.includes(k)) {
    const ctrl = state.objControl.get(k);
    html += `<div class="kv"><span>Objectif</span><span>${ctrl ? sideLabel(ctrl) : 'neutre'}</span></div>`;
  }
  if (isFinite(t.cost)) {
    const side = state.G.player;
    const { supplied, reach } = supplyRoutes(state, side);
    const camp = sideLabel(side);
    html += supplied.has(k)
      ? `<div class="kv"><span>Ravito ${camp}</span><span>portée ${reach.get(k)}</span></div>`
      : `<div class="kv"><span>Ravito ${camp}</span><span style="color:#e08a2a">hors portée</span></div>`;
  }
  const here = unitsAt(state.units, q, r);
  if (here.length) {
    html += '<div class="sub" style="margin-top:4px;border-top:1px solid #48412c;padding-top:4px">Unités :</div>';
    for (const u of here) {
      const camp = sideLabel(u.side);
      html += `<div class="kv"><span>${u.fullName} <span class="sub">(${camp})</span></span>`
        + `<span>${eAtk(u)}-${eDef(u)}-${eMov(u)}${u.reduced ? ' <span style="color:#d16a55">réd.</span>' : ''}</span></div>`;
    }
    if (here.length > 1) {
      const tAtk = here.reduce((s, u) => s + eAtk(u), 0);
      const tDef = here.reduce((s, u) => s + eDef(u), 0);
      html += `<div class="kv" style="margin-top:2px;border-top:1px solid #48412c;padding-top:2px">`
        + `<span><b>Total (${here.length} pions)</b></span><span><b>${tAtk} atk · ${tDef} déf</b></span></div>`;
    }
  }
  return html;
}

// -- Panneau inspecteur : sélection courante (unité ou attaquants) ----------
export function inspectorHtml(state, sel, attackers) {
  if (state.G.phase === 'move' && sel) {
    const u = sel.unit;
    const sup = u.supplied
      ? '<span style="color:#8fbf6a">ravitaillée</span>'
      : '<span style="color:#e08a2a">HORS ravito</span>';
    return `<div class="kv"><span>Unité</span><span><b>${u.name}</b>${u.reduced ? ' <span style="color:#d16a55">(réduite)</span>' : ''}</span></div>`
      + `<div class="sub" style="margin:-2px 0 3px">${u.fullName}</div>`
      + `<div class="kv"><span>Att-Déf-Mvt</span><span>${eAtk(u)}-${eDef(u)}-${eMov(u)}</span></div>`
      + `<div class="kv"><span>Ravitaillement</span><span>${sup}</span></div>`
      + `<div class="kv"><span>PM restants</span><span><b>${u.mpLeft}</b></span></div>`;
  }
  if (state.G.phase === 'combat' && attackers.size) {
    const as = [...attackers].map((id) => state.units.find((u) => u.id === id)).filter(Boolean);
    const combo = as.some(isArmor) && as.some(isFoot);
    return `<div class="kv"><span>Attaquants</span><span>${as.map((u) => u.name).join(', ')}</span></div>`
      + `<div class="kv"><span>Force totale</span><span><b>${as.reduce((s, u) => s + eAtk(u), 0)}</b></span></div>`
      + `<div class="kv"><span>Armes combinées</span><span>${combo ? '<span style="color:#8fbf6a">✓ +1 colonne</span>' : '<span style="color:#8a8064">—</span>'}</span></div>`
      + `<div class="sub" style="margin-top:4px">Clique l'unité ennemie à attaquer. L'artillerie amie à portée ajoutera son appui.</div>`;
  }
  return '<span class="empty">Aucune sélection.</span>';
}

// -- Barre d'objectifs et textes de phase -----------------------------------
export function objbarHtml(state) {
  return `<div class="kv"><span>Objectifs</span>`
    + `<span><b>${objCount(state, 'blue')}</b> ${sideLabel('blue')} · <b>${objCount(state, 'red')}</b> ${sideLabel('red')} · ${state.objectives.length} au total</span></div>`
    + `<div class="sub">Le camp contrôlant le plus d'objectifs au tour ${MAX_TURNS} l'emporte.</div>`;
}

export function hintHtml(state) {
  const camp = 'du camp ' + sideLabel(state.G.player);
  return state.G.phase === 'move'
    ? `Clique une unité ${camp} pour voir ses déplacements, puis un hexagone surligné. Entrer dans une ZOC ennemie (rouge) stoppe l'unité.`
    : `Clique tes unités adjacentes à l'ennemi pour désigner les attaquants (vert), puis l'unité ennemie à assaillir (rouge). Blindé + infanterie et artillerie à portée (≤${ARTY_RANGE} hex) décalent la table en ta faveur.`;
}

export function phaseBtnLabel(G) {
  return G.phase === 'move' ? 'Passer au combat ▸'
    : G.player === 'blue' ? 'Fin de tour Bleu → Rouge ▸' : `Fin du tour ${G.turn} ▸`;
}

// -- Modale de combat --------------------------------------------------------
// Version visuelle du calcul (aperçu, avant décision) : duel Attaque/Défense,
// chaque nombre est traçable — recto barré des pions réduits, chaîne de calcul
// de la défense, puis un décalage de colonne par ligne avec sa cause.
export const combatCalcHtml = (p) => {
  const chips = p.breakdown
    .map((b) => `<span class="chip">${b.name} ${b.reduced ? `<s>${b.raw}</s> ` : ''}<b>${b.atk}</b>${b.reduced ? ' <span class="rd">réd.</span>' : ''}</span>`)
    .join('');
  // Défense : une ligne par malus, avec l'arithmétique (recto → verso, ÷2).
  const dn = [];
  if (p.defReduced) dn.push(`réduite : <s>${p.defFull}</s> → ${p.defBase}`);
  if (!p.defSupplied) dn.push(`hors ravito : ${p.defBase} ÷ 2 → ${p.def}`);
  const defNote = dn.length ? `<span class="dn">${dn.join('<br>')}</span>` : '';
  const ratio = (p.atk / p.def).toFixed(1).replace('.', ',');
  // Décalages de colonne : une ligne par cause (vert = vers la droite,
  // favorable à l'attaquant ; rouge = vers la gauche).
  const cols = (n) => `${n > 0 ? '+' : '−'}${Math.abs(n)} colonne${Math.abs(n) > 1 ? 's' : ''}`;
  const row = (n, label) => `<div class="shift ${n > 0 ? 'up' : 'down'}"><b>${cols(n)}</b><span>${label}</span></div>`;
  const shifts = [];
  if (p.combined) shifts.push(row(1, 'armes combinées — blindé + infanterie ensemble'));
  if (p.arty) shifts.push(row(p.arty, `appui d'artillerie — ${p.artyCount} pièce${p.artyCount > 1 ? 's' : ''} à portée${p.artyCount > 2 ? ' (plafond +2)' : ''}`));
  if (p.terr) shifts.push(row(-p.terr, `terrain du défenseur — ${p.terrName}${p.terr < 0 ? ' (exposé)' : ''}`));
  // Butée : la table s'arrête à 1:3 / 6:1, le décalage réel peut être tronqué.
  const net = p.combined + p.arty - p.terr;
  const applied = p.idx - ODDS.indexOf(p.baseCol);
  const clampNote = shifts.length && applied !== net ? ' <span class="sub">(butée de table)</span>' : '';
  const final = shifts.length
    ? `<div class="shift total"><b>${p.baseCol}</b><span>décalée de <b>${net > 0 ? '+' : ''}${net}</b> → colonne <b class="finalcol">${p.col}</b>${clampNote}</span></div>`
    : `<div class="shift total"><span>aucun décalage → colonne <b class="finalcol">${p.col}</b></span></div>`;
  return `<div class="duel">`
    + `<div class="side atk"><div class="lab">Attaque</div><div class="big">${p.atk}</div><div class="chips">${chips}</div></div>`
    + `<div class="vs">contre</div>`
    + `<div class="side def"><div class="lab">Défense</div><div class="big">${p.def}</div><div class="chips"><span class="chip">${p.defender}</span></div>${defNote}</div>`
    + `</div>`
    + `<div class="flow"><span>Rapport <b>${p.atk} ÷ ${p.def} ≈ ${ratio}</b></span>`
    + `<span>→ colonne de base <b>${p.baseCol}</b></span></div>`
    + `<div class="shifts">${shifts.join('')}${final}</div>`;
};

// Table de combat complète : colonne active surlignée ; si `dieIdx >= 0`, la
// case (colonne active × dé) est mise en évidence. `baseCol` (optionnelle)
// pointille la colonne d'avant décalages pour visualiser le glissement.
export const crtTableHtml = (activeCol, dieIdx, baseCol = null) => {
  const marks = (c) => `${c === activeCol ? ' colon' : ''}${c === baseCol && baseCol !== activeCol ? ' basecol' : ''}`;
  let html = '<table class="crt"><tr><th>dé</th>';
  for (const c of ODDS) html += `<th class="${marks(c).trim()}">${c}</th>`;
  html += '</tr>';
  for (let d = 0; d < 6; d++) {
    html += `<tr><th>${d + 1}</th>`;
    for (const c of ODDS) {
      const active = c === activeCol;
      const code = CRT[c][d];
      html += `<td class="r-${code}${marks(c)}${active && d === dieIdx ? ' hit' : ''}">${code}</td>`;
    }
    html += '</tr>';
  }
  return html + '</table>'
    + '<div class="sub" style="margin-top:3px;font-size:10px">DE déf. éliminé · DR déf. repoussé · EX échange · AR att. repoussé · AE att. éliminé</div>'
    + '<div class="sub" style="font-size:10px;opacity:.85">Couleur = enjeu pour l\'attaquant : vert favorable, rouge défavorable.</div>';
};

// -- Récap de fin : score, objectifs tenus et pertes par camp ----------------
export function recapHtml(state, winner) {
  const rows = ['blue', 'red'].map((s) => {
    const alive = state.units.filter((u) => u.side === s);
    const eliminated = state.initialCount[s] - alive.length;
    const reduced = alive.filter((u) => u.reduced).length;
    const cls = s === winner ? ` class="winner"` : '';
    return `<tr${cls}><td class="side ${s}">${sideLabel(s)}</td>`
      + `<td>${victoryScore(state, s)}</td><td>${objCount(state, s)}</td>`
      + `<td>${eliminated}</td><td>${reduced}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Camp</th><th>Score</th><th>Objectifs</th><th>Éliminés</th><th>Réduits</th></tr></thead>`
    + `<tbody>${rows}</tbody></table>`;
}
