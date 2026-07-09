// ===========================================================================
//  Scène PixiJS : application, couches d'affichage, rendu à la demande et
//  caméra (zoom, pan, cadrage). Les autres modules dessinent dans les couches
//  et déclenchent draw() ; tout changement de vue notifie onViewChanged (les
//  éléments DOM ancrés au monde, comme la bulle de déplacement, s'y accrochent).
// ===========================================================================

import { axialToPixel, clamp } from '../src/geometry.js';

const PIXI = window.PIXI;

export async function createStage() {
  const app = new PIXI.Application();
  await app.init({
    width: window.innerWidth, height: window.innerHeight, background: 0x14110c,
    antialias: true, resolution: Math.min(1.5, window.devicePixelRatio || 1), autoDensity: true,
  });
  app.canvas.id = 'stage-canvas';
  document.body.prepend(app.canvas);

  // Rendu à la demande : jeu au tour par tour, rien n'anime → on coupe la
  // boucle 60 fps et on ne redessine que quand l'état OU la vue change.
  app.ticker.stop();
  // Rendu coalescé : plusieurs draw() dans la même frame (ex. rafale de
  // pointermove pendant un pan sur souris/écran haute fréquence) ne déclenchent
  // qu'UN seul app.render() au prochain rAF, au lieu d'un rendu synchrone par
  // événement. Évite les saccades sans changer la logique « à la demande ».
  let drawScheduled = false;
  const draw = () => {
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(() => { drawScheduled = false; app.render(); });
  };

  const world = new PIXI.Container();
  const layers = {
    tile: new PIXI.Container(), map: new PIXI.Graphics(), deco: new PIXI.Graphics(),
    overlay: new PIXI.Graphics(), obj: new PIXI.Container(), unit: new PIXI.Container(),
    stats: new PIXI.Container(), fx: new PIXI.Graphics(), fan: new PIXI.Container(),
  };
  // médailles au-dessus des surbrillances, sous les pions ; éventail de pile au sommet
  world.addChild(layers.tile, layers.map, layers.deco, layers.overlay, layers.obj, layers.unit, layers.stats, layers.fx, layers.fan);
  app.stage.addChild(world);

  const viewListeners = [];
  const notifyView = () => viewListeners.forEach((cb) => cb());

  window.addEventListener('resize', () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
    app.stage.hitArea = app.screen;
    draw();
    notifyView();
  });

  const zoomAt = (m, cx, cy) => {
    const s0 = world.scale.x, s1 = clamp(s0 * m, 0.32, 2.6);
    const wx = (cx - world.x) / s0, wy = (cy - world.y) / s0;
    world.scale.set(s1);
    world.position.set(cx - wx * s1, cy - wy * s1);
    draw();
    notifyView();
  };
  const zoomIn = () => zoomAt(1.2, app.screen.width / 2, app.screen.height / 2);
  const zoomOut = () => zoomAt(0.83, app.screen.width / 2, app.screen.height / 2);

  // Recentre en douceur la caméra sur un hexe (zoom inchangé) : sert à amener
  // au centre de l'écran le combat que l'IA va jouer. Résout à la fin du pan.
  function panToHex(q, r, ms = 500) {
    const { x, y } = axialToPixel(q, r);
    const s = world.scale.x;
    const x0 = world.x, y0 = world.y;
    const dx = (app.screen.width / 2 - x * s) - x0, dy = (app.screen.height / 2 - y * s) - y0;
    if (Math.hypot(dx, dy) < 1) return Promise.resolve();
    return new Promise((res) => {
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
        world.position.set(x0 + dx * e, y0 + dy * e);
        app.render();
        if (p < 1) requestAnimationFrame(step); else { notifyView(); res(); }
      };
      requestAnimationFrame(step);
    });
  }

  function fitView() {
    const b = layers.map.getLocalBounds();
    const s = clamp(Math.min(app.screen.width / b.width, app.screen.height / b.height) * 0.9, 0.32, 2.6);
    world.scale.set(s);
    world.position.set((app.screen.width - b.width * s) / 2 - b.x * s, (app.screen.height - b.height * s) / 2 - b.y * s);
    draw();
    notifyView();
  }

  return {
    app, world, layers, draw,
    zoomAt, zoomIn, zoomOut, panToHex, fitView,
    onViewChanged: (cb) => viewListeners.push(cb),
  };
}
