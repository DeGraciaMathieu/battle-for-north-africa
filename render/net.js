// ===========================================================================
//  Couche transport P2P (PeerJS / WebRTC) — mode deux joueurs en ligne.
//
//  Elle N'IMPORTE AUCUNE règle de jeu et ne mute JAMAIS l'état : elle ne fait
//  que transporter des messages sérialisés entre les deux navigateurs. Le broker
//  public PeerJS assure uniquement la mise en relation (signaling) ; les données
//  de partie transitent en pair-à-pair via un DataChannel WebRTC fiable et
//  ordonné — condition du lockstep déterministe.
//
//  Principe du lockstep : les deux clients créent une partie identique (même
//  seed, mêmes armées, même RNG semé) et ne s'échangent que l'INTENTION des
//  actions (déplacement / combat / fin de phase). Le seul aléa du moteur est le
//  dé de combat, tiré via `state.rng` : semé à l'identique, il donne le même
//  résultat des deux côtés sans avoir à transmettre l'issue.
// ===========================================================================

// PRNG déterministe (mulberry32) : reproductible d'un client à l'autre.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Espace de noms pour éviter les collisions d'ID sur le broker public partagé.
const PREFIX = 'bfna-';

// Code d'invitation court et lisible (sans I/O/0/1 ambigus). L'aléa ici ne
// concerne pas les règles → Math.random convient.
export function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

// Côté hôte : réserve l'ID `PREFIX+code` sur le broker et attend une connexion.
// `handlers` : { onReady(code), onConnect(), onData(msg), onClose(), onError(e) }.
export function createHost(code, handlers) {
  const peer = new window.Peer(PREFIX + code);
  let conn = null;
  peer.on('open', () => handlers.onReady?.(code));
  peer.on('error', (e) => handlers.onError?.(e));
  peer.on('connection', (c) => {
    if (conn) { c.close(); return; }            // une seule connexion (partie 1 v 1)
    conn = c;
    c.on('open', () => handlers.onConnect?.());
    c.on('data', (d) => handlers.onData?.(d));
    c.on('close', () => handlers.onClose?.());
    c.on('error', (e) => handlers.onError?.(e));
  });
  return {
    send: (m) => { if (conn && conn.open) conn.send(m); },
    close: () => { conn?.close(); peer.destroy(); },
  };
}

// Côté invité : rejoint l'hôte identifié par `code`.
export function joinHost(code, handlers) {
  const peer = new window.Peer();
  let conn = null;
  peer.on('open', () => {
    conn = peer.connect(PREFIX + code, { reliable: true });
    conn.on('open', () => handlers.onConnect?.());
    conn.on('data', (d) => handlers.onData?.(d));
    conn.on('close', () => handlers.onClose?.());
    conn.on('error', (e) => handlers.onError?.(e));
  });
  peer.on('error', (e) => handlers.onError?.(e));
  return {
    send: (m) => { if (conn && conn.open) conn.send(m); },
    close: () => { conn?.close(); peer.destroy(); },
  };
}
