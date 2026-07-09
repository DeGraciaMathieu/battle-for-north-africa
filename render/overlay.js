// ===========================================================================
//  Surbrillances dynamiques (couche overlay + médailles d'objectif) : portée
//  de déplacement, ZOC, ravitaillement, cibles de combat, drapeaux de contrôle
//  et projecteur du combat joué par l'IA. Rejoué à chaque refresh — tout ce
//  qui évolue en cours de partie se dessine ici, par-dessus le plateau statique.
// ===========================================================================

import { DIRS, SIZE } from '../src/config.js';
import { key, axialToPixel, hexCorners, hexDistance } from '../src/geometry.js';
import { other } from '../src/units.js';
import { zocOf } from '../src/movement.js';
import { supplyRoutes, supplySources } from '../src/supply.js';
import { SUP, DIR_TO_EDGE } from './gfx.js';

const PIXI = window.PIXI;
const asset = (f) => new URL(`../assets/${f}`, import.meta.url).href;

// Contrôle : couleurs vives de camp, gris atténué si neutre. La couleur
// (bleu/rouge/gris) donne le contrôle ; la forme donne la nature.
const FLAG_COL = { blue: 0x3f7fe0, red: 0xe0483a, neutral: 0xb8ad86 };

export async function createOverlay(state, stage, ui) {
  const overlay = stage.layers.overlay;
  const objLayer = stage.layers.obj;

  // Médailles d'objectif : une par état de contrôle (neutre / Bleu / Rouge).
  const medalTex = {};
  await Promise.all([
    (async () => { medalTex.neutral = await PIXI.Assets.load(asset('medal_gray.png')); })(),
    (async () => { medalTex.blue = await PIXI.Assets.load(asset('medal_blue.png')); })(),
    (async () => { medalTex.red = await PIXI.Assets.load(asset('medal_red.png')); })(),
  ]);

  // Peuplements tenus (villes + villages, relais de ravito) : précalculés une
  // fois pour le liseré de contrôle. Les objectifs, notion distincte, sont
  // dessinés à part (grande médaille) et retirés d'ici pour éviter le doublon.
  const objSet = new Set(state.objectives);
  const settlementKeys = [...state.terrain]
    .filter(([k, t]) => (t === 'town' || t === 'village' || t === 'oasis') && !objSet.has(k))
    .map(([k]) => k);

  const drawHexOutline = (k, color, width, alpha = 1) => {
    const [q, r] = k.split(',').map(Number);
    const { x, y } = axialToPixel(q, r);
    overlay.poly(hexCorners(x, y)).stroke({ width, color, alpha });
  };
  const fillHex = (k, color, alpha) => {
    const [q, r] = k.split(',').map(Number);
    const { x, y } = axialToPixel(q, r);
    overlay.poly(hexCorners(x, y)).fill({ color, alpha });
  };
  // Trace uniquement le pourtour extérieur d'un ensemble d'hexes : pour chaque
  // hexe de la zone, on dessine les arêtes qui bordent un hexe hors zone.
  const drawZoneOutline = (keys, color, width, alpha) => {
    for (const k of keys) {
      const [q, r] = k.split(',').map(Number);
      const { x, y } = axialToPixel(q, r);
      const c = hexCorners(x, y);
      for (let d = 0; d < 6; d++) {
        if (keys.has(key(q + DIRS[d][0], r + DIRS[d][1]))) continue; // arête interne
        const e = DIR_TO_EDGE[d], a = e * 2, b = ((e + 1) % 6) * 2;
        overlay.moveTo(c[a], c[a + 1]).lineTo(c[b], c[b + 1]);
      }
    }
    overlay.stroke({ width, color, alpha });
  };
  // Flèche courbe (bézier quadratique) d'une pièce d'artillerie vers la cible :
  // indicateur, pendant l'aperçu du combat, que cette pièce appuie l'attaque.
  const drawArtyArrow = (from, to) => {
    const a0 = axialToPixel(from.q, from.r), a1 = axialToPixel(to.q, to.r);
    const dx = a1.x - a0.x, dy = a1.y - a0.y, len = Math.hypot(dx, dy) || 1;
    const off = Math.min(70, len * 0.32); // décalage perpendiculaire → arc
    const cx = (a0.x + a1.x) / 2 - (dy / len) * off, cy = (a0.y + a1.y) / 2 + (dx / len) * off;
    const bez = (s) => { const u = 1 - s; return [u * u * a0.x + 2 * u * s * cx + s * s * a1.x, u * u * a0.y + 2 * u * s * cy + s * s * a1.y]; };
    const col = 0xffcf6a, N = 24, end = 0.86; // s'arrête avant le centre pour ne pas masquer la cible
    const p0 = bez(0);
    overlay.moveTo(p0[0], p0[1]);
    for (let i = 1; i <= N; i++) { const q = bez((i / N) * end); overlay.lineTo(q[0], q[1]); }
    overlay.stroke({ width: 3, color: col, alpha: 0.9 });
    const hp = bez(end), hb = bez(end - 0.06), ang = Math.atan2(hp[1] - hb[1], hp[0] - hb[0]), ah = 11;
    overlay.moveTo(hp[0], hp[1]).lineTo(hp[0] - ah * Math.cos(ang - 0.42), hp[1] - ah * Math.sin(ang - 0.42))
      .moveTo(hp[0], hp[1]).lineTo(hp[0] - ah * Math.cos(ang + 0.42), hp[1] - ah * Math.sin(ang + 0.42))
      .stroke({ width: 3, color: col, alpha: 0.9 });
    overlay.circle(a0.x, a0.y, 4).fill({ color: col, alpha: 0.95 }); // point de départ (la pièce)
  };

  // Trace la ligne de ravitaillement de chaque unité du camp actif jusqu'à sa
  // source, en suivant la route du flood-fill. Halo doré sur les sources.
  // Une unité coupée n'a pas de ligne (repérable aussi au liseré orange).
  function drawSupplyLines() {
    const side = state.G.player;
    const { supplied, parent } = supplyRoutes(state, side);
    const color = SUP[side];
    // Grise la zone hors ravitaillement pour faire ressortir la zone tenue.
    for (const { q, r } of state.hexes) {
      const k = key(q, r);
      if (!supplied.has(k)) fillHex(k, 0x000000, 0.32);
    }
    // Atténué quand on planifie un déplacement, pour laisser la portée dominer.
    const fillA = state.G.phase === 'move' && ui.sel ? 0.06 : 0.16;
    for (const k of supplied) fillHex(k, color, fillA); // teinte de la zone ravitaillée
    drawZoneOutline(supplied, color, 3, 0.95); // pourtour renforcé
    for (const k of supplySources(state, side)) {
      if (supplied.has(k)) drawHexOutline(k, 0xffffff, 2.5, 0.85); // halo clair = source (distinct de la portée)
    }
    for (const u of state.units) {
      if (u.side !== side || !supplied.has(key(u.q, u.r))) continue;
      const pts = [];
      for (let k = key(u.q, u.r); k; k = parent.get(k)) {
        const [q, r] = k.split(',').map(Number);
        const { x, y } = axialToPixel(q, r);
        pts.push(x, y);
      }
      if (pts.length < 4) continue; // unité déjà sur sa source
      overlay.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) overlay.lineTo(pts[i], pts[i + 1]);
      overlay.stroke({ width: 2.5, color, alpha: 0.85 });
      overlay.circle(pts[0], pts[1], 3).fill({ color, alpha: 0.9 }); // extrémité côté unité
    }
  }

  // Peuplement (ville/village) : petit fanion triangulaire planté sur un mât
  // court, dans la couleur du camp tenant (translucide si neutre) — repère de
  // source de ravitaillement.
  const drawFlag = (k) => {
    const [q, r] = k.split(',').map(Number);
    const { x, y } = axialToPixel(q, r);
    const ctrl = state.objControl.get(k);
    const col = ctrl ? FLAG_COL[ctrl] : FLAG_COL.neutral;
    const alpha = ctrl ? 1 : 0.55;
    const px = x - 5, baseY = y + 9, topY = y - 11;
    overlay.ellipse(px, baseY, 3.5, 2).fill({ color: 0x1c1810, alpha: 0.45 }); // socle au sol
    overlay.moveTo(px, baseY).lineTo(px, topY).stroke({ width: 1.8, color: 0x2a2418, alpha: 0.95 }); // mât
    const w = 12, h = 9; // petit fanion triangulaire
    overlay.poly([px, topY, px + w, topY + h * 0.45, px, topY + h])
      .fill({ color: col, alpha }).stroke({ width: 1.2, color: 0x1c1810, alpha: 0.9 });
  };
  // Objectif de victoire : médaille dans la couleur du camp tenant (grise si
  // neutre). Sprite posé sur n'importe quel terrain, distinct des fanions.
  const drawObjective = (k) => {
    const [q, r] = k.split(',').map(Number);
    const { x, y } = axialToPixel(q, r);
    const ctrl = state.objControl.get(k);
    const sp = new PIXI.Sprite(medalTex[ctrl] || medalTex.neutral);
    sp.anchor.set(0.5);
    sp.position.set(x, y);
    sp.width = SIZE * 1.5; sp.height = SIZE * 1.5;
    objLayer.addChild(sp);
  };

  function drawOverlay() {
    overlay.clear();
    objLayer.removeChildren();
    // Contrôle des peuplements. Rejoué à chaque refresh (le contrôle évolue) —
    // d'où le tracé ici plutôt que dans le décor statique.
    for (const k of state.objectives) drawObjective(k); // objectifs de victoire (médaille)
    for (const k of settlementKeys) drawFlag(k); // peuplements (fanion de ravito)
    if (ui.showSupply) drawSupplyLines();
    if (ui.showZoc) { // zone d'influence (ZOC) du camp actif
      const zone = zocOf(state.units, state.G.player, state.terrain);
      for (const u of state.units) if (u.side === state.G.player) zone.add(key(u.q, u.r));
      drawZoneOutline(zone, 0xcc4433, 2.5, 0.8);
    }
    if (state.G.phase === 'move') {
      const eZOC = zocOf(state.units, other(state.G.player), state.terrain);
      const zone = new Set(eZOC);
      for (const u of state.units) {
        if (u.side !== state.G.player) zone.add(key(u.q, u.r)); // hexe de l'unité → pourtour plein
      }
      drawZoneOutline(zone, 0xcc4433, 2.5, 0.9);
      if (ui.sel) {
        const terminal = new Set([...ui.sel.reachable].filter((k) => eZOC.has(k))); // ZOC → arrêt forcé
        for (const k of ui.sel.reachable) fillHex(k, terminal.has(k) ? 0xd23b2b : 0xe8c85a, terminal.has(k) ? 0.3 : 0.22);
        drawZoneOutline(ui.sel.reachable, 0xf0c040, 2.5, 0.85); // frontière nette de la portée
        for (const k of terminal) drawHexOutline(k, 0xd23b2b, 2.5, 0.95); // liseré « on s'arrête ici »
        drawHexOutline(key(ui.sel.unit.q, ui.sel.unit.r), 0xffffff, 3, 0.75);
      }
      if (ui.pending) drawHexOutline(ui.pending.key, 0x8fbf6a, 4, 1); // destination en attente
      if (ui.sel && ui.dragOverKey && ui.sel.reachable.has(ui.dragOverKey)) drawHexOutline(ui.dragOverKey, 0x8fbf6a, 4, 1); // cible du glisser
    } else {
      // cibles valides = ennemis adjacents à une unité amie non engagée
      const targets = new Set();
      for (const u of state.units) {
        if (u.side === state.G.player) continue;
        if (state.units.some((a) => a.side === state.G.player && !a.hasFought && hexDistance(a.q, a.r, u.q, u.r) === 1)) {
          targets.add(key(u.q, u.r));
        }
      }
      for (const k of targets) drawHexOutline(k, 0xcc4433, 3, 0.9);
      for (const id of ui.attackers) {
        const u = state.units.find((x) => x.id === id);
        if (u) drawHexOutline(key(u.q, u.r), 0x6f9a5c, 3, 0.95);
      }
      for (const { from, to } of ui.artyPreview) drawArtyArrow(from, to); // appui d'artillerie du combat en aperçu
    }
    // Projecteur sur le combat que l'IA est en train de jouer : attaquants
    // (vert), défenseur (rouge appuyé) et flèches, pour situer l'action.
    if (ui.combatSpotlight) {
      for (const k of ui.combatSpotlight.atk) {
        drawHexOutline(k, 0x6f9a5c, 3, 0.95);
        const [aq, ar] = k.split(',').map(Number);
        const [dq, dr] = ui.combatSpotlight.def.split(',').map(Number);
        drawArtyArrow({ q: aq, r: ar }, { q: dq, r: dr });
      }
      fillHex(ui.combatSpotlight.def, 0xcc4433, 0.28);
      drawHexOutline(ui.combatSpotlight.def, 0xcc4433, 3.5, 1);
    }
  }

  return { drawOverlay };
}
