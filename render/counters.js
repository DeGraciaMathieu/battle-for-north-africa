// ===========================================================================
//  Pions (counters) : construction des sprites recto/verso, reconstruction
//  après chaque changement d'état et empilement par hexe. Le retournement
//  animé vit dans fx.js, qui s'enregistre ici (setBeforeRebuild) pour être
//  annulé à chaque reconstruction — ses références seraient invalidées.
// ===========================================================================

import { key, axialToPixel } from '../src/geometry.js';
import { FILL, mixDark } from './gfx.js';

const PIXI = window.PIXI;
export const CS = 50; // côté d'un pion (px monde), partagé avec l'éventail de pile

const drawSymbol = (g, type, x, y, w, h, color) => {
  const cx = x + w / 2, cy = y + h / 2, line = { width: 1.6, color };
  if (type === 'inf' || type === 'mech') {
    g.moveTo(x, y).lineTo(x + w, y + h).moveTo(x + w, y).lineTo(x, y + h).stroke(line);
  }
  if (type === 'armor' || type === 'mech') g.ellipse(cx, cy, w * 0.33, h * 0.3).stroke(line);
  if (type === 'arty') g.circle(cx, cy, Math.min(w, h) * 0.17).fill(color);
};

export function createCounters(state, stage) {
  const unitLayer = stage.layers.unit;
  const counters = new Map();
  let beforeRebuild = null;
  const rebuildListeners = []; // notifiés après chaque reconstruction (état muté)

  // Construit le pion pour une FACE donnée (recto = reduced false, verso = true) ;
  // ne l'enregistre pas — sert au rendu courant comme à l'animation de flip.
  function buildCounterSprite(u, reduced) {
    const c = new PIXI.Container();
    const baseFill = FILL[u.side];
    const fill = reduced ? mixDark(baseFill) : baseFill;
    const txt = 0xf3efe2;
    const shadow = new PIXI.Graphics().roundRect(-CS / 2 + 3, -CS / 2 + 4, CS, CS, 5).fill({ color: 0, alpha: 0.35 });
    const base = new PIXI.Graphics();
    base.roundRect(-CS / 2, -CS / 2, CS, CS, 5).fill(fill).stroke({ width: 2, color: 0x1c1810 });
    base.roundRect(-CS / 2 + 2, -CS / 2 + 2, CS - 4, CS * 0.26, 3).fill({ color: 0xffffff, alpha: 0.1 });
    const bw = CS * 0.64, bh = CS * 0.36, box = new PIXI.Graphics();
    box.rect(-bw / 2, -bh / 2, bw, bh).fill({ color: 0xf4edd8, alpha: 0.92 }).stroke({ width: 1.4, color: 0x1c1810 });
    drawSymbol(box, u.type, -bw / 2, -bh / 2, bw, bh, 0x241d10);
    const T = (s, sz) => {
      const t = new PIXI.Text({ text: s, style: { fontFamily: 'Arial', fontSize: sz, fontWeight: '700', fill: txt } });
      t.anchor.set(0.5);
      return t;
    };
    // Facteurs de la FACE courante ; le ravitaillement modifie l'effectif au
    // combat mais pas le nombre imprimé.
    const fa = reduced ? u.ratk : u.atk, fd = reduced ? u.rdef : u.def, fm = reduced ? u.rmov : u.mov;
    const fac = T(`${fa}-${fd}-${fm}`, 10); fac.position.set(0, CS / 2 - 8);
    c.addChild(shadow, base, box, fac);
    if (reduced) { // bande d'angle rouge = pion réduit
      const stripe = new PIXI.Graphics();
      stripe.poly([CS / 2 - 12, -CS / 2, CS / 2, -CS / 2, CS / 2, -CS / 2 + 12]).fill(0xb33a2a);
      c.addChild(stripe);
    }
    if (!u.supplied) { // liseré orange = hors ravito
      const oos = new PIXI.Graphics();
      oos.roundRect(-CS / 2, -CS / 2, CS, CS, 5).stroke({ width: 2.5, color: 0xe08a2a });
      oos.circle(-CS / 2 + 7, CS / 2 - 7, 4).fill(0xe08a2a).stroke({ width: 1, color: 0x1c1810 });
      c.addChild(oos);
    }
    c.eventMode = 'none';
    return c;
  }

  function makeCounter(u) {
    const c = buildCounterSprite(u, u.reduced);
    counters.set(u.id, c);
    unitLayer.addChild(c);
    return c;
  }

  function rebuild() {
    if (beforeRebuild) beforeRebuild(); // annule un retournement en cours (réfs invalidées)
    for (const c of counters.values()) c.destroy();
    counters.clear();
    unitLayer.removeChildren();
    state.units.forEach(makeCounter);
    rebuildListeners.forEach((fn) => fn());
  }

  function layout() {
    const byHex = new Map();
    for (const u of state.units) {
      const k = key(u.q, u.r);
      (byHex.get(k) || byHex.set(k, []).get(k)).push(u);
    }
    for (const [k, list] of byHex) {
      const [q, r] = k.split(',').map(Number);
      const { x, y } = axialToPixel(q, r);
      list.forEach((u, i) => {
        const c = counters.get(u.id);
        if (!c) return;
        c.position.set(x + i * 7, y - i * 7);
        // Unité du camp actif qui ne peut plus agir (PM épuisés / combat livré) → grisée.
        const done = state.G.phase === 'combat' ? u.hasFought : u.mpLeft === 0;
        c.alpha = u.side === state.G.player && done ? 0.5 : 1;
      });
    }
  }

  return {
    buildCounterSprite, rebuild, layout,
    get: (id) => counters.get(id),
    setBeforeRebuild: (fn) => { beforeRebuild = fn; },
    onRebuild: (fn) => rebuildListeners.push(fn),
  };
}
