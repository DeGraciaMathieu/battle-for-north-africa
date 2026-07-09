// ===========================================================================
//  Effets de combat : impact (unité réduite) / explosion (unité éliminée) et
//  retournement de tuile (recto → verso). Le rendu du jeu est à la demande
//  (ticker arrêté) : on ne rallume la boucle que le temps qu'un effet vive,
//  puis on la recoupe. La file fxQueue collecte les positions touchées pendant
//  resolveCombat ; la modale la rejoue à sa fermeture.
// ===========================================================================

import { SIZE } from '../src/config.js';
import { axialToPixel } from '../src/geometry.js';
import { lerpColor } from './gfx.js';

export function createFx(state, stage, counters) {
  const { app, draw } = stage;
  const fxLayer = stage.layers.fx;
  const unitLayer = stage.layers.unit;
  const byId = (id) => state.units.find((u) => u.id === id);

  let fx = []; // foyers actifs { x, y, kind, t, delay, dur }
  let flips = []; // { verso, recto, t, dur }
  const fxQueue = []; // positions collectées pendant resolveCombat, jouées à la fermeture de la modale

  // Chaque touche déclenche 3 foyers décalés sur les bords de la tuile, chacun
  // virant du jaune au rouge + une onde de choc.
  function drawFx() {
    fxLayer.clear();
    for (const e of fx) {
      if (e.t < e.delay) continue; // foyer pas encore éclos (décalage)
      const p = Math.min(1, (e.t - e.delay) / e.dur); // progression 0→1
      const a = 1 - p;
      const kill = e.kind === 'kill';
      const R = 3 + p * (kill ? SIZE * 0.55 : SIZE * 0.42);
      const col = lerpColor(0xffe23a, 0xd21f14, p); // jaune → rouge
      fxLayer.circle(e.x, e.y, R * 1.4).fill({ color: col, alpha: 0.2 * a }); // halo
      fxLayer.circle(e.x, e.y, R).fill({ color: col, alpha: 0.85 * a }); // boule de feu
      for (let i = 0; i < 7; i++) { // éclats
        const ang = (i / 7) * Math.PI * 2 + p * 1.5;
        const c = Math.cos(ang), s = Math.sin(ang);
        fxLayer.moveTo(e.x + c * R * 0.4, e.y + s * R * 0.4)
          .lineTo(e.x + c * R * 1.5, e.y + s * R * 1.5)
          .stroke({ width: 2, color: col, alpha: 0.8 * a });
      }
      if (p < 0.35) fxLayer.circle(e.x, e.y, 4 + p * 8).fill({ color: 0xfff6cf, alpha: (0.35 - p) / 0.35 }); // flash blanc initial
      const sw = p * (kill ? SIZE : SIZE * 0.75); // onde de choc : anneau fin plus rapide, s'estompe
      fxLayer.circle(e.x, e.y, sw).stroke({ width: 2 * a, color: 0xffd9a0, alpha: 0.6 * a });
    }
  }

  // Retournement de tuile (recto → verso) quand une unité est réduite : on
  // squash horizontalement le recto (1→0), on bascule sur le verso à mi-course,
  // puis on le déploie (0→1). Le verso est le pion déjà en place ; le recto est
  // un pion temporaire construit pour l'occasion.
  function flipUnit(id) {
    const verso = counters.get(id), u = byId(id);
    if (!verso || verso.destroyed || !u) return;
    const recto = counters.buildCounterSprite(u, false);
    recto.position.copyFrom(verso.position);
    recto.visible = false;
    unitLayer.addChild(recto);
    flips.push({ verso, recto, t: 0, dur: 420 });
    startAnim();
  }
  function updateFlips() {
    flips = flips.filter((f) => {
      if (f.verso.destroyed) { if (!f.recto.destroyed) f.recto.destroy(); return false; }
      const p = Math.min(1, f.t / f.dur);
      if (p < 0.5) { f.recto.visible = true; f.verso.visible = false; f.recto.scale.x = 1 - p * 2; }
      else { f.recto.visible = false; f.verso.visible = true; f.verso.scale.x = (p - 0.5) * 2; }
      if (f.t < f.dur) return true;
      f.recto.destroy(); f.verso.scale.x = 1; f.verso.visible = true;
      return false;
    });
  }
  const cancelFlips = () => {
    for (const f of flips) { if (!f.recto.destroyed) f.recto.destroy(); }
    flips = [];
  };

  const animTick = (ticker) => {
    const dt = ticker.deltaMS;
    for (const e of fx) e.t += dt;
    fx = fx.filter((e) => e.t < e.delay + e.dur);
    drawFx();
    for (const f of flips) f.t += dt;
    updateFlips();
    if (!fx.length && !flips.length) { app.ticker.remove(animTick); app.ticker.stop(); fxLayer.clear(); draw(); }
  };
  const startAnim = () => { if (!app.ticker.started) { app.ticker.add(animTick); app.ticker.start(); } };

  function spawnFx(q, r, kind) {
    const { x, y } = axialToPixel(q, r);
    const rad = SIZE * 0.5; // distance des foyers depuis le centre
    const dur = kind === 'kill' ? 520 : 420;
    [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6].forEach((ang, i) => { // 3 foyers à 120°
      fx.push({ x: x + Math.cos(ang) * rad, y: y + Math.sin(ang) * rad, kind, t: 0, delay: i * 90, dur });
    });
    startAnim();
  }

  counters.setBeforeRebuild(cancelFlips);
  return { spawnFx, flipUnit, fxQueue };
}
