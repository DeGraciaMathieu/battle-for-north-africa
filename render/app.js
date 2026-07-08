// ===========================================================================
//  Couche de rendu & interaction (PixiJS v8 + HUD DOM).
//  N'importe QUE des règles pures depuis ../src : cette couche lit l'état et
//  s'abonne au bus d'événements ; elle ne contient aucune règle de jeu.
// ===========================================================================

import { TERRAIN, MAX_TURNS, BASES, CRT, ODDS, DIRS, CATALOG_ORDER, SIZE, SQRT3, ARTY_RANGE } from '../src/config.js';
import { key, axialToPixel, offsetToAxial, pixelToAxial, hexCorners, hexDistance, clamp } from '../src/geometry.js';
import { eAtk, eDef, eMov, other, unitsAt, enemyAt, stackCount, isArmor, isFoot } from '../src/units.js';
import { zocOf, computeReachable, moveUnit } from '../src/movement.js';
import { resolveCombat, combatPlan } from '../src/combat.js';
import { updateSupply, supplyRoutes, supplySources } from '../src/supply.js';
import { createGame, updateObjectives, objCount, victoryScore, endPhase } from '../src/game.js';
import { loadMap } from '../src/map.js';
import { mulberry32, makeCode, createHost, joinHost } from './net.js';
import { aiMovePhase, aiAttackPhase } from '../src/ai.js';

const PIXI = window.PIXI;

(async () => {
  try {
    // Seed de carte : reprise depuis l'URL (?seed=) si valide, sinon aléatoire.
    // Poussée dans l'URL pour pouvoir repartager la carte courante.
    const params = new URLSearchParams(location.search);
    const netRole = params.get('net');                 // 'host' | 'guest' | null (solo)
    const isOnline = netRole === 'host' || netRole === 'guest';
    const aiParam = params.get('ai');                  // 'blue' | 'red' : camp joué par l'IA (solo uniquement)
    const aiSide = !isOnline && (aiParam === 'blue' || aiParam === 'red') ? aiParam : null;
    const isAI = aiSide !== null;
    const sideLabel = (s) => (s === 'blue' ? 'BLEU' : 'ROUGE');

    // Armées de l'éditeur (accueil) : b/r = comptes par type (ordre CATALOG_ORDER).
    // Absentes (accès direct) → roster par défaut.
    const parseArmy = (s) => {
      const parts = String(s).split('.').map(Number);
      const army = {};
      CATALOG_ORDER.forEach((t, i) => { if (parts[i] > 0) army[t] = parts[i]; });
      return army;
    };
    // Carte nommée (dossier maps/) : prioritaire sur la seed si le fichier charge.
    async function loadMapData(mp) {
      if (mp && /^[\w-]+$/.test(mp)) {
        try {
          const res = await fetch(new URL(`../maps/${mp}.json`, import.meta.url));
          if (res.ok) return loadMap(await res.json());
        } catch { /* carte introuvable : repli sur la seed */ }
      }
      return null;
    }

    // -- Lobby réseau : mise en relation P2P avant le début de partie ----------
    const gid = (x) => document.getElementById(x);
    function showLobby(role, code) {
      const box = gid('lobbyBox');
      if (role === 'host') {
        const link = `${location.origin}${location.pathname.replace(/[^/]*$/, 'game')}?net=guest&code=${code}`;
        box.innerHTML =
          '<h2>Partie en ligne — 🔵 Bleu</h2>'
          + '<div class="sub">Transmets ce code à ton adversaire :</div>'
          + `<div id="lobbyCode">${code}</div>`
          + '<button id="lobbyCopy" class="lobbybtn">Copier le lien d\'invitation</button>'
          + '<div id="lobbyStatus" class="sub">Initialisation…</div>'
          + '<button id="lobbyHome" class="lobbybtn ghost">Annuler</button>';
        gid('lobbyCopy').onclick = () => {
          navigator.clipboard?.writeText(link);
          gid('lobbyCopy').textContent = 'Lien copié ✓';
        };
      } else {
        box.innerHTML =
          '<h2>Partie en ligne — 🔴 Rouge</h2>'
          + `<div class="sub">Connexion au code <b>${code}</b></div>`
          + '<div id="lobbyStatus" class="sub">Connexion…</div>'
          + '<button id="lobbyHome" class="lobbybtn ghost">Annuler</button>';
      }
      gid('lobbyHome').onclick = () => { location.href = '/'; };
      gid('lobby').style.display = 'flex';
    }
    const setLobbyStatus = (t) => { const el = gid('lobbyStatus'); if (el) el.textContent = t; };
    const hideLobby = () => { gid('lobby').style.display = 'none'; };
    function lobbyError(title, msg) {
      gid('lobbyBox').innerHTML = `<h2>${title}</h2><div class="sub">${msg}</div>`
        + '<button id="lobbyHome" class="lobbybtn">Retour à l\'accueil</button>';
      gid('lobbyHome').onclick = () => { location.href = '/'; };
      gid('lobby').style.display = 'flex';
    }

    // -- Résolution de la partie selon le rôle réseau -------------------------
    // Host/solo lisent l'URL ; le guest reçoit tout le descriptif de l'hôte, de
    // sorte que les deux clients construisent un état STRICTEMENT identique.
    let seed, fair, biome, mapParam, mapData, composition, rng, rngSeed;
    let localSide = null, net = null, started = false, netLost = false;
    const netQueue = [];                  // messages de jeu reçus avant la fin de l'init (différés)
    let onGameMsg = null;
    const onPeerLost = () => {
      if (!started) { lobbyError('Connexion interrompue', 'La liaison avec l\'adversaire a échoué.'); return; }
      if (!state.G.over) { netLost = true; lobbyError('Connexion perdue', 'Ton adversaire a quitté la partie.'); }
    };

    if (netRole === 'guest') {
      localSide = 'red';
      const code = (params.get('code') || '').toUpperCase();
      const desc = await new Promise((resolve, reject) => {
        showLobby('guest', code);
        net = joinHost(code, {
          onConnect: () => { setLobbyStatus('Connecté — réception de la partie…'); net.send({ t: 'hello' }); },
          onData: (m) => { if (onGameMsg) onGameMsg(m); else if (m.t === 'desc') resolve(m); else netQueue.push(m); },
          onClose: onPeerLost,
          onError: () => reject(new Error('Connexion impossible : code invalide ou hôte absent.')),
        });
      });
      seed = desc.seed; fair = desc.fair; biome = desc.biome || null; mapParam = desc.mapParam || null; rngSeed = desc.rngSeed;
      composition = desc.b && desc.r ? { blue: parseArmy(desc.b), red: parseArmy(desc.r) } : undefined;
      mapData = await loadMapData(mapParam);
      rng = mulberry32(rngSeed);
      hideLobby();
    } else {
      const seedParam = params.get('seed');
      seed = seedParam !== null && /^\d+$/.test(seedParam) ? Number(seedParam) : Math.floor(Math.random() * 0xffffffff);
      fair = params.get('gen') === 'fair';
      biome = params.get('biome') || null;
      mapParam = params.get('map');
      mapData = await loadMapData(mapParam);
      const b = params.get('b'), r = params.get('r');
      composition = b && r ? { blue: parseArmy(b), red: parseArmy(r) } : undefined;
      if (netRole === 'host') {
        localSide = 'blue';
        rngSeed = Math.floor(Math.random() * 0xffffffff);
        rng = mulberry32(rngSeed);
        const code = makeCode();
        await new Promise((resolve, reject) => {
          showLobby('host', code);
          net = createHost(code, {
            onReady: () => setLobbyStatus('En attente de connexion…'),
            onConnect: () => setLobbyStatus('Adversaire connecté — synchronisation…'),
            onData: (m) => {
              if (onGameMsg) return onGameMsg(m);
              if (m.t === 'hello') { net.send({ t: 'desc', seed, fair, biome: biome || null, mapParam: mapParam || null, b, r, rngSeed }); resolve(); }
              else netQueue.push(m);
            },
            onClose: onPeerLost,
            onError: () => reject(new Error('Impossible de créer la partie en ligne.')),
          });
        });
        hideLobby();
      } else {
        rng = Math.random;               // solo : aléa navigateur classique
      }
    }

    document.getElementById('seedVal').textContent = mapData ? mapParam : seed;
    if (!isOnline) {
      const q = new URLSearchParams();
      if (mapData) q.set('map', mapParam); else { q.set('seed', String(seed)); if (fair) q.set('gen', 'fair'); if (biome && biome !== 'tempere') q.set('biome', biome); }
      if (composition) { q.set('b', params.get('b')); q.set('r', params.get('r')); }
      if (isAI) q.set('ai', aiSide);
      history.replaceState(null, '', `?${q.toString()}`);
    }
    const state = createGame(rng, seed, composition, mapData ?? undefined, mapData ? undefined : { fair, biome });
    started = true;

    // Verrou de tour : hors ligne (sans IA) on joue les deux camps ; en ligne on
    // n'agit que pendant son propre camp ; contre l'IA on n'agit pas quand c'est
    // au camp de l'IA de jouer.
    const myTurn = () => isOnline ? (!netLost && state.G.player === localSide)
      : isAI ? state.G.player !== aiSide : true;
    const netSend = (m) => { if (net) net.send(m); };
    const byId = (id) => state.units.find((u) => u.id === id);
    if (isOnline || isAI) {
      const nb = gid('netbar');
      nb.style.display = '';
      nb.innerHTML = isOnline
        ? `🌐 En ligne — tu joues <b>${sideLabel(localSide)}</b>`
        : `🤖 Contre l'IA — tu joues <b>${sideLabel(other(aiSide))}</b>`;
    }
    const FILL = { blue: 0x4a6b9a, red: 0xa8544a };   // couleurs des camps (pions, camp de base)
    const SUP = { blue: 0x8fb0d8, red: 0xe0968f };    // teinte de ravitaillement par camp

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
    const TERRAIN_TILES = ['plain', 'plain2', 'bank', 'river'];
    const terrainTex = {};
    // Variantes de forêt (type 'forest') : purement visuelles, pour varier les
    // environnements. Une variante est choisie par hex de façon déterministe.
    const FOREST_TILES = ['foret-deep', 'foret-dense', 'foret-grove'];
    const FOREST_WEIGHTS = [1, 3, 2];              // deep raréfié au profit de dense
    const FOREST_TOTAL = FOREST_WEIGHTS.reduce((a, b) => a + b, 0);
    const forestTex = [];
    // Médailles d'objectif : une par état de contrôle (neutre / Bleu / Rouge).
    const medalTex = {};
    await Promise.all([
      ...TERRAIN_TILES.map(async (t) => { terrainTex[t] = await PIXI.Assets.load(asset(`terrain-${t}.png`)); }),
      ...FOREST_TILES.map(async (f, i) => { forestTex[i] = await PIXI.Assets.load(asset(`terrain-${f}.png`)); }),
      (async () => { medalTex.neutral = await PIXI.Assets.load(asset('medal_gray.png')); })(),
      (async () => { medalTex.blue = await PIXI.Assets.load(asset('medal_blue.png')); })(),
      (async () => { medalTex.red = await PIXI.Assets.load(asset('medal_red.png')); })(),
    ]);
    const forestPick = (q, r) => {
      const n = Math.sin(q * 91.7 + r * 47.3) * 43758.5453;
      let t = (n - Math.floor(n)) * FOREST_TOTAL;
      for (let i = 0; i < FOREST_WEIGHTS.length; i++) if ((t -= FOREST_WEIGHTS[i]) < 0) return i;
      return FOREST_WEIGHTS.length - 1;
    };
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
    window.addEventListener('resize', () => {
      app.renderer.resize(window.innerWidth, window.innerHeight);
      app.stage.hitArea = app.screen;
      draw();
      if (pending) positionMoveTooltip();
    });

    const world = new PIXI.Container();
    const tileLayer = new PIXI.Container(), mapLayer = new PIXI.Graphics(), decoLayer = new PIXI.Graphics(),
      overlay = new PIXI.Graphics(), objLayer = new PIXI.Container(), unitLayer = new PIXI.Container(), statsLayer = new PIXI.Container(), fxLayer = new PIXI.Graphics();
    world.addChild(tileLayer, mapLayer, decoLayer, overlay, objLayer, unitLayer, statsLayer, fxLayer); // médailles au-dessus des surbrillances, sous les pions
    app.stage.addChild(world);

    // -- Effets de combat : impact (unité réduite) / explosion (unité éliminée).
    // Le rendu est à la demande (ticker arrêté) ; on ne rallume la boucle que le
    // temps qu'un effet vive, puis on la recoupe. Chaque touche déclenche 3 foyers
    // décalés sur les bords de la tuile, chacun virant du jaune au rouge + une
    // onde de choc.
    let fx = [];                                   // foyers actifs { x, y, kind, t, delay, dur }
    // Interpolation de couleur (jaune → rouge) selon la progression du foyer.
    const lerpColor = (a, b, t) => {
      const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t);
      const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
      const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t);
      return (r << 16) | (g << 8) | bl;
    };
    function drawFx() {
      fxLayer.clear();
      for (const e of fx) {
        if (e.t < e.delay) continue;               // foyer pas encore éclos (décalage)
        const p = Math.min(1, (e.t - e.delay) / e.dur); // progression 0→1
        const a = 1 - p;
        const kill = e.kind === 'kill';
        const R = 3 + p * (kill ? SIZE * 0.55 : SIZE * 0.42);
        const col = lerpColor(0xffe23a, 0xd21f14, p); // jaune → rouge
        fxLayer.circle(e.x, e.y, R * 1.4).fill({ color: col, alpha: 0.2 * a });   // halo
        fxLayer.circle(e.x, e.y, R).fill({ color: col, alpha: 0.85 * a });        // boule de feu
        for (let i = 0; i < 7; i++) {                                             // éclats
          const ang = (i / 7) * Math.PI * 2 + p * 1.5;
          const c = Math.cos(ang), s = Math.sin(ang);
          fxLayer.moveTo(e.x + c * R * 0.4, e.y + s * R * 0.4)
            .lineTo(e.x + c * R * 1.5, e.y + s * R * 1.5)
            .stroke({ width: 2, color: col, alpha: 0.8 * a });
        }
        if (p < 0.35) fxLayer.circle(e.x, e.y, 4 + p * 8).fill({ color: 0xfff6cf, alpha: (0.35 - p) / 0.35 }); // flash blanc initial
        const sw = p * (kill ? SIZE : SIZE * 0.75);  // onde de choc : anneau fin plus rapide, s'estompe
        fxLayer.circle(e.x, e.y, sw).stroke({ width: 2 * a, color: 0xffd9a0, alpha: 0.6 * a });
      }
    }
    // Retournement de tuile (recto → verso) quand une unité est réduite : on
    // squash horizontalement le recto (1→0), on bascule sur le verso à mi-course,
    // puis on le déploie (0→1). Le verso est le pion déjà en place ; le recto est
    // un pion temporaire construit pour l'occasion.
    let flips = [];                                // { verso, recto, t, dur }
    function flipUnit(id) {
      const verso = counters.get(id), u = byId(id);
      if (!verso || verso.destroyed || !u) return;
      const recto = buildCounterSprite(u, false);
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
      const rad = SIZE * 0.5;                       // distance des foyers depuis le centre
      const dur = kind === 'kill' ? 520 : 420;
      [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6].forEach((ang, i) => { // 3 foyers à 120°
        fx.push({ x: x + Math.cos(ang) * rad, y: y + Math.sin(ang) * rad, kind, t: 0, delay: i * 90, dur });
      });
      startAnim();
    }
    const fxQueue = [];                            // positions collectées pendant resolveCombat, jouées à la fermeture de la modale
    let artyPreview = [];                          // appui d'artillerie du combat en aperçu { from, to } → flèches sur la carte

    // voisin axial d → arête correspondante de l'hexe flat-top (partagé plus bas).
    const DIR_TO_EDGE = [0, 5, 4, 3, 2, 1];
    const UPPER_EDGES = [3, 4, 5], LOWER_EDGES = [0, 1, 2];
    const strokeEdge = (g, c, e, color, alpha, width) => {
      const a = e * 2, b = ((e + 1) % 6) * 2;
      g.moveTo(c[a], c[a + 1]).lineTo(c[b], c[b + 1]).stroke({ width, color, alpha });
    };
    // Étagement d'altitude (palier par type de terrain) → teinte hypsométrique
    // et courbes de niveau, à la manière d'une carte topographique. Palette
    // sombre : vert foncé dans les bas-fonds → gris-vert → gris pierre en altitude.
    // Purement visuel : aucune règle ne dépend de ces valeurs.
    const ELEV = { river: 0, bank: 0, beach: 1, marsh: 1, wadi: 1, plain: 2, plain2: 2, desert: 2, dunes: 2, oasis: 2, snow: 2, forest: 2, road: 2, town: 2, village: 2, urban: 2, ruins: 2, base: 2, plateau: 3, rough: 3, hill: 4, mountain: 5 };
    const WATER_R = new Set(['river', 'bank']);
    const bandNoise = (q, r) => {                          // 0..1 déterministe, deux fréquences
      const a = Math.sin(q * 12.9898 + r * 78.233) * 43758.5453;
      const b = Math.sin(q * 39.3468 - r * 11.135) * 24634.6345;
      return (a - Math.floor(a)) * 0.6 + (b - Math.floor(b)) * 0.4;
    };
    const ELEV_RAMP = [[0, 0x2f3a2a], [0.3, 0x445040], [0.55, 0x666b5e], [0.78, 0x808079], [1, 0x9a9a95]];
    const elevColor = (a) => {
      a = Math.max(0, Math.min(1, a));
      for (let i = 1; i < ELEV_RAMP.length; i++) {
        if (a <= ELEV_RAMP[i][0]) {
          const [a0, c0] = ELEV_RAMP[i - 1], [a1, c1] = ELEV_RAMP[i];
          return lerpColor(c0, c1, (a - a0) / (a1 - a0));
        }
      }
      return ELEV_RAMP[ELEV_RAMP.length - 1][1];
    };
    // Altitude continue d'un hex (palier + bruit doux) normalisée sur [0, 1].
    const altAt = (q, r) => ((ELEV[state.terrain.get(key(q, r))] ?? 2) + (bandNoise(q, r) - 0.5) * 1.1) / 5;
    for (const { q, r } of state.hexes) {
      const { x, y } = axialToPixel(q, r);
      const type = state.terrain.get(key(q, r));
      const c = hexCorners(x, y);
      const tex = type === 'forest' ? forestTex[forestPick(q, r)] : terrainTex[type];
      if (tex) {                                        // tuile texturée : sprite flat-top
        const sp = new PIXI.Sprite(tex);
        sp.anchor.set(0.5);
        sp.position.set(x, y);
        sp.width = SIZE * 2; sp.height = SIZE * SQRT3;
        // Ombrage d'altitude sur la terre (l'eau garde sa teinte propre).
        if (type === 'plain' || type === 'plain2' || type === 'forest') sp.tint = lerpColor(0xffffff, elevColor(altAt(q, r)), 0.45);
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
      // Courbe de niveau : trait fin sur l'arête franchie entre deux paliers
      // d'altitude. Tracée du seul côté amont → un seul trait par frontière.
      if (!WATER_R.has(type)) {
        const cc = hexCorners(x, y);
        const myB = ELEV[type] ?? 2;
        for (let d = 0; d < 6; d++) {
          const nt = state.terrain.get(key(q + DIRS[d][0], r + DIRS[d][1]));
          if (!nt || WATER_R.has(nt)) continue;
          if (myB > (ELEV[nt] ?? 2)) strokeEdge(decoLayer, cc, DIR_TO_EDGE[d], 0x161c12, 0.4, 1.6);
        }
      }
      // Villes et villages : pas de marqueur statique ici — leur drapeau de
      // contrôle (drawFlag, dans l'overlay) fait office de repère.
      if (type === 'urban') {
        // zone urbaine : semis de petits bâtiments (bâti plus dense qu'un village).
        decoLayer.rect(x - 7, y - 6, 5, 5).fill(0x40414a).stroke({ width: 1, color: 0xc7c7cf });
        decoLayer.rect(x - 1, y - 7, 5, 5).fill(0x40414a).stroke({ width: 1, color: 0xc7c7cf });
        decoLayer.rect(x + 3, y + 1, 5, 5).fill(0x40414a).stroke({ width: 1, color: 0xc7c7cf });
        decoLayer.rect(x - 4, y + 2, 5, 5).fill(0x40414a).stroke({ width: 1, color: 0xc7c7cf });
      } else if (type === 'hill') {
        // coteau : deux bosses.
        decoLayer.poly([x - 9, y + 4, x - 3, y - 5, x + 3, y + 4]).fill(0x6e6c5e).stroke({ width: 1, color: 0xb0ac96 });
        decoLayer.poly([x + 1, y + 5, x + 6, y - 3, x + 10, y + 5]).fill(0x7b7869).stroke({ width: 1, color: 0xb0ac96 });
      } else if (type === 'mountain') {
        // montagne : pic marqué, versant éclairé et arête sommitale claire.
        decoLayer.poly([x - 11, y + 6, x, y - 9, x + 11, y + 6]).fill(0x6f6f77).stroke({ width: 1, color: 0xb9b9c2 });
        decoLayer.poly([x, y - 9, x + 5, y - 1, x - 1, y + 1]).fill(0x9a9aa2);
        decoLayer.moveTo(x - 3, y - 3).lineTo(x, y - 9).lineTo(x + 3, y - 3).stroke({ width: 1, color: 0xe6e6ec, alpha: 0.75 });
      } else if (type === 'marsh') {
        // marais : touffes de roseaux et flaques.
        decoLayer.moveTo(x - 7, y + 3).lineTo(x - 3, y + 3).stroke({ width: 1, color: 0x8fa07a, alpha: 0.7 });
        decoLayer.moveTo(x + 1, y - 1).lineTo(x + 6, y - 1).stroke({ width: 1, color: 0x8fa07a, alpha: 0.7 });
        decoLayer.moveTo(x - 2, y + 6).lineTo(x + 4, y + 6).stroke({ width: 1, color: 0x6f88b0, alpha: 0.6 });
      } else if (type === 'dunes') {
        // dunes : crêtes de sable ondulantes.
        decoLayer.moveTo(x - 8, y + 2).quadraticCurveTo(x - 3, y - 3, x + 1, y + 1).quadraticCurveTo(x + 5, y + 4, x + 9, y - 1).stroke({ width: 1, color: 0xe7d6a6, alpha: 0.8 });
        decoLayer.moveTo(x - 7, y + 6).quadraticCurveTo(x - 2, y + 2, x + 3, y + 6).stroke({ width: 1, color: 0xb59a5c, alpha: 0.7 });
      } else if (type === 'oasis') {
        // oasis : point d'eau cerné de palmes.
        decoLayer.circle(x, y + 2, 3).fill({ color: 0x4aa6c9 }).stroke({ width: 1, color: 0xcfeaf2 });
        for (const dx of [-6, 0, 6]) decoLayer.moveTo(x + dx, y - 1).lineTo(x + dx, y - 8).stroke({ width: 1, color: 0x2f7d47 });
      } else if (type === 'rough') {
        // rocaille : éclats de roche épars.
        decoLayer.poly([x - 8, y + 3, x - 5, y - 2, x - 2, y + 3]).fill(0x6f6a5e);
        decoLayer.poly([x + 1, y + 5, x + 5, y - 1, x + 9, y + 5]).fill(0x7d786a);
        decoLayer.circle(x - 1, y - 3, 1.6).fill(0x60594d);
      } else if (type === 'ruins') {
        // ruines : pans de murs brisés.
        decoLayer.rect(x - 8, y - 4, 4, 6).fill(0x5f5b57).stroke({ width: 1, color: 0x2f2c29 });
        decoLayer.rect(x - 1, y - 6, 4, 8).fill(0x6b6763).stroke({ width: 1, color: 0x2f2c29 });
        decoLayer.rect(x + 5, y - 1, 3, 4).fill(0x565350).stroke({ width: 1, color: 0x2f2c29 });
      } else if (type === 'wadi') {
        // oued : lit asséché sinueux.
        decoLayer.moveTo(x - 8, y - 2).quadraticCurveTo(x - 2, y + 3, x + 2, y - 1).quadraticCurveTo(x + 6, y - 4, x + 9, y + 1).stroke({ width: 2, color: 0x8a7846, alpha: 0.8 });
      } else if (type === 'river') {
        // rivière : rides.
        decoLayer.moveTo(x - 6, y - 3).quadraticCurveTo(x - 3, y - 5, x, y - 3).quadraticCurveTo(x + 3, y - 1, x + 6, y - 3).stroke({ width: 1, color: 0xaed3e2, alpha: 0.5 });
        decoLayer.moveTo(x - 6, y + 4).quadraticCurveTo(x - 3, y + 2, x, y + 4).quadraticCurveTo(x + 3, y + 6, x + 6, y + 4).stroke({ width: 1, color: 0xaed3e2, alpha: 0.5 });
      } else if (type === 'road') {
        // route : ruban reliant les voisins carrossables (route/ville/base). Tracé
        // en courbes passant par le centre → rendu organique plutôt qu'en segments droits.
        const mids = [];
        for (const [dq, dr] of DIRS) {
          const nt = state.terrain.get(key(q + dq, r + dr));
          if (nt === 'road' || nt === 'town' || nt === 'base') {
            const np = axialToPixel(q + dq, r + dr);
            mids.push({ x: (x + np.x) / 2, y: (y + np.y) / 2 });
          }
        }
        const RSTROKE = { width: 3, color: 0x8a7550 };
        const n = Math.sin(q * 127.1 + r * 311.7) * 43758.5453;
        const wig = (n - Math.floor(n) - 0.5) * 5;              // gigue déterministe par hex (±2.5px)
        if (mids.length === 0) {
          decoLayer.circle(x, y, 2.5).fill(0x8a7550);
        } else if (mids.length === 2) {
          // traversée : une seule courbe d'un bord à l'autre, incurvée via le centre.
          const [a, b] = mids;
          decoLayer.moveTo(a.x, a.y).quadraticCurveTo(x + wig, y - wig, b.x, b.y).stroke(RSTROKE);
        } else {
          // extrémité ou carrefour : une courbe du centre vers chaque bord relié.
          for (const m of mids) {
            const cx = (x + m.x) / 2 - (m.y - y) * 0.25, cy = (y + m.y) / 2 + (m.x - x) * 0.25;
            decoLayer.moveTo(x, y).quadraticCurveTo(cx, cy, m.x, m.y).stroke(RSTROKE);
          }
        }
      }
      // Rivage : arête entre eau et terre soulignée d'écume.
      if (type === 'river') {
        const c = hexCorners(x, y);
        for (let d = 0; d < 6; d++) {
          const nt = state.terrain.get(key(q + DIRS[d][0], r + DIRS[d][1]));
          if (nt && nt !== 'river') strokeEdge(decoLayer, c, DIR_TO_EDGE[d], 0xcde7ef, 0.6, 1.5);
        }
      }
    }
    // Camps de base : encadré + fanion à la couleur du camp.
    for (const s of ['blue', 'red']) {
      const [c, rw] = BASES[s];
      const { q, r } = offsetToAxial(c, rw);
      const { x, y } = axialToPixel(q, r);
      const col = FILL[s];
      decoLayer.rect(x - 9, y - 9, 18, 18).fill(0x241d10).stroke({ width: 2, color: col });
      decoLayer.rect(x - 1, y - 10, 2, 9).fill(col);
      decoLayer.poly([x + 1, y - 10, x + 8, y - 8, x + 1, y - 6]).fill(col);
    }

    // Aplatissement des couches statiques : le terrain vectoriel (mapLayer) et
    // les décors (decoLayer) ne changent JAMAIS après l'init → on les rasterise
    // chacun en une texture. Des milliers d'opérations de tracé (biseaux, courbes
    // de niveau, décors) deviennent un seul quad par rendu. Résolution 2 pour
    // rester net à un zoom modéré ; léger flou au zoom maximal (compromis assumé).
    mapLayer.cacheAsTexture({ resolution: 2, antialias: true });
    decoLayer.cacheAsTexture({ resolution: 2, antialias: true });

    // -- Filtre « stats » : heatmap de défense + chiffres PM/DÉF par hexe. -----
    // Le terrain est fixe sur la partie → couche construite une fois, simplement
    // montrée/masquée par le bouton STAT. Chaque hexe est teinté selon sa défense
    // (rouge = exposé → vert = bon abri) en SEMI-TRANSPARENT : la carte reste
    // lisible dessous. Les deux chiffres se lisent par-dessus (∞ = infranchissable).
    statsLayer.visible = false;
    const statLabel = (s, sz) => {
      const t = new PIXI.Text({ text: s, style: { fontFamily: 'Arial', fontSize: sz, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x0c0f08, width: 3 } } });
      t.anchor.set(0.5);
      return t;
    };
    // Échelle de défense −1..+3 → rouge → jaune → vert.
    const defColor = (d) => {
      const t = Math.max(0, Math.min(1, (d + 1) / 4));
      return t < 0.5 ? lerpColor(0xd23b2b, 0xd9c04a, t / 0.5) : lerpColor(0xd9c04a, 0x3f8f3a, (t - 0.5) / 0.5);
    };
    const statFill = new PIXI.Graphics();                 // teintes (une seule géométrie)
    for (const { q, r } of state.hexes) {
      const tp = TERRAIN[state.terrain.get(key(q, r))];
      if (!tp) continue;
      const { x, y } = axialToPixel(q, r);
      const impassable = tp.cost === Infinity;
      const cost = impassable ? '∞' : tp.cost;
      const def = tp.def > 0 ? `+${tp.def}` : `${tp.def}`;
      const col = impassable ? 0x2a3340 : defColor(tp.def); // infranchissable → ardoise neutre
      statFill.poly(hexCorners(x, y)).fill({ color: col, alpha: 0.5 }).stroke({ width: 1, color: 0x0c0f08, alpha: 0.35 });
      const pm = statLabel(`PM ${cost}`, 11); pm.position.set(x, y - 8);
      const df = statLabel(`DÉF ${def}`, 11); df.position.set(x, y + 9);
      statsLayer.addChild(pm, df);
    }
    statsLayer.addChildAt(statFill, 0);                    // teintes sous les chiffres

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
    };
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
      const ech = T(u.ech, 8); ech.position.set(0, -CS / 2 + 7);
      const nm = T(u.name, 9); nm.position.set(0, -CS / 2 + 17);
      // Facteurs de la FACE courante ; le ravitaillement modifie l'effectif au
      // combat mais pas le nombre imprimé.
      const fa = reduced ? u.ratk : u.atk, fd = reduced ? u.rdef : u.def, fm = reduced ? u.rmov : u.mov;
      const fac = T(`${fa}-${fd}-${fm}`, 10); fac.position.set(0, CS / 2 - 8);
      c.addChild(shadow, base, box, ech, nm, fac);
      if (reduced) {                                    // bande d'angle rouge = pion réduit
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
      return c;
    }
    function makeCounter(u) {
      const c = buildCounterSprite(u, u.reduced);
      counters.set(u.id, c);
      unitLayer.addChild(c);
      return c;
    }
    function rebuildCounters() {
      cancelFlips();                                    // annule un retournement en cours (réfs invalidées)
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
    let showStats = false;        // filtre : PM & défense de chaque hexe
    const attackers = new Set();  // ids des unités attaquantes       (phase combat)
    function clearPending() {
      pending = null;
      $('moveConfirm').style.display = 'none';
    }
    function clearSel() {
      sel = null;
      attackers.clear();
      artyPreview = [];
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
    // Flèche courbe (bézier quadratique) d'une pièce d'artillerie vers la cible :
    // indicateur, pendant l'aperçu du combat, que cette pièce appuie l'attaque.
    const drawArtyArrow = (from, to) => {
      const a0 = axialToPixel(from.q, from.r), a1 = axialToPixel(to.q, to.r);
      const dx = a1.x - a0.x, dy = a1.y - a0.y, len = Math.hypot(dx, dy) || 1;
      const off = Math.min(70, len * 0.32);            // décalage perpendiculaire → arc
      const cx = (a0.x + a1.x) / 2 - (dy / len) * off, cy = (a0.y + a1.y) / 2 + (dx / len) * off;
      const bez = (s) => { const u = 1 - s; return [u * u * a0.x + 2 * u * s * cx + s * s * a1.x, u * u * a0.y + 2 * u * s * cy + s * s * a1.y]; };
      const col = 0xffcf6a, N = 24, end = 0.86;         // s'arrête avant le centre pour ne pas masquer la cible
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

    // Peuplements tenus (villes + villages, relais de ravito) : précalculés une
    // fois pour le liseré de contrôle. Les objectifs, notion distincte, sont
    // dessinés à part (grand drapeau) et retirés d'ici pour éviter le doublon.
    const objSet = new Set(state.objectives);
    const settlementKeys = [...state.terrain]
      .filter(([k, t]) => (t === 'town' || t === 'village' || t === 'oasis') && !objSet.has(k))
      .map(([k]) => k);
    // Contrôle : couleurs vives de camp, gris atténué si neutre. La couleur
    // (bleu/rouge/gris) donne le contrôle ; la forme donne la nature.
    const FLAG_COL = { blue: 0x3f7fe0, red: 0xe0483a, neutral: 0xb8ad86 };
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
      overlay.ellipse(px, baseY, 3.5, 2).fill({ color: 0x1c1810, alpha: 0.45 });               // socle au sol
      overlay.moveTo(px, baseY).lineTo(px, topY).stroke({ width: 1.8, color: 0x2a2418, alpha: 0.95 }); // mât
      const w = 12, h = 9;                                                                      // petit fanion triangulaire
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
      // d'où le tracé ici plutôt que dans le decoLayer statique.
      for (const k of state.objectives) drawObjective(k);          // objectifs de victoire (médaille)
      for (const k of settlementKeys) drawFlag(k);                 // peuplements (fanion de ravito)
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
        for (const { from, to } of artyPreview) drawArtyArrow(from, to); // appui d'artillerie du combat en aperçu
      }
    }

    function handleClick(p) {
      if (state.G.over || !myTurn()) return;
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
      const id = sel.unit.id, to = pending.key;
      moveUnit(sel.unit, to, sel.dist, sel.eZOC);
      netSend({ t: 'move', id, to });
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
    // Attaquants retenus pour une cible en (q,r) : sélection explicite adjacente
    // et libre, sinon tous les amis adjacents libres. Partagé par le clic et le
    // survol (aperçu de l'appui d'artillerie).
    function attackersFor(q, r) {
      let atkUnits = [...attackers].map((id) => byId(id)).filter(Boolean)
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
      const same = next.length === artyPreview.length
        && next.every((n, i) => n.from.q === artyPreview[i].from.q && n.from.r === artyPreview[i].from.r);
      if (!same) { artyPreview = next; drawOverlay(); draw(); }
    }
    function handleCombat(q, r) {
      const stack = unitsAt(state.units, q, r);
      if (!stack.length) {
        attackers.clear();
        return;
      }
      const top = stack[stack.length - 1];
      if (top.side !== state.G.player) {                    // clic ennemi → résoudre
        const atkUnits = attackersFor(q, r);
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
      if (state.G.over || (ptr && ptr.moved)) { hoverKey = null; hideHexTooltip(); setArtyHover(null); return; }
      const p = world.toLocal(e.global);
      const { q, r } = pixelToAxial(p.x, p.y);
      const k = key(q, r);
      hoverPos = { x: e.global.x, y: e.global.y };
      if (!state.terrain.has(k)) { hoverKey = null; hideHexTooltip(); setArtyHover(null); return; }
      if (k === hoverKey) return;              // même hexe : laisser le minuteur courir
      hoverKey = k;
      setArtyHover(q, r);                      // aperçu de l'appui d'artillerie sur la cible survolée
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
      if (!state.G.over && state.G.phase === 'move' && myTurn()) {
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
          const id = sel.unit.id;
          moveUnit(sel.unit, k, sel.dist, sel.eZOC);
          netSend({ t: 'move', id, to: k });
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
    const zoomIn = () => zoomAt(1.2, app.screen.width / 2, app.screen.height / 2);
    const zoomOut = () => zoomAt(0.83, app.screen.width / 2, app.screen.height / 2);
    document.getElementById('btnIn').onclick = zoomIn;
    document.getElementById('btnOut').onclick = zoomOut;
    document.getElementById('btnReset').onclick = fitView;
    // Zoom au clavier : + (ou =) pour agrandir, - pour réduire, centré sur l'écran.
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      else if (e.key === '-') { e.preventDefault(); zoomOut(); }
    });
    const btnSupply = document.getElementById('btnSupply');
    btnSupply.classList.toggle('on', showSupply);
    btnSupply.onclick = () => {
      showSupply = !showSupply;
      btnSupply.classList.toggle('on', showSupply);
      drawOverlay();
      draw();
    };
    const btnStats = document.getElementById('btnStats');
    btnStats.classList.toggle('on', showStats);
    btnStats.onclick = () => {
      showStats = !showStats;
      btnStats.classList.toggle('on', showStats);
      statsLayer.visible = showStats;
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
    document.getElementById('btnPhase').onclick = () => {
      if (!myTurn()) return;
      netSend({ t: 'phase' });
      endPhase(state);
    };

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
        : `Clique tes unités adjacentes à l'ennemi pour désigner les attaquants (vert), puis l'unité ennemie à assaillir (rouge). Blindé + infanterie et artillerie à portée (≤${ARTY_RANGE} hex) décalent la table en ta faveur.`;
      $('btnPhase').textContent = state.G.phase === 'move' ? 'Passer au combat ▸'
        : state.G.player === 'blue' ? 'Fin de tour Bleu → Rouge ▸' : `Fin du tour ${state.G.turn} ▸`;

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
        + `<span><b>${objCount(state, 'blue')}</b> ${sideLabel('blue')} · <b>${objCount(state, 'red')}</b> ${sideLabel('red')} · ${state.objectives.length} au total</span></div>`
        + `<div class="sub">Le camp contrôlant le plus d'objectifs au tour ${MAX_TURNS} l'emporte.</div>`;
      if (isOnline) {
        const mine = myTurn();
        $('btnPhase').disabled = !mine;
        if (netLost) $('hint').textContent = 'Connexion perdue.';
        else if (!mine) $('hint').innerHTML = `⏳ Tour de l'adversaire — <b>${sideLabel(state.G.player)}</b>. Patiente…`;
      } else if (isAI) {
        const mine = myTurn();
        $('btnPhase').disabled = !mine;
        if (!mine) $('hint').innerHTML = `🤖 Tour de l'IA — <b>${sideLabel(aiSide)}</b> réfléchit…`;
      }
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
    function showCombatPreview(atkUnits, defender, spectator = false) {
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
      $('combatBtns').style.display = spectator ? 'none' : 'flex';   // spectateur : pas de décision, on regarde le dé
      if (spectator) pendingCombat = null;
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
    function closeCombat() {
      clearCombatTimers();
      $('combatModal').style.display = 'none';
      refresh();                                           // le plateau ne reflète pertes/reculs qu'à la fermeture
      fxQueue.splice(0).forEach(({ q, r, kind, id }) => {  // effets une fois la modale fermée
        spawnFx(q, r, kind);
        if (kind === 'hit') flipUnit(id);                  // unité réduite : on retourne sa tuile
      });
    }
    $('combatBtn').onclick = closeCombat;
    $('btnRollCombat').onclick = () => {
      if (!pendingCombat) return;
      const { atkUnits, defender } = pendingCombat;
      pendingCombat = null;
      artyPreview = [];                                     // le combat s'engage : plus d'aperçu
      $('combatBtns').style.display = 'none';
      netSend({ t: 'combat', atk: atkUnits.map((u) => u.id), def: defender.id });
      fxQueue.length = 0;
      resolveCombat(state, atkUnits, defender);             // → combatResolved → runRoll (anime la colonne)
      attackers.clear();
      // le plateau n'est synchronisé qu'à la fermeture (closeCombat) : pas de spoiler pendant l'animation du dé
      if (state.G.over) { $('combatModal').style.display = 'none'; refresh(); } // le bandeau de victoire prend le relais
    };
    $('btnRefuseCombat').onclick = () => {
      pendingCombat = null;
      artyPreview = [];
      $('combatModal').style.display = 'none';
      drawOverlay();
      draw();
      log('Combat refusé.');
    };

    // -- Abonnements au bus : le rendu réagit aux événements des règles -------
    state.bus.on('log', log);
    // Effets de combat : on mémorise la position touchée ; l'animation est jouée
    // à la révélation du dé (revealAfterRoll), synchronisée avec le résultat.
    state.bus.on('unitReduced', (u) => fxQueue.push({ q: u.q, r: u.r, kind: 'hit', id: u.id }));
    state.bus.on('unitRemoved', (u) => fxQueue.push({ q: u.q, r: u.r, kind: 'kill' }));
    state.bus.on('combatResolved', runRoll);
    state.bus.on('phaseChanged', () => {
      clearSel();
      refresh();
      maybeRunAI();                                        // enchaîne le tour de l'IA si c'est à elle
    });
    // Récap de fin : score, objectifs tenus et pertes (éliminés + réduits) par camp.
    const buildRecap = (winner) => {
      const rows = ['blue', 'red'].map((s) => {
        const alive = state.units.filter((u) => u.side === s);
        const eliminated = state.initialCount[s] - alive.length;
        const reduced = alive.filter((u) => u.reduced).length;
        const cls = s === winner ? ` class="winner"` : '';
        return `<tr${cls}><td class="side ${s}">${sideLabel(s)}</td>`
          + `<td>${victoryScore(state, s)}</td><td>${objCount(state, s)}</td>`
          + `<td>${eliminated}</td><td>${reduced}</td></tr>`;
      }).join('');
      return `<table><thead><tr><th>Camp</th><th>Score</th><th>Objectifs</th><th>Éliminés</th><th>Réduits</th></tr></thead>`
        + `<tbody>${rows}</tbody></table>`;
    };

    state.bus.on('gameOver', ({ side, reason }) => {
      clearSel();
      drawOverlay();
      draw();
      $('bannerTitle').textContent = `Victoire du camp ${sideLabel(side)}`;
      $('bannerSub').textContent = reason;
      $('bannerRecap').innerHTML = buildRecap(side);
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

    // Rejoue le combat de l'adversaire pour que le spectateur voie le même dé :
    // le RNG semé garantit un résultat identique côté distant.
    function remoteCombat(atkUnits, defender) {
      showCombatPreview(atkUnits, defender, true);
      fxQueue.length = 0;
      resolveCombat(state, atkUnits, defender);           // → combatResolved → runRoll (anime la colonne)
      attackers.clear();
      // synchro du plateau différée à closeCombat pour ne rien dévoiler avant la fin du dé
      if (state.G.over) { $('combatModal').style.display = 'none'; refresh(); }
    }

    // -- Pilote de l'IA (solo) : rejoue les intentions du planificateur pur
    // (src/ai.js) via le MÊME chemin que le mode en ligne, avec des pauses pour
    // rester lisible. Le planificateur ne mute jamais l'état ; c'est ici qu'on
    // applique moves/combats sur l'état réel et qu'on anime.
    const AI_MOVE_MS = 420, AI_STEP_MS = 360, AI_COMBAT_MS = 2200;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    let aiRunning = false;
    async function runAiTurn() {
      if (aiRunning) return;
      aiRunning = true;
      try {
        for (const m of aiMovePhase(state, aiSide)) {       // phase de mouvement
          if (state.G.over) return;
          const u = byId(m.id);
          if (!u) continue;
          const { dist, eZOC } = computeReachable(state, u);
          if (!dist[m.to]) continue;                        // destination devenue invalide
          moveUnit(u, m.to, dist, eZOC);
          refresh();
          await wait(AI_MOVE_MS);
        }
        if (state.G.over) return;
        endPhase(state);                                    // mouvement → combat
        await wait(AI_STEP_MS);
        for (const a of aiAttackPhase(state, aiSide)) {     // phase de combat
          if (state.G.over) return;
          const atk = a.atk.map(byId).filter(Boolean), def = byId(a.def);
          if (!atk.length || !def) continue;
          remoteCombat(atk, def);
          await wait(AI_COMBAT_MS);
          closeCombat();                                    // ferme la modale + joue explosions/flips
          await wait(AI_STEP_MS);
        }
        if (state.G.over) return;
        endPhase(state);                                    // combat → tour du joueur humain
      } finally {
        aiRunning = false;
      }
    }
    const maybeRunAI = () => {
      if (isAI && !state.G.over && !aiRunning && state.G.player === aiSide && state.G.phase === 'move') runAiTurn();
    };
    // Applique une action distante en rejouant EXACTEMENT le même code de règle
    // que l'auteur (déplacement recalculé, dé reproduit) : aucun état n'est
    // transmis, seulement l'intention.
    if (isOnline) {
      onGameMsg = (m) => {
        if (netLost) return;
        if (m.t === 'move') {
          const u = byId(m.id);
          if (u) { const { dist, eZOC } = computeReachable(state, u); moveUnit(u, m.to, dist, eZOC); }
          clearSel();
          refresh();
        } else if (m.t === 'combat') {
          const atk = m.atk.map(byId).filter(Boolean);
          const def = byId(m.def);
          if (atk.length && def) remoteCombat(atk, def);
        } else if (m.t === 'phase') {
          endPhase(state);                                 // phaseChanged → clearSel + refresh (bus)
        }
      };
      netQueue.splice(0).forEach(onGameMsg);               // vide les messages arrivés pendant l'init
    }

    fitView();
    refresh();
    log(isOnline
      ? `Partie en ligne prête — tu joues ${sideLabel(localSide)}. ${localSide === 'blue' ? 'À toi de jouer.' : "Au tour de l'adversaire."}`
      : isAI
        ? `Partie contre l'IA — tu joues ${sideLabel(other(aiSide))}. À toi de jouer.`
        : 'Partie prête — tour 1, phase de mouvement du camp Bleu.');
    maybeRunAI();                                          // au cas où l'IA ouvre la partie
  } catch (err) {
    const el = document.getElementById('err');
    el.style.display = 'block';
    el.textContent = "Erreur d'initialisation :\n" + (err && err.stack ? err.stack : err);
  }
})();
