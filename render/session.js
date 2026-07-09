// ===========================================================================
//  Session de partie : paramètres d'URL, lobby réseau et résolution du
//  descriptif — seed, carte, armées, RNG — de sorte que host et guest
//  construisent un état STRICTEMENT identique. Seul le DOM d'avant-partie
//  (lobby, seed affichée) est manipulé ici ; aucun rendu de jeu.
// ===========================================================================

import { CATALOG_ORDER } from '../src/config.js';
import { loadMap } from '../src/map.js';
import { mulberry32, makeCode, createHost, joinHost } from './net.js';

const gid = (x) => document.getElementById(x);

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

// -- Lobby réseau : mise en relation P2P avant le début de partie ------------
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

// Résout la partie selon le rôle réseau : host/solo lisent l'URL ; le guest
// reçoit tout le descriptif de l'hôte. Renvoie l'objet session consommé par
// app.js (rôle, seed/carte/armées, RNG, envoi réseau, verrou de liaison).
export async function createSession() {
  const params = new URLSearchParams(location.search);
  const netRole = params.get('net'); // 'host' | 'guest' | null (solo)
  const isOnline = netRole === 'host' || netRole === 'guest';
  const aiParam = params.get('ai'); // 'blue' | 'red' : camp joué par l'IA (solo uniquement)
  const aiSide = !isOnline && (aiParam === 'blue' || aiParam === 'red') ? aiParam : null;

  let net = null, started = false, isGameOver = () => false;
  const netQueue = []; // messages de jeu reçus avant la fin de l'init (différés)
  let onGameMsg = null;

  const session = {
    isOnline,
    isAI: aiSide !== null,
    aiSide,
    localSide: null,
    netLost: false,
    seed: 0, fair: false, biome: null, mapParam: null, mapData: null,
    composition: undefined, rng: null,
    send(m) { if (net) net.send(m); },
    // À appeler une fois l'état de jeu créé : la perte de liaison peut alors
    // distinguer partie en cours / partie terminée.
    start(hooks) { started = true; isGameOver = hooks.isGameOver; },
    // Branche le handler des actions distantes et rejoue les messages différés.
    setGameMessageHandler(fn) {
      onGameMsg = fn;
      netQueue.splice(0).forEach(fn);
    },
  };

  const onPeerLost = () => {
    if (!started) { lobbyError('Connexion interrompue', 'La liaison avec l\'adversaire a échoué.'); return; }
    if (!isGameOver()) { session.netLost = true; lobbyError('Connexion perdue', 'Ton adversaire a quitté la partie.'); }
  };

  if (netRole === 'guest') {
    session.localSide = 'red';
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
    session.seed = desc.seed; session.fair = desc.fair;
    session.biome = desc.biome || null; session.mapParam = desc.mapParam || null;
    session.composition = desc.b && desc.r ? { blue: parseArmy(desc.b), red: parseArmy(desc.r) } : undefined;
    session.mapData = await loadMapData(session.mapParam);
    session.rng = mulberry32(desc.rngSeed);
    hideLobby();
  } else {
    const seedParam = params.get('seed');
    session.seed = seedParam !== null && /^\d+$/.test(seedParam) ? Number(seedParam) : Math.floor(Math.random() * 0xffffffff);
    session.fair = params.get('gen') === 'fair';
    session.biome = params.get('biome') || null;
    session.mapParam = params.get('map');
    session.mapData = await loadMapData(session.mapParam);
    const b = params.get('b'), r = params.get('r');
    session.composition = b && r ? { blue: parseArmy(b), red: parseArmy(r) } : undefined;
    if (netRole === 'host') {
      session.localSide = 'blue';
      const rngSeed = Math.floor(Math.random() * 0xffffffff);
      session.rng = mulberry32(rngSeed);
      const code = makeCode();
      await new Promise((resolve, reject) => {
        showLobby('host', code);
        net = createHost(code, {
          onReady: () => setLobbyStatus('En attente de connexion…'),
          onConnect: () => setLobbyStatus('Adversaire connecté — synchronisation…'),
          onData: (m) => {
            if (onGameMsg) return onGameMsg(m);
            if (m.t === 'hello') {
              net.send({ t: 'desc', seed: session.seed, fair: session.fair, biome: session.biome || null, mapParam: session.mapParam || null, b, r, rngSeed });
              resolve();
            } else netQueue.push(m);
          },
          onClose: onPeerLost,
          onError: () => reject(new Error('Impossible de créer la partie en ligne.')),
        });
      });
      hideLobby();
    } else {
      session.rng = Math.random; // solo : aléa navigateur classique
    }
  }

  // Seed affichée + poussée dans l'URL pour pouvoir repartager la carte courante.
  gid('seedVal').textContent = session.mapData ? session.mapParam : session.seed;
  if (!isOnline) {
    const q = new URLSearchParams();
    if (session.mapData) q.set('map', session.mapParam);
    else { q.set('seed', String(session.seed)); if (session.fair) q.set('gen', 'fair'); if (session.biome && session.biome !== 'tempere') q.set('biome', session.biome); }
    if (session.composition) { q.set('b', params.get('b')); q.set('r', params.get('r')); }
    if (session.isAI) q.set('ai', aiSide);
    history.replaceState(null, '', `?${q.toString()}`);
  }
  return session;
}
