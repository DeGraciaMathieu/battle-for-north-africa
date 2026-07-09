// ===========================================================================
//  Modale de combat : aperçu du calcul (duel, table CRT), animation du dé dans
//  la colonne active, révélation du résultat et des conséquences, décision
//  d'engager. Rejoue aussi en spectateur les combats distants (adversaire en
//  ligne, IA) — le RNG semé garantit un dé identique des deux côtés.
// ===========================================================================

import { resolveCombat, combatPlan } from '../src/combat.js';
import { combatCalcHtml, crtTableHtml } from './html.js';

const $ = (id) => document.getElementById(id);

export function createCombatModal({ state, stage, ui, session, fx, hud, overlay }) {
  // Modale animée explicitant le déroulé d'un combat : en-tête → dé qui défile
  // → résultat coloré → conséquences narrées une à une.
  let combatTimers = [];
  const clearCombatTimers = () => { combatTimers.forEach(clearTimeout); combatTimers = []; };
  const at = (fn, ms) => combatTimers.push(setTimeout(fn, ms));

  // Aperçu AVANT le dé : stats, colonne, issues possibles, et décision.
  function showCombatPreview(atkUnits, defender, spectator = false) {
    if (state.G.over) return;
    clearCombatTimers();
    const p = combatPlan(state, atkUnits, defender);
    ui.pendingCombat = { atkUnits, defender };
    $('combatBody').innerHTML = combatCalcHtml(p);
    $('combatTable').innerHTML =
      `<div class="sub" style="margin-top:6px">Table de combat — ta colonne <b>${p.col}</b> surlignée (droite = plus favorable à l'attaquant) :</div>`
      + crtTableHtml(p.col, -1);
    $('combatRes').textContent = '';
    $('combatRes').style.background = 'transparent';
    $('combatEffects').innerHTML = '';
    $('combatBtn').style.display = 'none';
    $('combatBtns').style.display = spectator ? 'none' : 'flex'; // spectateur : pas de décision, on regarde le dé
    if (spectator) ui.pendingCombat = null;
    $('combatModal').style.display = 'flex';
  }

  // Anime le dé DANS la colonne active de la table de l'aperçu (sans reconstruire
  // la modale) : un surlignage parcourt la colonne, se fige sur la case du dé,
  // puis on révèle résultat et conséquences.
  function runRoll(p) {
    if (state.G.over) return; // la victoire est déjà annoncée
    clearCombatTimers();
    const cells = [...document.querySelectorAll('#combatTable td.colon')];
    cells.forEach((c) => c.classList.remove('hit', 'roll'));
    if (!cells.length) { revealAfterRoll(p); return; }
    let ticks = 0, prev = -1;
    const spin = () => {
      if (prev >= 0) cells[prev].classList.remove('roll');
      if (ticks < 12) {
        let i;
        do { i = Math.floor(Math.random() * cells.length); } while (i === prev && cells.length > 1);
        cells[i].classList.add('roll');
        prev = i;
        ticks++;
        at(spin, 55 + ticks * 12);
      } else {
        cells[p.die - 1].classList.add('hit');
        at(() => revealAfterRoll(p), 350);
      }
    };
    at(spin, 150);
  }
  function revealAfterRoll(p) {
    const good = p.res === 'DE' || p.res === 'DR'; // favorable à l'attaquant
    const resEl = $('combatRes');
    resEl.textContent = `Dé ${p.die} → ${p.result}`;
    resEl.style.background = good ? 'rgba(111,154,92,.22)' : p.res === 'EX' ? 'rgba(232,185,90,.18)' : 'rgba(179,58,42,.22)';
    resEl.style.color = good ? '#a8d488' : p.res === 'EX' ? '#e8b95a' : '#e0937f';
    const box = $('combatEffects');
    box.innerHTML = '';
    p.effects.forEach((e, i) => at(() => {
      const d = document.createElement('div');
      d.className = 'fx';
      d.textContent = '• ' + e;
      box.appendChild(d);
    }, 300 * (i + 1)));
    at(() => { $('combatBtn').style.display = 'block'; $('combatBtn').style.visibility = 'visible'; },
      300 * (p.effects.length + 1));
  }

  function closeCombat() {
    clearCombatTimers();
    $('combatModal').style.display = 'none';
    hud.refresh(); // le plateau ne reflète pertes/reculs qu'à la fermeture
    fx.fxQueue.splice(0).forEach(({ q, r, kind, id }) => { // effets une fois la modale fermée
      fx.spawnFx(q, r, kind);
      if (kind === 'hit') fx.flipUnit(id); // unité réduite : on retourne sa tuile
    });
  }

  $('combatBtn').onclick = closeCombat;
  $('btnRollCombat').onclick = () => {
    if (!ui.pendingCombat) return;
    const { atkUnits, defender } = ui.pendingCombat;
    ui.pendingCombat = null;
    ui.artyPreview = []; // le combat s'engage : plus d'aperçu
    $('combatBtns').style.display = 'none';
    session.send({ t: 'combat', atk: atkUnits.map((u) => u.id), def: defender.id });
    fx.fxQueue.length = 0;
    resolveCombat(state, atkUnits, defender); // → combatResolved → runRoll (anime la colonne)
    ui.attackers.clear();
    // le plateau n'est synchronisé qu'à la fermeture (closeCombat) : pas de spoiler pendant l'animation du dé
    if (state.G.over) { $('combatModal').style.display = 'none'; hud.refresh(); } // le bandeau de victoire prend le relais
  };
  $('btnRefuseCombat').onclick = () => {
    ui.pendingCombat = null;
    ui.artyPreview = [];
    $('combatModal').style.display = 'none';
    overlay.drawOverlay();
    stage.draw();
    hud.log('Combat refusé.');
  };

  // Rejoue le combat de l'adversaire (en ligne ou IA) pour que le spectateur
  // voie le même dé : le RNG semé garantit un résultat identique côté distant.
  function remoteCombat(atkUnits, defender) {
    showCombatPreview(atkUnits, defender, true);
    fx.fxQueue.length = 0;
    resolveCombat(state, atkUnits, defender); // → combatResolved → runRoll (anime la colonne)
    ui.attackers.clear();
    // synchro du plateau différée à closeCombat pour ne rien dévoiler avant la fin du dé
    if (state.G.over) { $('combatModal').style.display = 'none'; hud.refresh(); }
  }

  return { showCombatPreview, runRoll, closeCombat, remoteCombat };
}
