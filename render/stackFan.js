// ===========================================================================
//  Éventail de pile : au survol prolongé d'un hexe empilé, les pions se
//  déploient en éventail au-dessus de l'hexe. Cliquer une carte joue l'unité
//  (mouvement : sélection ; combat : désignation d'attaquant) ; la glisser
//  réordonne la pile — la position la plus à droite devient l'unité du dessus.
//  Le réordonnancement passe par la règle reorderStack et est envoyé au pair.
//  L'éventail se referme seul dès que la pile affichée diverge de l'état
//  (resynchronisation à chaque reconstruction des pions).
// ===========================================================================

import { axialToPixel, hexDistance, clamp } from '../src/geometry.js';
import { unitsAt, reorderStack } from '../src/units.js';
import { computeReachable } from '../src/movement.js';
import { CS } from './counters.js';

const PIXI = window.PIXI;
const OPEN_DELAY = 1000; // survol avant déploiement (ms)
const STEP = CS + 10; // entraxe des cartes
const PAD = 12; // marge intérieure de la plaque
const REACH = 24; // tolérance (px écran) autour de l'éventail avant fermeture
const ARC = 2.2; // creux de l'arc (px par carte² depuis le centre)

export function createStackFan({ state, stage, ui, session, myTurn, counters, hud }) {
  const layer = stage.layers.fan;
  let fan = null; // { k, q, r, order, cards, rings, x0, cy }
  let timer = null;
  let drag = null; // { unit, card, dx, moved }

  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const openKey = () => (fan ? fan.k : null);
  // Empreinte de la pile telle qu'affichée : ordre + face + ravitaillement.
  const snap = (list) => list.map((u) => `${u.id}${u.reduced ? 'v' : ''}${u.supplied ? '' : 'o'}`).join();

  function close() {
    cancel();
    drag = null;
    if (!fan) return;
    fan = null;
    for (const c of layer.removeChildren()) c.destroy({ children: true });
    stage.draw();
  }

  // Les pions viennent d'être reconstruits (état muté) : l'éventail ne survit
  // que si la pile affichée correspond encore exactement à l'état.
  counters.onRebuild(() => {
    if (fan && snap(unitsAt(state.units, fan.q, fan.r)) !== snap(fan.order)) close();
  });

  // La souris est « sur » l'éventail (avec marge) — on le laisse déployé.
  function hovering(g) {
    if (!fan) return false;
    if (drag) return true;
    const b = layer.getBounds();
    return g.x >= b.minX - REACH && g.x <= b.maxX + REACH && g.y >= b.minY - REACH && g.y <= b.maxY + REACH;
  }

  // Le survol vise un nouvel hexe (k = null : hors carte) : referme l'éventail
  // courant et programme le déploiement si l'hexe contient une pile.
  function hoverHex(k, q, r) {
    cancel();
    if (fan && fan.k === k) return;
    close();
    if (k && !state.G.over && unitsAt(state.units, q, r).length >= 2) {
      timer = setTimeout(() => open(q, r, k), OPEN_DELAY);
    }
  }

  // Réordonner n'est permis que sur une pile du camp actif, à son tour.
  const canReorder = (stack) => !state.G.over && myTurn() && stack[0].side === state.G.player;

  // Position d'un slot de l'éventail : rangée arquée, cartes inclinées.
  function slotPos(i, n) {
    const c = i - (n - 1) / 2;
    return { x: fan.x0 + i * STEP, y: fan.cy + c * c * ARC, rot: c * 0.06 };
  }

  function open(q, r, k) {
    timer = null;
    const stack = unitsAt(state.units, q, r);
    if (stack.length < 2 || state.G.over) return;
    hud.hexTip.hide();
    const { x, y } = axialToPixel(q, r);
    const n = stack.length;
    const arcMax = ((n - 1) / 2) ** 2 * ARC;
    let cy = y - CS * 1.7; // au-dessus de l'hexe…
    if (stage.world.toGlobal(new PIXI.Point(x, cy - CS)).y < 4) cy = y + CS * 1.7; // …ou dessous près du bord
    fan = { k, q, r, order: [...stack], cards: new Map(), rings: new Map(), x0: x - ((n - 1) * STEP) / 2, cy };
    const w = (n - 1) * STEP + CS + PAD * 2, h = CS + PAD * 2 + arcMax + 14;
    const plate = new PIXI.Graphics()
      .roundRect(x - w / 2, cy - CS / 2 - PAD, w, h, 8)
      .fill({ color: 0x14110c, alpha: 0.88 }).stroke({ width: 1.5, color: 0x5a5142 });
    plate.eventMode = 'static';
    plate.on('pointerdown', (e) => e.stopPropagation()); // ni pan ni fermeture depuis la plaque
    layer.addChild(plate);
    const grab = canReorder(stack);
    stack.forEach((u, i) => {
      const card = counters.buildCounterSprite(u, u.reduced);
      const p = slotPos(i, n);
      card.position.set(p.x, p.y);
      card.rotation = p.rot;
      card.eventMode = 'static';
      card.hitArea = new PIXI.Rectangle(-CS / 2, -CS / 2, CS, CS);
      card.cursor = grab ? 'grab' : 'default';
      const ring = new PIXI.Graphics()
        .roundRect(-CS / 2 - 3, -CS / 2 - 3, CS + 6, CS + 6, 7).stroke({ width: 3, color: 0xd8b13c });
      ring.visible = ui.attackers.has(u.id); // attaquant déjà désigné
      card.addChild(ring);
      card.on('pointerdown', (e) => {
        e.stopPropagation();
        drag = { unit: u, card, dx: stage.world.toLocal(e.global).x - card.x, moved: false };
        layer.setChildIndex(card, layer.children.length - 1); // la carte saisie passe devant
        card.scale.set(1.1);
        stage.draw();
      });
      card.on('globalpointermove', (e) => dragMove(card, e));
      card.on('pointerup', endDrag);
      card.on('pointerupoutside', endDrag);
      card.on('pointerover', () => { if (!drag) { card.scale.set(1.1); stage.draw(); } });
      card.on('pointerout', () => { if (!drag || drag.card !== card) { card.scale.set(1); stage.draw(); } });
      fan.cards.set(u.id, card);
      fan.rings.set(u.id, ring);
      layer.addChild(card);
    });
    const top = new PIXI.Text({
      text: '▲ dessus',
      style: { fontFamily: 'Arial', fontSize: 10, fontWeight: '700', fill: 0xcdc3ab },
    });
    top.anchor.set(0.5);
    top.position.set(fan.x0 + (n - 1) * STEP, cy + CS / 2 + arcMax + 9);
    layer.addChild(top);
    stage.draw();
  }

  // Replace chaque carte sur son slot (sauf celle en cours de glissement).
  function settle(except) {
    const n = fan.order.length;
    fan.order.forEach((u, i) => {
      const card = fan.cards.get(u.id);
      if (card === except) return;
      const p = slotPos(i, n);
      card.position.set(p.x, p.y);
      card.rotation = p.rot;
    });
  }

  function dragMove(card, e) {
    if (!drag || drag.card !== card || !fan) return;
    if (!canReorder(fan.order)) return; // pile en lecture seule : clic uniquement
    const px = stage.world.toLocal(e.global).x - drag.dx;
    if (!drag.moved && Math.abs(px - card.x) < 4) return; // seuil clic / glissement
    drag.moved = true;
    const n = fan.order.length;
    card.x = clamp(px, fan.x0, fan.x0 + (n - 1) * STEP);
    card.rotation = 0;
    const to = clamp(Math.round((card.x - fan.x0) / STEP), 0, n - 1);
    const from = fan.order.indexOf(drag.unit);
    if (to !== from) {
      fan.order.splice(from, 1);
      fan.order.splice(to, 0, drag.unit);
      settle(card);
    }
    stage.draw();
  }

  function endDrag() {
    if (!drag || !fan) return;
    const { unit, card, moved } = drag;
    drag = null;
    card.scale.set(1);
    if (!moved) { pick(unit); return; } // relâché sans glisser : clic
    settle();
    stage.draw();
    const ids = fan.order.map((u) => u.id);
    if (snap(fan.order) === snap(unitsAt(state.units, fan.q, fan.r))) return; // ordre inchangé
    if (!reorderStack(state.units, ids)) { close(); return; } // pile devenue incohérente
    session.send({ t: 'reorder', ids });
    hud.refresh(); // la pile se réempile sous l'éventail dans le nouvel ordre
  }

  // Jouer une unité de l'éventail : sélection (mouvement) ou attaquant (combat).
  function pick(u) {
    if (state.G.over || !myTurn() || u.side !== state.G.player || !state.units.includes(u)) return;
    if (state.G.phase === 'move') {
      ui.clearPending();
      ui.sel = { unit: u, ...computeReachable(state, u) };
      close(); // l'unité est en main, sa portée s'affiche
    } else {
      if (u.hasFought) return;
      if (!state.units.some((e) => e.side !== state.G.player && hexDistance(e.q, e.r, u.q, u.r) === 1)) return;
      if (ui.attackers.has(u.id)) ui.attackers.delete(u.id);
      else ui.attackers.add(u.id);
      fan.rings.get(u.id).visible = ui.attackers.has(u.id); // l'éventail reste pour composer l'attaque
    }
    hud.refresh();
  }

  return { hoverHex, hovering, openKey, close };
}
