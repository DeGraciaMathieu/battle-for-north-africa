// ===========================================================================
//  HUD (DOM) : journal, badges de tour/phase, inspecteur, bulle de confirmation
//  de déplacement, info-bulle d'hexe et écran de fin. `refresh()` resynchronise
//  tout l'affichage (plateau compris) sur l'état après chaque action ; le HTML
//  vient des fabriques pures de html.js.
// ===========================================================================

import { axialToPixel } from '../src/geometry.js';
import { updateSupply } from '../src/supply.js';
import { updateObjectives } from '../src/game.js';
import { sideLabel, hexRecapHtml, inspectorHtml, objbarHtml, hintHtml, phaseBtnLabel, recapHtml } from './html.js';

const PIXI = window.PIXI;
const $ = (id) => document.getElementById(id);

export function createHud({ state, stage, ui, session, myTurn, counters, overlay }) {
  const logLines = [];
  function log(s) {
    logLines.unshift(s);
    if (logLines.length > 8) logLines.pop();
    $('logBody').innerHTML = logLines.map((l) => `<div class="line">${l}</div>`).join('');
  }

  // -- Bulles ancrées à un hexe (confirmation de déplacement, percée) --------
  function positionTooltipAt(id, q, r) {
    const { x, y } = axialToPixel(q, r);
    const g = stage.world.toGlobal(new PIXI.Point(x, y));
    const rc = stage.app.canvas.getBoundingClientRect();
    const el = $(id);
    el.style.left = rc.left + g.x + 'px';
    el.style.top = rc.top + g.y + 'px';
  }
  function positionMoveTooltip() {
    if (ui.pending) positionTooltipAt('moveConfirm', ui.pending.q, ui.pending.r);
  }
  function showMoveTooltip() {
    $('btnSelectMove').style.display = ui.pending.hasOwn ? '' : 'none';
    $('moveConfirm').style.display = 'flex';
    positionMoveTooltip();
  }
  // Percée proposée après un combat : bulle sur l'hexe conquis.
  function positionAdvanceTooltip() {
    if (ui.pendingAdvance) positionTooltipAt('advanceTip', ui.pendingAdvance.to.q, ui.pendingAdvance.to.r);
  }
  function showAdvanceTooltip() {
    $('advanceTipLabel').innerHTML = `Percée : <b>${ui.pendingAdvance.name}</b> peut avancer ici.`;
    $('advanceTip').style.display = 'flex';
    positionAdvanceTooltip();
  }

  function refresh() {
    updateObjectives(state);
    updateSupply(state);
    counters.rebuild();
    counters.layout();
    overlay.drawOverlay();
    if (state.G.phase === 'move' && ui.pending) showMoveTooltip();
    else $('moveConfirm').style.display = 'none';
    if (state.G.phase === 'combat' && ui.pendingAdvance) showAdvanceTooltip();
    else $('advanceTip').style.display = 'none';
    $('turnNum').textContent = state.G.turn;
    const sb = $('badgeSide');
    sb.textContent = sideLabel(state.G.player);
    sb.className = 'badge ' + state.G.player;
    $('badgePhase').textContent = state.G.phase === 'move' ? 'MOUVEMENT' : 'COMBAT';
    $('hint').innerHTML = hintHtml(state);
    $('btnPhase').textContent = phaseBtnLabel(state.G);
    $('inspBody').innerHTML = inspectorHtml(state, ui.sel, ui.attackers);
    $('objbar').innerHTML = objbarHtml(state);
    if (session.isOnline) {
      const mine = myTurn();
      $('btnPhase').disabled = !mine;
      if (session.netLost) $('hint').textContent = 'Connexion perdue.';
      else if (!mine) $('hint').innerHTML = `⏳ Tour de l'adversaire — <b>${sideLabel(state.G.player)}</b>. Patiente…`;
    } else if (session.isAI) {
      const mine = myTurn();
      $('btnPhase').disabled = !mine;
      if (!mine) $('hint').innerHTML = `🤖 Tour de l'IA — <b>${sideLabel(session.aiSide)}</b> réfléchit…`;
    }
    stage.draw();
  }

  // -- Info-bulle de survol : récap de l'hexe après une courte pause --------
  const HOVER_DELAY = 300;
  let hoverTimer = null, hoverPos = null;
  const hexTip = {
    // Suit le curseur : la bulle programmée s'affichera à la DERNIÈRE position.
    move(pos) { hoverPos = pos; },
    hide() {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      $('hexTip').style.display = 'none';
    },
    schedule(k) {
      hexTip.hide();
      hoverTimer = setTimeout(() => show(k), HOVER_DELAY);
    },
  };
  function show(k) {
    const el = $('hexTip');
    el.innerHTML = hexRecapHtml(state, k);
    el.style.display = 'block';
    const rc = stage.app.canvas.getBoundingClientRect();
    let left = rc.left + hoverPos.x + 16, top = rc.top + hoverPos.y + 16;
    if (left + el.offsetWidth > window.innerWidth) left = rc.left + hoverPos.x - el.offsetWidth - 16;
    if (top + el.offsetHeight > window.innerHeight) top = window.innerHeight - el.offsetHeight - 8;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  // -- Écran de fin : bannière, récap et boutons ------------------------------
  function showGameOver(side, reason) {
    $('bannerTitle').textContent = `Victoire du camp ${sideLabel(side)}`;
    $('bannerSub').textContent = reason;
    $('bannerRecap').innerHTML = recapHtml(state, side);
    $('banner').style.display = 'flex';
  }
  $('bannerBtn').onclick = () => { // nouvelle carte, mêmes armées
    const p = new URLSearchParams(location.search);
    p.delete('seed');
    p.delete('map'); // carte aléatoire fraîche
    location.href = 'game' + (p.toString() ? `?${p.toString()}` : ''); // URL propre (garde la query)
  };
  $('bannerView').onclick = () => { // masque l'écran de fin pour inspecter la carte
    $('banner').style.display = 'none';
    $('btnResult').style.display = ''; // bouton pour rouvrir le résultat
  };
  $('btnResult').onclick = () => { // rouvre l'écran de fin
    $('banner').style.display = 'flex';
    $('btnResult').style.display = 'none';
  };
  $('bannerHome').onclick = () => { location.href = '/'; }; // retour à l'accueil

  return { log, refresh, positionMoveTooltip, positionAdvanceTooltip, hexTip, showGameOver };
}
