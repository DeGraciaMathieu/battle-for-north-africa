// ===========================================================================
//  Couche de rendu & interaction (PixiJS v8 + HUD DOM).
//  N'importe QUE des règles pures depuis ../src : cette couche lit l'état et
//  s'abonne au bus d'événements ; elle ne contient aucune règle de jeu.
// ===========================================================================

import { TERRAIN, MAX_TURNS, BASES, CRT, ODDS, DIRS, CATALOG_ORDER, SIZE, SQRT3 } from '../src/config.js';
import { key, axialToPixel, offsetToAxial, pixelToAxial, hexCorners, hexDistance, clamp } from '../src/geometry.js';
import { eAtk, eDef, eMov, other, unitsAt, enemyAt, stackCount, isArmor, isFoot } from '../src/units.js';
import { zocOf, computeReachable, moveUnit } from '../src/movement.js';
import { resolveCombat, combatPlan } from '../src/combat.js';
import { updateSupply, supplyRoutes, supplySources } from '../src/supply.js';
import { createGame, updateObjectives, objCount, endPhase } from '../src/game.js';
import { loadMap } from '../src/map.js';

const PIXI = window.PIXI;

(async () => {
  try {
    // Seed de carte : reprise depuis l'URL (?seed=) si valide, sinon aléatoire.
    // Poussée dans l'URL pour pouvoir repartager la carte courante.
    const params = new URLSearchParams(location.search);
    const seedParam = params.get('seed');
    const seed = seedParam !== null && /^\d+$/.test(seedParam) ? Number(seedParam) : Math.floor(Math.random() * 0xffffffff);
    // Carte nommée (dossier maps/) : prioritaire sur la seed si le fichier charge.
    const mapParam = params.get('map');
    let mapData = null;
    if (mapParam && /^[\w-]+$/.test(mapParam)) {
      try {
        const res = await fetch(new URL(`../maps/${mapParam}.json`, import.meta.url));
        if (res.ok) mapData = loadMap(await res.json());
      } catch { mapData = null; }
    }
    document.getElementById('seedVal').textContent = mapData ? mapParam : seed;
    // Armées de l'éditeur (accueil) : b/r = comptes par type (ordre CATALOG_ORDER).
    // Absentes (accès direct) → roster par défaut.
    const parseArmy = (s) => {
      const parts = s.split('.').map(Number);
      const army = {};
      CATALOG_ORDER.forEach((t, i) => { if (parts[i] > 0) army[t] = parts[i]; });
      return army;
    };
    const b = params.get('b'), r = params.get('r');
    const composition = b && r ? { axis: parseArmy(b), ally: parseArmy(r) } : undefined;
    const q = new URLSearchParams();
    if (mapData) q.set('map', mapParam); else q.set('seed', String(seed));
    if (composition) { q.set('b', b); q.set('r', r); }
    history.replaceState(null, '', `?${q.toString()}`);
    const state = createGame(Math.random, seed, composition, mapData ?? undefined);
    const sideLabel = (s) => (s === 'axis' ? 'BLEU' : 'ROUGE');
    const FILL = { axis: 0x4a6b9a, ally: 0xa8544a };   // couleurs des camps (pions, camp de base)
    const SUP = { axis: 0x8fb0d8, ally: 0xe0968f };    // teinte de ravitaillement par camp

    // =========================================================================
    //  Rendu Pixi
    // =========================================================================
    const app = new PIXI.Application();
    await app.init({
      width: window.innerWidth, height: window.innerHeight, background: 0x14110c,
      antialias: true, resolution: Math.min(1.5, window.devicePixelRatio || 1), autoDensity: true,
    });
    app.canvas.id = 'stage-canvas';
    document.body.prepend(app.canvas);

    // Tuiles de terrain (dossier assets/). Un terrain sans texture (route) reste
    // tracé en vectoriel. Les pions, eux, restent entièrement vectoriels.
    // URL résolue depuis ce module (import.meta) : robuste à l'URL propre /game
    // et à un déploiement en sous-dossier.
    const asset = (f) => new URL(`../assets/${f}`, import.meta.url).href;
    const TERRAIN_TILES = ['sand', 'sand2', 'coast', 'sea'];
    const terrainTex = {};
    await Promise.all(
      TERRAIN_TILES.map(async (t) => { terrainTex[t] = await PIXI.Assets.load(asset(`terrain-${t}.png`)); }),
    );
    // Rendu à la demande : jeu au tour par tour, rien n'anime → on coupe la
    // boucle 60 fps et on ne redessine que quand l'état OU la vue change.
    app.ticker.stop();
    const draw = () => app.render();
    window.addEventListener('resize', () => {
      app.renderer.resize(window.innerWidth, window.innerHeight);
      app.stage.hitArea = app.screen;
      draw();
      if (pending) positionMoveTooltip();
    });

    const world = new PIXI.Container();
    const tileLayer = new PIXI.Container(), mapLayer = new PIXI.Graphics(), decoLayer = new PIXI.Graphics(),
      overlay = new PIXI.Graphics(), unitLayer = new PIXI.Container();
    world.addChild(tileLayer, mapLayer, decoLayer, overlay, unitLayer);
    app.stage.addChild(world);

    // voisin axial d → arête correspondante de l'hexe flat-top (partagé plus bas).
    const DIR_TO_EDGE = [0, 5, 4, 3, 2, 1];
    const UPPER_EDGES = [3, 4, 5], LOWER_EDGES = [0, 1, 2];
    const strokeEdge = (g, c, e, color, alpha, width) => {
      const a = e * 2, b = ((e + 1) % 6) * 2;
      g.moveTo(c[a], c[a + 1]).lineTo(c[b], c[b + 1]).stroke({ width, color, alpha });
    };
    for (const { q, r } of state.hexes) {
      const { x, y } = axialToPixel(q, r);
      const type = state.terrain.get(key(q, r));
      const c = hexCorners(x, y);
      const tex = terrainTex[type];
      if (tex) {                                        // tuile texturée : sprite flat-top
        const sp = new PIXI.Sprite(tex);
        sp.anchor.set(0.5);
        sp.position.set(x, y);
        sp.width = SIZE * 2; sp.height = SIZE * SQRT3;
        tileLayer.addChild(sp);
      } else {                                          // terrain sans tuile (relief, peuplements, route) : aplat vectoriel
        const t = TERRAIN[type];
        mapLayer.poly(c).fill(t.fill).stroke({ width: 1, color: t.stroke, alpha: 0.4 });
      }
      // Relief : arêtes hautes éclairées, arêtes basses ombrées → profondeur.
      // Biseau discret pour ne pas concurrencer les contours de zone.
      for (const e of UPPER_EDGES) strokeEdge(mapLayer, c, e, 0xffffff, 0.05, 1.5);
      for (const e of LOWER_EDGES) strokeEdge(mapLayer, c, e, 0x000000, 0.06, 1.5);
    }
    for (const { q, r } of state.hexes) {
      const type = state.terrain.get(key(q, r));
      const { x, y } = axialToPixel(q, r);
      if (type === 'town') {
        decoLayer.rect(x - 7, y - 7, 14, 14).fill(0x3a2c17).stroke({ width: 1.5, color: 0xe8d29a });
      } else if (type === 'village') {
        // village : marqueur plus petit qu'une ville.
        decoLayer.rect(x - 4, y - 4, 8, 8).fill(0x4a3c22).stroke({ width: 1.2, color: 0xd8c48a });
      } else if (type === 'urban') {
        // zone urbaine : semis de petits bâtiments (bâti plus dense qu'un village).
        decoLayer.rect(x - 7, y - 6, 5, 5).fill(0x40414a).stroke({ width: 1, color: 0xc7c7cf });
        decoLayer.rect(x - 1, y - 7, 5, 5).fill(0x40414a).stroke({ width: 1, color: 0xc7c7cf });
        decoLayer.rect(x + 3, y + 1, 5, 5).fill(0x40414a).stroke({ width: 1, color: 0xc7c7cf });
        decoLayer.rect(x - 4, y + 2, 5, 5).fill(0x40414a).stroke({ width: 1, color: 0xc7c7cf });
      } else if (type === 'oasis') {
        // bois : petit bosquet de touffes plutôt qu'un seul rond.
        decoLayer.circle(x - 4, y + 2, 4.5).fill(0x2f4a25).stroke({ width: 1, color: 0x7fb45f });
        decoLayer.circle(x + 4, y + 2, 4.5).fill(0x2f4a25).stroke({ width: 1, color: 0x7fb45f });
        decoLayer.circle(x, y - 3, 5).fill(0x365a2c).stroke({ width: 1, color: 0xa8d488 });
      } else if (type === 'rock') {
        // coteau : deux bosses.
        decoLayer.poly([x - 9, y + 4, x - 3, y - 5, x + 3, y + 4]).fill(0x7c7360).stroke({ width: 1, color: 0xc7bfa6 });
        decoLayer.poly([x + 1, y + 5, x + 6, y - 3, x + 10, y + 5]).fill(0x8b8168).stroke({ width: 1, color: 0xc7bfa6 });
      } else if (type === 'sea') {
        // rivière : rides.
        decoLayer.moveTo(x - 6, y - 3).quadraticCurveTo(x - 3, y - 5, x, y - 3).quadraticCurveTo(x + 3, y - 1, x + 6, y - 3).stroke({ width: 1, color: 0xaed3e2, alpha: 0.5 });
        decoLayer.moveTo(x - 6, y + 4).quadraticCurveTo(x - 3, y + 2, x, y + 4).quadraticCurveTo(x + 3, y + 6, x + 6, y + 4).stroke({ width: 1, color: 0xaed3e2, alpha: 0.5 });
      } else if (type === 'road') {
        // route : trait vers chaque voisin carrossable (route/ville/base) → réseau.
        let linked = false;
        for (const [dq, dr] of DIRS) {
          const nt = state.terrain.get(key(q + dq, r + dr));
          if (nt === 'road' || nt === 'town' || nt === 'base') {
            const np = axialToPixel(q + dq, r + dr);
            decoLayer.moveTo(x, y).lineTo((x + np.x) / 2, (y + np.y) / 2).stroke({ width: 3, color: 0x8a7550 });
            linked = true;
          }
        }
        if (!linked) decoLayer.circle(x, y, 2.5).fill(0x8a7550);
      }
      // Rivage : arête entre eau et terre soulignée d'écume.
      if (type === 'sea') {
        const c = hexCorners(x, y);
        for (let d = 0; d < 6; d++) {
          const nt = state.terrain.get(key(q + DIRS[d][0], r + DIRS[d][1]));
          if (nt && nt !== 'sea') strokeEdge(decoLayer, c, DIR_TO_EDGE[d], 0xcde7ef, 0.6, 1.5);
        }
      }
    }
    // Camps de base : encadré + fanion à la couleur du camp.
    for (const s of ['axis', 'ally']) {
      const [c, rw] = BASES[s];
      const { q, r } = offsetToAxial(c, rw);
      const { x, y } = axialToPixel(q, r);
      const col = FILL[s];
      decoLayer.rect(x - 9, y - 9, 18, 18).fill(0x241d10).stroke({ width: 2, color: col });
      decoLayer.rect(x - 1, y - 10, 2, 9).fill(col);
      decoLayer.poly([x + 1, y - 10, x + 8, y - 8, x + 1, y - 6]).fill(col);
    }

    // -- Pions ---------------------------------------------------------------
    const CS = 50;
    const counters = new Map();
    const mixDark = (col) => {
      const r = (col >> 16) & 255, g = (col >> 8) & 255, b = col & 255;
      return (((r * 0.62) | 0) << 16) | (((g * 0.62) | 0) << 8) | ((b * 0.62) | 0);
    };
    const drawSymbol = (g, type, x, y, w, h, color) => {
      const cx = x + w / 2, cy = y + h / 2, line = { width: 1.6, color };
      if (type === 'inf' || type === 'mech') {
        g.moveTo(x, y).lineTo(x + w, y + h).moveTo(x + w, y).lineTo(x, y + h).stroke(line);
      }
      if (type === 'armor' || type === 'mech') g.ellipse(cx, cy, w * 0.33, h * 0.3).stroke(line);
      if (type === 'arty') g.circle(cx, cy, Math.min(w, h) * 0.17).fill(color);
      if (type === 'moto') g.moveTo(x, y + h).lineTo(x + w, y).stroke(line);
    };
    function makeCounter(u) {
      const c = new PIXI.Container();
      const baseFill = FILL[u.side];
      const fill = u.reduced ? mixDark(baseFill) : baseFill;
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
      const ech = T(u.ech, 8); ech.position.set(0, -CS / 2 + 7);
      const nm = T(u.name, 9); nm.position.set(0, -CS / 2 + 17);
      // Facteurs de la FACE courante ; le ravitaillement modifie l'effectif au
      // combat mais pas le nombre imprimé.
      const fa = u.reduced ? u.ratk : u.atk, fd = u.reduced ? u.rdef : u.def, fm = u.reduced ? u.rmov : u.mov;
      const fac = T(`${fa}-${fd}-${fm}`, 10); fac.position.set(0, CS / 2 - 8);
      c.addChild(shadow, base, box, ech, nm, fac);
      if (u.reduced) {                                  // bande d'angle rouge = pion réduit
        const stripe = new PIXI.Graphics();
        stripe.poly([CS / 2 - 12, -CS / 2, CS / 2, -CS / 2, CS / 2, -CS / 2 + 12]).fill(0xb33a2a);
        c.addChild(stripe);
      }
      if (!u.supplied) {                                // liseré orange = hors ravito
        const oos = new PIXI.Graphics();
        oos.roundRect(-CS / 2, -CS / 2, CS, CS, 5).stroke({ width: 2.5, color: 0xe08a2a });
        oos.circle(-CS / 2 + 7, CS / 2 - 7, 4).fill(0xe08a2a).stroke({ width: 1, color: 0x1c1810 });
        c.addChild(oos);
      }
      c.eventMode = 'none';
      counters.set(u.id, c);
      unitLayer.addChild(c);
      return c;
    }
    function rebuildCounters() {
      for (const c of counters.values()) c.destroy();
      counters.clear();
      unitLayer.removeChildren();
      state.units.forEach(makeCounter);
    }
    function layoutStacks() {
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

    // =========================================================================
    //  Sélection & interaction
    // =========================================================================
    let sel = null;               // { unit, reachable, dist, eZOC }  (phase mouvement)
    let pending = null;           // { key, q, r, hasOwn } — déplacement en attente de confirmation
    let dragOverKey = null;       // hexe survolé pendant un glisser d'unité (drag & drop)
    let pendingCombat = null;     // { atkUnits, defender } — combat en attente de décision
    let showSupply = false;       // overlay de la zone ravitaillée du camp actif
    let showLegend = false;       // panneau de légende (coin bas-droit)
    const attackers = new Set();  // ids des unités attaquantes       (phase combat)
    function clearPending() {
      pending = null;
      $('moveConfirm').style.display = 'none';
    }
    function clearSel() {
      sel = null;
      attackers.clear();
      clearPending();
    }

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
    // hexe de la zone, on dessine les arêtes qui bordent un hexe hors zone
    // (DIR_TO_EDGE défini plus haut).
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

    // Trace la ligne de ravitaillement de chaque unité du camp actif jusqu'à sa
    // source, en suivant la route du flood-fill. Halo doré sur les sources.
    // Une unité coupée n'a pas de ligne (repérable aussi au liseré orange).
    function drawSupplyLines() {
      const side = state.G.player;
      const { supplied, parent } = supplyRoutes(state, side);
      const color = SUP[side];
      // Atténué quand on planifie un déplacement, pour laisser la portée dominer.
      const fillA = state.G.phase === 'move' && sel ? 0.06 : 0.16;
      for (const k of supplied) fillHex(k, color, fillA);  // teinte de la zone ravitaillée
      drawZoneOutline(supplied, color, 3, 0.95);           // pourtour renforcé
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
        if (pts.length < 4) continue;                       // unité déjà sur sa source
        overlay.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) overlay.lineTo(pts[i], pts[i + 1]);
        overlay.stroke({ width: 2.5, color, alpha: 0.85 });
        overlay.circle(pts[0], pts[1], 3).fill({ color, alpha: 0.9 }); // extrémité côté unité
      }
    }

    function drawOverlay() {
      overlay.clear();
      if (showSupply) drawSupplyLines();
      if (state.G.phase === 'move') {
        const eZOC = zocOf(state.units, other(state.G.player), state.terrain);
        const zone = new Set(eZOC);
        for (const u of state.units) {
          if (u.side !== state.G.player) zone.add(key(u.q, u.r)); // hexe de l'unité → pourtour plein
        }
        drawZoneOutline(zone, 0xcc4433, 2.5, 0.9);
        if (sel) {
          const terminal = new Set([...sel.reachable].filter((k) => eZOC.has(k))); // ZOC → arrêt forcé
          for (const k of sel.reachable) fillHex(k, terminal.has(k) ? 0xd23b2b : 0xe8c85a, terminal.has(k) ? 0.3 : 0.22);
          drawZoneOutline(sel.reachable, 0xf0c040, 2.5, 0.85);              // frontière nette de la portée
          for (const k of terminal) drawHexOutline(k, 0xd23b2b, 2.5, 0.95); // liseré « on s'arrête ici »
          drawHexOutline(key(sel.unit.q, sel.unit.r), 0xffffff, 3, 0.75);
        }
        if (pending) drawHexOutline(pending.key, 0x8fbf6a, 4, 1); // destination en attente
        if (sel && dragOverKey && sel.reachable.has(dragOverKey)) drawHexOutline(dragOverKey, 0x8fbf6a, 4, 1); // cible du glisser
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
        for (const id of attackers) {
          const u = state.units.find((x) => x.id === id);
          if (u) drawHexOutline(key(u.q, u.r), 0x6f9a5c, 3, 0.95);
        }
      }
    }

    function handleClick(p) {
      if (state.G.over) return;
      const { q, r } = pixelToAxial(p.x, p.y);
      const k = key(q, r);
      if (!state.terrain.has(k)) {
        clearSel();
        refresh();
        return;
      }
      if (state.G.phase === 'move') handleMove(q, r, k);
      else handleCombat(q, r, k);
      refresh();
    }
    function handleMove(q, r, k) {
      const own = unitsAt(state.units, q, r).filter((u) => u.side === state.G.player);
      // Hex atteignable → déplacement en attente de confirmation (bulle sur l'hex).
      if (sel && sel.reachable.has(k)) {
        pending = { key: k, q, r, hasOwn: own.length > 0 };
        return;
      }
      // Sinon : (dé)sélection d'une unité amie.
      clearPending();
      sel = own.length ? { unit: own[own.length - 1], ...computeReachable(state, own[own.length - 1]) } : null;
    }
    function confirmMove() {
      if (!sel || !pending) return;
      moveUnit(sel.unit, pending.key, sel.dist, sel.eZOC);
      sel = sel.unit.mpLeft > 0 ? { unit: sel.unit, ...computeReachable(state, sel.unit) } : null;
      clearPending();
      refresh();
    }
    function selectPendingUnit() {
      if (!pending) return;
      const [q, r] = pending.key.split(',').map(Number);
      const own = unitsAt(state.units, q, r).filter((u) => u.side === state.G.player);
      clearPending();
      sel = own.length ? { unit: own[own.length - 1], ...computeReachable(state, own[own.length - 1]) } : null;
      refresh();
    }
    function positionMoveTooltip() {
      if (!pending) return;
      const { x, y } = axialToPixel(pending.q, pending.r);
      const g = world.toGlobal(new PIXI.Point(x, y));
      const rc = app.canvas.getBoundingClientRect();
      const el = $('moveConfirm');
      el.style.left = rc.left + g.x + 'px';
      el.style.top = rc.top + g.y + 'px';
    }
    function showMoveTooltip() {
      $('btnSelectMove').style.display = pending.hasOwn ? '' : 'none';
      $('moveConfirm').style.display = 'flex';
      positionMoveTooltip();
    }
    function handleCombat(q, r) {
      const stack = unitsAt(state.units, q, r);
      if (!stack.length) {
        attackers.clear();
        return;
      }
      const top = stack[stack.length - 1];
      if (top.side !== state.G.player) {                    // clic ennemi → résoudre
        let atkUnits = [...attackers].map((id) => state.units.find((u) => u.id === id)).filter(Boolean)
          .filter((u) => hexDistance(u.q, u.r, q, r) === 1 && !u.hasFought);
        if (!atkUnits.length) {                              // sinon : tous les amis adjacents libres
          atkUnits = state.units.filter((u) => u.side === state.G.player && !u.hasFought && hexDistance(u.q, u.r, q, r) === 1);
        }
        if (!atkUnits.length) {
          log('Aucun attaquant adjacent.');
          return;
        }
        showCombatPreview(atkUnits, top);                   // aperçu → décider d'engager
      } else {                                               // clic ami → (dé)sélection attaquant
        if (top.hasFought) return;
        if (!state.units.some((e) => e.side !== state.G.player && hexDistance(e.q, e.r, q, r) === 1)) return;
        if (attackers.has(top.id)) attackers.delete(top.id);
        else attackers.add(top.id);
      }
    }

    // -- Survol : récap de l'hexe après une courte pause ----------------------
    const HOVER_DELAY = 300;
    let hoverKey = null, hoverTimer = null, hoverPos = null;
    function hideHexTooltip() {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      $('hexTip').style.display = 'none';
    }
    function hexRecapHtml(k) {
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
    function showHexTooltip(k) {
      const el = $('hexTip');
      el.innerHTML = hexRecapHtml(k);
      el.style.display = 'block';
      const rc = app.canvas.getBoundingClientRect();
      let left = rc.left + hoverPos.x + 16, top = rc.top + hoverPos.y + 16;
      if (left + el.offsetWidth > window.innerWidth) left = rc.left + hoverPos.x - el.offsetWidth - 16;
      if (top + el.offsetHeight > window.innerHeight) top = window.innerHeight - el.offsetHeight - 8;
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    }
    function handleHover(e) {
      if (state.G.over || (ptr && ptr.moved)) { hoverKey = null; hideHexTooltip(); return; }
      const p = world.toLocal(e.global);
      const { q, r } = pixelToAxial(p.x, p.y);
      const k = key(q, r);
      hoverPos = { x: e.global.x, y: e.global.y };
      if (!state.terrain.has(k)) { hoverKey = null; hideHexTooltip(); return; }
      if (k === hoverKey) return;              // même hexe : laisser le minuteur courir
      hoverKey = k;
      hideHexTooltip();
      hoverTimer = setTimeout(() => showHexTooltip(k), HOVER_DELAY);
    }

    // -- Pointeur : glisser = pan, clic bref = action, molette/boutons = zoom --
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    let ptr = null;
    app.stage.on('pointerdown', (e) => {
      hoverKey = null;
      hideHexTooltip();
      ptr = { sx: e.global.x, sy: e.global.y, wx: world.x, wy: world.y, moved: false };
      // Saisir une unité amie déplaçable → glisser-déposer (au lieu de paner).
      if (!state.G.over && state.G.phase === 'move') {
        const p = world.toLocal(e.global);
        const { q, r } = pixelToAxial(p.x, p.y);
        const own = state.terrain.has(key(q, r))
          ? unitsAt(state.units, q, r).filter((u) => u.side === state.G.player) : [];
        if (own.length) {
          clearPending();
          sel = { unit: own[own.length - 1], ...computeReachable(state, own[own.length - 1]) };
          ptr.dragUnit = sel.unit;
          dragOverKey = null;
          refresh();                                   // reconstruit les pions
          const c = counters.get(ptr.dragUnit.id);     // le pion saisi passe devant, se soulève et s'incline
          if (c) { unitLayer.setChildIndex(c, unitLayer.children.length - 1); c.scale.set(1.15); c.rotation = 0.14; draw(); }
        }
      }
    });
    app.stage.on('pointermove', (e) => {
      handleHover(e);
      if (!ptr) return;
      const dx = e.global.x - ptr.sx, dy = e.global.y - ptr.sy;
      if (!ptr.moved && Math.hypot(dx, dy) > 6) ptr.moved = true;
      if (ptr.dragUnit) {                              // glisser une unité : le pion suit le curseur
        if (!ptr.moved) return;
        const p = world.toLocal(e.global);
        const c = counters.get(ptr.dragUnit.id);
        if (c) c.position.set(p.x, p.y);               // pion au bout de la souris
        const { q, r } = pixelToAxial(p.x, p.y);
        const k = key(q, r);
        if (k !== dragOverKey) { dragOverKey = k; drawOverlay(); }
        draw();
      } else if (ptr.moved) {
        world.position.set(ptr.wx + dx, ptr.wy + dy);
        draw();
        if (pending) positionMoveTooltip();
      }
    });
    app.stage.on('pointerup', (e) => {
      if (ptr && ptr.dragUnit && ptr.moved) {          // lâcher : déplacer si la cible est atteignable
        const p = world.toLocal(e.global);
        const { q, r } = pixelToAxial(p.x, p.y);
        const k = key(q, r);
        if (sel && sel.reachable.has(k)) {
          moveUnit(sel.unit, k, sel.dist, sel.eZOC);
          sel = sel.unit.mpLeft > 0 ? { unit: sel.unit, ...computeReachable(state, sel.unit) } : null;
        }
        dragOverKey = null;
        ptr = null;
        refresh();
      } else {
        if (ptr && !ptr.moved) handleClick(world.toLocal(e.global));
        ptr = null;
      }
      hideHexTooltip();
    });
    app.stage.on('pointerupoutside', () => { if (ptr) { ptr = null; dragOverKey = null; refresh(); } });
    app.canvas.addEventListener('pointerleave', () => { hoverKey = null; hideHexTooltip(); });

    const zoomAt = (m, cx, cy) => {
      const s0 = world.scale.x, s1 = clamp(s0 * m, 0.32, 2.6);
      const wx = (cx - world.x) / s0, wy = (cy - world.y) / s0;
      world.scale.set(s1);
      world.position.set(cx - wx * s1, cy - wy * s1);
      draw();
      if (pending) positionMoveTooltip();
    };
    app.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      hideHexTooltip();
      const rc = app.canvas.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - rc.left, e.clientY - rc.top);
    }, { passive: false });
    function fitView() {
      const b = mapLayer.getLocalBounds();
      const s = clamp(Math.min(app.screen.width / b.width, app.screen.height / b.height) * 0.9, 0.32, 2.6);
      world.scale.set(s);
      world.position.set((app.screen.width - b.width * s) / 2 - b.x * s, (app.screen.height - b.height * s) / 2 - b.y * s);
      draw();
    }
    document.getElementById('btnIn').onclick = () => zoomAt(1.2, app.screen.width / 2, app.screen.height / 2);
    document.getElementById('btnOut').onclick = () => zoomAt(0.83, app.screen.width / 2, app.screen.height / 2);
    document.getElementById('btnReset').onclick = fitView;
    const btnSupply = document.getElementById('btnSupply');
    btnSupply.classList.toggle('on', showSupply);
    btnSupply.onclick = () => {
      showSupply = !showSupply;
      btnSupply.classList.toggle('on', showSupply);
      drawOverlay();
      draw();
    };
    const legend = document.getElementById('legend');
    const btnLegend = document.getElementById('btnLegend');
    btnLegend.classList.toggle('on', showLegend);
    legend.style.display = showLegend ? '' : 'none';
    btnLegend.onclick = () => {
      showLegend = !showLegend;
      btnLegend.classList.toggle('on', showLegend);
      legend.style.display = showLegend ? '' : 'none';
    };
    document.getElementById('btnPhase').onclick = () => endPhase(state);

    // =========================================================================
    //  HUD (DOM) & boucle de rafraîchissement
    // =========================================================================
    const $ = (id) => document.getElementById(id);
    const logLines = [];
    function log(s) {
      logLines.unshift(s);
      if (logLines.length > 8) logLines.pop();
      $('logBody').innerHTML = logLines.map((l) => `<div class="line">${l}</div>`).join('');
    }

    function refresh() {
      updateObjectives(state);
      updateSupply(state);
      rebuildCounters();
      layoutStacks();
      drawOverlay();
      if (state.G.phase === 'move' && pending) showMoveTooltip();
      else $('moveConfirm').style.display = 'none';
      $('turnNum').textContent = state.G.turn;
      const sb = $('badgeSide');
      sb.textContent = sideLabel(state.G.player);
      sb.className = 'badge ' + state.G.player;
      $('badgePhase').textContent = state.G.phase === 'move' ? 'MOUVEMENT' : 'COMBAT';
      const camp = 'du camp ' + sideLabel(state.G.player);
      $('hint').innerHTML = state.G.phase === 'move'
        ? `Clique une unité ${camp} pour voir ses déplacements, puis un hexagone surligné. Entrer dans une ZOC ennemie (rouge) stoppe l'unité.`
        : "Clique tes unités adjacentes à l'ennemi pour désigner les attaquants (vert), puis l'unité ennemie à assaillir (rouge). Blindé + infanterie et artillerie à portée (≤3 hex) décalent la table en ta faveur.";
      $('btnPhase').textContent = state.G.phase === 'move' ? 'Passer au combat ▸'
        : state.G.player === 'axis' ? 'Fin de tour Bleu → Rouge ▸' : `Fin du tour ${state.G.turn} ▸`;

      let html = '';
      if (state.G.phase === 'move' && sel) {
        const u = sel.unit;
        const sup = u.supplied
          ? '<span style="color:#8fbf6a">ravitaillée</span>'
          : '<span style="color:#e08a2a">HORS ravito</span>';
        html = `<div class="kv"><span>Unité</span><span><b>${u.name}</b>${u.reduced ? ' <span style="color:#d16a55">(réduite)</span>' : ''}</span></div>`
          + `<div class="sub" style="margin:-2px 0 3px">${u.fullName}</div>`
          + `<div class="kv"><span>Att-Déf-Mvt</span><span>${eAtk(u)}-${eDef(u)}-${eMov(u)}</span></div>`
          + `<div class="kv"><span>Ravitaillement</span><span>${sup}</span></div>`
          + `<div class="kv"><span>PM restants</span><span><b>${u.mpLeft}</b></span></div>`;
      } else if (state.G.phase === 'combat' && attackers.size) {
        const as = [...attackers].map((id) => state.units.find((u) => u.id === id)).filter(Boolean);
        const combo = as.some(isArmor) && as.some(isFoot);
        html = `<div class="kv"><span>Attaquants</span><span>${as.map((u) => u.name).join(', ')}</span></div>`
          + `<div class="kv"><span>Force totale</span><span><b>${as.reduce((s, u) => s + eAtk(u), 0)}</b></span></div>`
          + `<div class="kv"><span>Armes combinées</span><span>${combo ? '<span style="color:#8fbf6a">✓ +1 colonne</span>' : '<span style="color:#8a8064">—</span>'}</span></div>`
          + `<div class="sub" style="margin-top:4px">Clique l'unité ennemie à attaquer. L'artillerie amie à portée ajoutera son appui.</div>`;
      } else {
        html = '<span class="empty">Aucune sélection.</span>';
      }
      $('inspBody').innerHTML = html;

      $('objbar').innerHTML = `<div class="kv"><span>Objectifs</span>`
        + `<span><b>${objCount(state, 'axis')}</b> ${sideLabel('axis')} · <b>${objCount(state, 'ally')}</b> ${sideLabel('ally')} · ${state.objectives.length} au total</span></div>`
        + `<div class="sub">Le camp contrôlant le plus d'objectifs au tour ${MAX_TURNS} l'emporte.</div>`;
      draw();
    }

    // Modale animée explicitant le déroulé d'un combat : en-tête → dé qui défile
    // → résultat coloré → conséquences narrées une à une.
    let combatTimers = [];
    const clearCombatTimers = () => { combatTimers.forEach(clearTimeout); combatTimers = []; };
    const at = (fn, ms) => combatTimers.push(setTimeout(fn, ms));
    const modsList = (p) => {
      const m = [];
      if (p.combined) m.push('combiné +1');
      if (p.arty) m.push(`artillerie +${p.arty}`);
      if (p.terr) m.push(p.terr > 0 ? `terrain −${p.terr}` : `terrain +${-p.terr}`); // <0 = malus attaquant
      return m.length ? m.join(', ') : 'aucun';
    };
    // Version visuelle du calcul (aperçu, avant décision) : duel Attaque/Défense.
    const combatCalcHtml = (p) => {
      const chips = p.breakdown
        .map((b) => `<span class="chip">${b.name} <b>${b.atk}</b>${b.reduced ? ' <span class="rd">réd.</span>' : ''}</span>`)
        .join('');
      const dn = [];
      if (p.defReduced) dn.push('réduite');
      if (!p.defSupplied) dn.push('÷2 hors ravito');
      const defNote = dn.length ? `<span class="dn">${dn.join(' · ')}</span>` : '';
      const ratio = (p.atk / p.def).toFixed(1).replace('.', ',');
      const net = p.combined + p.arty - p.terr;
      const shift = modsList(p) === 'aucun' ? 'aucun décalage' : `${modsList(p)} → net ${net > 0 ? '+' : ''}${net}`;
      return `<div class="duel">`
        + `<div class="side atk"><div class="lab">Attaque</div><div class="big">${p.atk}</div><div class="chips">${chips}</div></div>`
        + `<div class="vs">contre</div>`
        + `<div class="side def"><div class="lab">Défense</div><div class="big">${p.def}</div><div class="chips"><span class="chip">${p.defender}</span></div>${defNote}</div>`
        + `</div>`
        + `<div class="flow"><span>Rapport <b>${p.atk} ÷ ${p.def} ≈ ${ratio}</b></span>`
        + `<span>→ base <b>${p.baseCol}</b></span>`
        + `<span class="sub">${shift}</span>`
        + `<span>→ colonne <b class="finalcol">${p.col}</b></span></div>`;
    };
    // Table de combat complète : colonne active surlignée ; si `dieIdx >= 0`, la
    // case (colonne active × dé) est mise en évidence.
    const crtTableHtml = (activeCol, dieIdx) => {
      let html = '<table class="crt"><tr><th>dé</th>';
      for (const c of ODDS) html += `<th class="${c === activeCol ? 'colon' : ''}">${c}</th>`;
      html += '</tr>';
      for (let d = 0; d < 6; d++) {
        html += `<tr><th>${d + 1}</th>`;
        for (const c of ODDS) {
          const active = c === activeCol;
          const code = CRT[c][d];
          html += `<td class="r-${code}${active ? ' colon' : ''}${active && d === dieIdx ? ' hit' : ''}">${code}</td>`;
        }
        html += '</tr>';
      }
      return html + '</table>'
        + '<div class="sub" style="margin-top:3px;font-size:10px">DE déf. éliminé · DR déf. repoussé · EX échange · AR att. repoussé · AE att. éliminé</div>'
        + '<div class="sub" style="font-size:10px;opacity:.85">Couleur = enjeu pour l\'attaquant : vert favorable, rouge défavorable.</div>';
    };

    // Aperçu AVANT le dé : stats, colonne, issues possibles, et décision.
    function showCombatPreview(atkUnits, defender) {
      if (state.G.over) return;
      clearCombatTimers();
      const p = combatPlan(state, atkUnits, defender);
      pendingCombat = { atkUnits, defender };
      $('combatBody').innerHTML = combatCalcHtml(p);
      $('combatTable').innerHTML =
        `<div class="sub" style="margin-top:6px">Table de combat — ta colonne <b>${p.col}</b> surlignée (droite = plus favorable à l'attaquant) :</div>`
        + crtTableHtml(p.col, -1);
      $('combatRes').textContent = '';
      $('combatRes').style.background = 'transparent';
      $('combatEffects').innerHTML = '';
      $('combatBtn').style.display = 'none';
      $('combatBtns').style.display = 'flex';
      $('combatModal').style.display = 'flex';
    }

    // Anime le dé DANS la colonne active de la table de l'aperçu (sans reconstruire
    // la modale) : un surlignage parcourt la colonne, se fige sur la case du dé,
    // puis on révèle résultat et conséquences.
    function runRoll(p) {
      if (state.G.over) return;                             // la victoire est déjà annoncée
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
      const good = p.res === 'DE' || p.res === 'DR';        // favorable à l'attaquant
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
    $('combatBtn').onclick = () => { clearCombatTimers(); $('combatModal').style.display = 'none'; };
    $('btnRollCombat').onclick = () => {
      if (!pendingCombat) return;
      const { atkUnits, defender } = pendingCombat;
      pendingCombat = null;
      $('combatBtns').style.display = 'none';
      resolveCombat(state, atkUnits, defender);             // → combatResolved → runRoll (anime la colonne)
      attackers.clear();
      refresh();
      if (state.G.over) $('combatModal').style.display = 'none'; // le bandeau de victoire prend le relais
    };
    $('btnRefuseCombat').onclick = () => {
      pendingCombat = null;
      $('combatModal').style.display = 'none';
      log('Combat refusé.');
    };

    // -- Abonnements au bus : le rendu réagit aux événements des règles -------
    state.bus.on('log', log);
    state.bus.on('combatResolved', runRoll);
    state.bus.on('phaseChanged', () => {
      clearSel();
      refresh();
    });
    state.bus.on('gameOver', ({ side, reason }) => {
      clearSel();
      drawOverlay();
      draw();
      $('bannerTitle').textContent = `Victoire du camp ${sideLabel(side)}`;
      $('bannerSub').textContent = reason;
      $('banner').style.display = 'flex';
    });
    $('bannerBtn').onclick = () => {                                       // nouvelle carte, mêmes armées
      const p = new URLSearchParams(location.search);
      p.delete('seed');
      p.delete('map');                                                     // carte aléatoire fraîche
      location.href = 'game' + (p.toString() ? `?${p.toString()}` : '');   // URL propre (garde la query)
    };
    $('bannerHome').onclick = () => { location.href = '/'; };              // retour à l'accueil
    $('btnConfirmMove').onclick = confirmMove;
    $('btnSelectMove').onclick = selectPendingUnit;
    $('btnCancelMove').onclick = () => { clearPending(); refresh(); };

    fitView();
    refresh();
    log('Partie prête — tour 1, phase de mouvement du camp Bleu.');
  } catch (err) {
    const el = document.getElementById('err');
    el.style.display = 'block';
    el.textContent = "Erreur d'initialisation :\n" + (err && err.stack ? err.stack : err);
  }
})();
