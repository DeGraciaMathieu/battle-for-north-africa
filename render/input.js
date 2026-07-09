// ===========================================================================
//  Entrées joueur : clics (sélection, déplacement, combat), glisser-déposer
//  des pions, survol (info-bulle, aperçu d'artillerie), molette/clavier/
//  boutons de caméra et bascules d'affichage. Traduit les gestes en appels de
//  règles ; n'affiche rien lui-même (délégué à hud/overlay/combatModal).
// ===========================================================================

import { key, pixelToAxial, hexDistance } from '../src/geometry.js';
import { unitsAt } from '../src/units.js';
import { computeReachable, moveUnit } from '../src/movement.js';
import { combatPlan } from '../src/combat.js';
import { endPhase } from '../src/game.js';

const $ = (id) => document.getElementById(id);

export function createInput({ state, stage, ui, session, myTurn, hud, overlay, combatModal, counters }) {
  const { app, world } = stage;
  const byId = (id) => state.units.find((u) => u.id === id);

  // -- Clics : sélection, déplacement, combat --------------------------------
  function handleClick(p) {
    if (state.G.over || !myTurn()) return;
    const { q, r } = pixelToAxial(p.x, p.y);
    const k = key(q, r);
    if (!state.terrain.has(k)) {
      ui.clearSel();
      hud.refresh();
      return;
    }
    if (state.G.phase === 'move') handleMove(q, r, k);
    else handleCombat(q, r);
    hud.refresh();
  }
  function handleMove(q, r, k) {
    const own = unitsAt(state.units, q, r).filter((u) => u.side === state.G.player);
    // Hex atteignable → déplacement en attente de confirmation (bulle sur l'hex).
    if (ui.sel && ui.sel.reachable.has(k)) {
      ui.pending = { key: k, q, r, hasOwn: own.length > 0 };
      return;
    }
    // Sinon : (dé)sélection d'une unité amie.
    ui.clearPending();
    ui.sel = own.length ? { unit: own[own.length - 1], ...computeReachable(state, own[own.length - 1]) } : null;
  }
  function confirmMove() {
    if (!ui.sel || !ui.pending) return;
    const id = ui.sel.unit.id, to = ui.pending.key;
    moveUnit(ui.sel.unit, to, ui.sel.dist, ui.sel.eZOC);
    session.send({ t: 'move', id, to });
    ui.sel = ui.sel.unit.mpLeft > 0 ? { unit: ui.sel.unit, ...computeReachable(state, ui.sel.unit) } : null;
    ui.clearPending();
    hud.refresh();
  }
  function selectPendingUnit() {
    if (!ui.pending) return;
    const [q, r] = ui.pending.key.split(',').map(Number);
    const own = unitsAt(state.units, q, r).filter((u) => u.side === state.G.player);
    ui.clearPending();
    ui.sel = own.length ? { unit: own[own.length - 1], ...computeReachable(state, own[own.length - 1]) } : null;
    hud.refresh();
  }

  // Attaquants retenus pour une cible en (q,r) : sélection explicite adjacente
  // et libre, sinon tous les amis adjacents libres. Partagé par le clic et le
  // survol (aperçu de l'appui d'artillerie).
  function attackersFor(q, r) {
    let atkUnits = [...ui.attackers].map((id) => byId(id)).filter(Boolean)
      .filter((u) => hexDistance(u.q, u.r, q, r) === 1 && !u.hasFought);
    if (!atkUnits.length) {
      atkUnits = state.units.filter((u) => u.side === state.G.player && !u.hasFought && hexDistance(u.q, u.r, q, r) === 1);
    }
    return atkUnits;
  }
  // Survol d'une cible ennemie en phase de combat → flèches des artilleries qui
  // appuieraient l'attaque (indication avant de cliquer). `q === null` : efface.
  function setArtyHover(q, r) {
    let next = [];
    if (!state.G.over && state.G.phase === 'combat' && myTurn() && q !== null) {
      const stack = unitsAt(state.units, q, r), top = stack[stack.length - 1];
      if (top && top.side !== state.G.player) {
        const atk = attackersFor(q, r);
        if (atk.length) next = combatPlan(state, atk, top).artyFrom.map((from) => ({ from, to: { q, r } }));
      }
    }
    const same = next.length === ui.artyPreview.length
      && next.every((n, i) => n.from.q === ui.artyPreview[i].from.q && n.from.r === ui.artyPreview[i].from.r);
    if (!same) { ui.artyPreview = next; overlay.drawOverlay(); stage.draw(); }
  }
  function handleCombat(q, r) {
    const stack = unitsAt(state.units, q, r);
    if (!stack.length) {
      ui.attackers.clear();
      return;
    }
    const top = stack[stack.length - 1];
    if (top.side !== state.G.player) { // clic ennemi → résoudre
      const atkUnits = attackersFor(q, r);
      if (!atkUnits.length) {
        hud.log('Aucun attaquant adjacent.');
        return;
      }
      combatModal.showCombatPreview(atkUnits, top); // aperçu → décider d'engager
    } else { // clic ami → (dé)sélection attaquant
      if (top.hasFought) return;
      if (!state.units.some((e) => e.side !== state.G.player && hexDistance(e.q, e.r, q, r) === 1)) return;
      if (ui.attackers.has(top.id)) ui.attackers.delete(top.id);
      else ui.attackers.add(top.id);
    }
  }

  // -- Survol : info-bulle d'hexe + aperçu d'artillerie ----------------------
  let hoverKey = null;
  function handleHover(e) {
    if (state.G.over || (ptr && ptr.moved)) { hoverKey = null; hud.hexTip.hide(); setArtyHover(null); return; }
    const p = world.toLocal(e.global);
    const { q, r } = pixelToAxial(p.x, p.y);
    const k = key(q, r);
    hud.hexTip.move({ x: e.global.x, y: e.global.y });
    if (!state.terrain.has(k)) { hoverKey = null; hud.hexTip.hide(); setArtyHover(null); return; }
    if (k === hoverKey) return; // même hexe : laisser le minuteur courir
    hoverKey = k;
    setArtyHover(q, r); // aperçu de l'appui d'artillerie sur la cible survolée
    hud.hexTip.schedule(k);
  }

  // -- Pointeur : glisser = pan, clic bref = action, molette/boutons = zoom --
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  let ptr = null;
  app.stage.on('pointerdown', (e) => {
    hoverKey = null;
    hud.hexTip.hide();
    ptr = { sx: e.global.x, sy: e.global.y, wx: world.x, wy: world.y, moved: false };
    // Saisir une unité amie déplaçable → glisser-déposer (au lieu de paner).
    if (!state.G.over && state.G.phase === 'move' && myTurn()) {
      const p = world.toLocal(e.global);
      const { q, r } = pixelToAxial(p.x, p.y);
      const own = state.terrain.has(key(q, r))
        ? unitsAt(state.units, q, r).filter((u) => u.side === state.G.player) : [];
      if (own.length) {
        ui.clearPending();
        ui.sel = { unit: own[own.length - 1], ...computeReachable(state, own[own.length - 1]) };
        ptr.dragUnit = ui.sel.unit;
        ui.dragOverKey = null;
        hud.refresh(); // reconstruit les pions
        const c = counters.get(ptr.dragUnit.id); // le pion saisi passe devant, se soulève et s'incline
        if (c) { stage.layers.unit.setChildIndex(c, stage.layers.unit.children.length - 1); c.scale.set(1.15); c.rotation = 0.14; stage.draw(); }
      }
    }
  });
  app.stage.on('pointermove', (e) => {
    handleHover(e);
    if (!ptr) return;
    const dx = e.global.x - ptr.sx, dy = e.global.y - ptr.sy;
    if (!ptr.moved && Math.hypot(dx, dy) > 6) ptr.moved = true;
    if (ptr.dragUnit) { // glisser une unité : le pion suit le curseur
      if (!ptr.moved) return;
      const p = world.toLocal(e.global);
      const c = counters.get(ptr.dragUnit.id);
      if (c) c.position.set(p.x, p.y); // pion au bout de la souris
      const { q, r } = pixelToAxial(p.x, p.y);
      const k = key(q, r);
      if (k !== ui.dragOverKey) { ui.dragOverKey = k; overlay.drawOverlay(); }
      stage.draw();
    } else if (ptr.moved) {
      world.position.set(ptr.wx + dx, ptr.wy + dy);
      stage.draw();
      if (ui.pending) hud.positionMoveTooltip();
    }
  });
  app.stage.on('pointerup', (e) => {
    if (ptr && ptr.dragUnit && ptr.moved) { // lâcher : déplacer si la cible est atteignable
      const p = world.toLocal(e.global);
      const { q, r } = pixelToAxial(p.x, p.y);
      const k = key(q, r);
      if (ui.sel && ui.sel.reachable.has(k)) {
        const id = ui.sel.unit.id;
        moveUnit(ui.sel.unit, k, ui.sel.dist, ui.sel.eZOC);
        session.send({ t: 'move', id, to: k });
        ui.sel = ui.sel.unit.mpLeft > 0 ? { unit: ui.sel.unit, ...computeReachable(state, ui.sel.unit) } : null;
      }
      ui.dragOverKey = null;
      ptr = null;
      hud.refresh();
    } else {
      if (ptr && !ptr.moved) handleClick(world.toLocal(e.global));
      ptr = null;
    }
    hud.hexTip.hide();
  });
  app.stage.on('pointerupoutside', () => { if (ptr) { ptr = null; ui.dragOverKey = null; hud.refresh(); } });
  app.canvas.addEventListener('pointerleave', () => { hoverKey = null; hud.hexTip.hide(); });

  // -- Caméra : molette, boutons, clavier ------------------------------------
  app.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    hud.hexTip.hide();
    const rc = app.canvas.getBoundingClientRect();
    stage.zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - rc.left, e.clientY - rc.top);
  }, { passive: false });
  $('btnIn').onclick = stage.zoomIn;
  $('btnOut').onclick = stage.zoomOut;
  $('btnReset').onclick = stage.fitView;
  // Zoom au clavier : + (ou =) pour agrandir, - pour réduire, centré sur l'écran.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); stage.zoomIn(); }
    else if (e.key === '-') { e.preventDefault(); stage.zoomOut(); }
  });

  // -- Bascules d'affichage et fin de phase -----------------------------------
  const btnSupply = $('btnSupply');
  btnSupply.classList.toggle('on', ui.showSupply);
  btnSupply.onclick = () => {
    ui.showSupply = !ui.showSupply;
    btnSupply.classList.toggle('on', ui.showSupply);
    overlay.drawOverlay();
    stage.draw();
  };
  const btnStats = $('btnStats');
  btnStats.classList.toggle('on', ui.showStats);
  btnStats.onclick = () => {
    ui.showStats = !ui.showStats;
    btnStats.classList.toggle('on', ui.showStats);
    stage.layers.stats.visible = ui.showStats;
    stage.draw();
  };
  const btnZoc = $('btnZoc');
  btnZoc.classList.toggle('on', ui.showZoc);
  btnZoc.onclick = () => {
    ui.showZoc = !ui.showZoc;
    btnZoc.classList.toggle('on', ui.showZoc);
    overlay.drawOverlay();
    stage.draw();
  };
  const legend = $('legend');
  const btnLegend = $('btnLegend');
  btnLegend.classList.toggle('on', ui.showLegend);
  legend.style.display = ui.showLegend ? '' : 'none';
  btnLegend.onclick = () => {
    ui.showLegend = !ui.showLegend;
    btnLegend.classList.toggle('on', ui.showLegend);
    legend.style.display = ui.showLegend ? '' : 'none';
  };
  $('btnPhase').onclick = () => {
    if (!myTurn()) return;
    session.send({ t: 'phase' });
    endPhase(state);
  };

  // -- Boutons de la bulle de confirmation de déplacement ---------------------
  $('btnConfirmMove').onclick = confirmMove;
  $('btnSelectMove').onclick = selectPendingUnit;
  $('btnCancelMove').onclick = () => { ui.clearPending(); hud.refresh(); };
}
