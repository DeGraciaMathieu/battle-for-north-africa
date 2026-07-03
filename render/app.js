// ===========================================================================
//  Couche de rendu & interaction (PixiJS v8 + HUD DOM).
//  N'importe QUE des règles pures depuis ../src : cette couche lit l'état et
//  s'abonne au bus d'événements ; elle ne contient aucune règle de jeu.
// ===========================================================================

import { TERRAIN, MAX_TURNS } from '../src/config.js';
import { key, axialToPixel, pixelToAxial, hexCorners, hexDistance, clamp } from '../src/geometry.js';
import { eAtk, eDef, eMov, other, unitsAt, enemyAt, stackCount, isArmor, isFoot } from '../src/units.js';
import { zocOf, computeReachable, moveUnit } from '../src/movement.js';
import { resolveCombat } from '../src/combat.js';
import { updateSupply } from '../src/supply.js';
import { createGame, updateObjectives, objCount, endPhase } from '../src/game.js';

const PIXI = window.PIXI;

(async () => {
  try {
    const state = createGame();

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
    // Rendu à la demande : jeu au tour par tour, rien n'anime → on coupe la
    // boucle 60 fps et on ne redessine que quand l'état OU la vue change.
    app.ticker.stop();
    const draw = () => app.render();
    window.addEventListener('resize', () => {
      app.renderer.resize(window.innerWidth, window.innerHeight);
      app.stage.hitArea = app.screen;
      draw();
    });

    const world = new PIXI.Container();
    const mapLayer = new PIXI.Graphics(), decoLayer = new PIXI.Graphics(),
      overlay = new PIXI.Graphics(), unitLayer = new PIXI.Container();
    world.addChild(mapLayer, decoLayer, overlay, unitLayer);
    app.stage.addChild(world);

    for (const { q, r } of state.hexes) {
      const { x, y } = axialToPixel(q, r);
      const t = TERRAIN[state.terrain.get(key(q, r))];
      mapLayer.poly(hexCorners(x, y)).fill(t.fill).stroke({ width: 1, color: t.stroke, alpha: 0.55 });
    }
    for (const { q, r } of state.hexes) {
      const type = state.terrain.get(key(q, r));
      const { x, y } = axialToPixel(q, r);
      if (type === 'town') {
        decoLayer.rect(x - 7, y - 7, 14, 14).fill(0x3a2c17).stroke({ width: 1.5, color: 0xe8d29a });
      } else if (type === 'oasis') {
        decoLayer.circle(x, y, 7).fill(0x2f4a25).stroke({ width: 1.5, color: 0xa8d488 });
      }
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
      const baseFill = u.side === 'axis' ? 0x6d7061 : 0xcdb488;
      const fill = u.reduced ? mixDark(baseFill) : baseFill;
      const txt = u.side === 'axis' ? 0xf3efe2 : 0x2a2115;
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
          c.alpha = state.G.phase === 'combat' && u.side === state.G.player && u.hasFought ? 0.5 : 1;
        });
      }
    }

    // =========================================================================
    //  Sélection & interaction
    // =========================================================================
    let sel = null;               // { unit, reachable, dist, eZOC }  (phase mouvement)
    const attackers = new Set();  // ids des unités attaquantes       (phase combat)
    function clearSel() {
      sel = null;
      attackers.clear();
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

    function drawOverlay() {
      overlay.clear();
      if (state.G.phase === 'move') {
        const eZOC = zocOf(state.units, other(state.G.player), state.terrain);
        for (const k of eZOC) {
          if (!enemyAt(state.units, ...k.split(',').map(Number), state.G.player)) fillHex(k, 0xcc4433, 0.1);
        }
        if (sel) {
          for (const k of sel.reachable) fillHex(k, 0xe8c85a, 0.22);
          drawHexOutline(key(sel.unit.q, sel.unit.r), 0xffffff, 3, 0.75);
        }
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
      if (sel && sel.reachable.has(k)) {
        moveUnit(sel.unit, k, sel.dist, sel.eZOC);
        sel = sel.unit.mpLeft > 0 ? { unit: sel.unit, ...computeReachable(state, sel.unit) } : null;
        return;
      }
      const own = unitsAt(state.units, q, r).filter((u) => u.side === state.G.player);
      sel = own.length ? { unit: own[own.length - 1], ...computeReachable(state, own[own.length - 1]) } : null;
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
        resolveCombat(state, atkUnits, top);
        attackers.clear();
      } else {                                               // clic ami → (dé)sélection attaquant
        if (top.hasFought) return;
        if (!state.units.some((e) => e.side !== state.G.player && hexDistance(e.q, e.r, q, r) === 1)) return;
        if (attackers.has(top.id)) attackers.delete(top.id);
        else attackers.add(top.id);
      }
    }

    // -- Pointeur : glisser = pan, clic bref = action, molette/boutons = zoom --
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    let ptr = null;
    app.stage.on('pointerdown', (e) => {
      ptr = { sx: e.global.x, sy: e.global.y, wx: world.x, wy: world.y, moved: false };
    });
    app.stage.on('pointermove', (e) => {
      if (!ptr) return;
      const dx = e.global.x - ptr.sx, dy = e.global.y - ptr.sy;
      if (!ptr.moved && Math.hypot(dx, dy) > 6) ptr.moved = true;
      if (ptr.moved) {
        world.position.set(ptr.wx + dx, ptr.wy + dy);
        draw();
      }
    });
    app.stage.on('pointerup', (e) => {
      if (ptr && !ptr.moved) handleClick(world.toLocal(e.global));
      ptr = null;
    });
    app.stage.on('pointerupoutside', () => { ptr = null; });

    const zoomAt = (m, cx, cy) => {
      const s0 = world.scale.x, s1 = clamp(s0 * m, 0.32, 2.6);
      const wx = (cx - world.x) / s0, wy = (cy - world.y) / s0;
      world.scale.set(s1);
      world.position.set(cx - wx * s1, cy - wy * s1);
      draw();
    };
    app.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
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
      $('turnNum').textContent = state.G.turn;
      const sb = $('badgeSide');
      sb.textContent = state.G.player === 'axis' ? 'AXE' : 'ALLIÉ';
      sb.className = 'badge ' + state.G.player;
      $('badgePhase').textContent = state.G.phase === 'move' ? 'MOUVEMENT' : 'COMBAT';
      const camp = state.G.player === 'axis' ? "de l'Axe" : 'alliées';
      $('hint').innerHTML = state.G.phase === 'move'
        ? `Clique une unité ${camp} pour voir ses déplacements, puis un hexagone surligné. Entrer dans une ZOC ennemie (rouge) stoppe l'unité.`
        : "Clique tes unités adjacentes à l'ennemi pour désigner les attaquants (vert), puis l'unité ennemie à assaillir (rouge). Blindé + infanterie et artillerie à portée (≤3 hex) décalent la table en ta faveur.";
      $('btnPhase').textContent = state.G.phase === 'move' ? 'Passer au combat ▸'
        : state.G.player === 'axis' ? 'Fin de tour Axe → Allié ▸' : `Fin du tour ${state.G.turn} ▸`;

      let html = '';
      if (state.G.phase === 'move' && sel) {
        const u = sel.unit;
        const sup = u.supplied
          ? '<span style="color:#8fbf6a">ravitaillée</span>'
          : '<span style="color:#e08a2a">HORS ravito</span>';
        html = `<div class="kv"><span>Unité</span><span><b>${u.name}</b>${u.reduced ? ' <span style="color:#d16a55">(réduite)</span>' : ''}</span></div>`
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
        + `<span><b>${objCount(state, 'axis')}</b> Axe · <b>${objCount(state, 'ally')}</b> Allié · ${state.objectives.length} au total</span></div>`
        + `<div class="sub">Le camp contrôlant le plus d'objectifs au tour ${MAX_TURNS} l'emporte.</div>`;
      draw();
    }

    // -- Abonnements au bus : le rendu réagit aux événements des règles -------
    state.bus.on('log', log);
    state.bus.on('phaseChanged', () => {
      clearSel();
      refresh();
    });
    state.bus.on('gameOver', ({ side, reason }) => {
      clearSel();
      drawOverlay();
      draw();
      $('bannerTitle').textContent = side === 'axis' ? "Victoire de l'Axe" : 'Victoire alliée';
      $('bannerSub').textContent = reason;
      $('banner').style.display = 'flex';
    });
    $('bannerBtn').onclick = () => location.reload();

    fitView();
    refresh();
    log("Partie prête — tour 1, phase de mouvement de l'Axe.");
  } catch (err) {
    const el = document.getElementById('err');
    el.style.display = 'block';
    el.textContent = "Erreur d'initialisation :\n" + (err && err.stack ? err.stack : err);
  }
})();
