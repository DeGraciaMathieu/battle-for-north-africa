// ===========================================================================
//  Effets sonores synthétisés (Web Audio API) — AUCUN fichier son livré. Le son
//  est généré à la volée, dans l'esprit « no build / zéro dépendance » du
//  projet. Couche de rendu pure : branché sur les événements du jeu par app.js,
//  fx, input et drivers ; ne touche JAMAIS aux règles (l'aléa audio n'affecte
//  pas l'état — Math.random est donc admis ici).
// ===========================================================================

let AC = null, master = null, enabled = true;

// L'AudioContext ne peut naître qu'après une interaction (politique navigateur) :
// on le crée paresseusement au premier son joué pendant un geste utilisateur.
function ensure() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  AC = new Ctx();
  master = AC.createGain();
  master.gain.value = 0.7;
  master.connect(AC.destination);
}

// Ton enveloppé (attaque/déclin exponentiel) ; glideTo = glissando de hauteur.
function tone({ freq, type = 'sine', dur = 0.2, attack = 0.005, gain = 0.3, glideTo = null, delay = 0 }) {
  const t0 = AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

// Salve de bruit filtrée (percussion, ticks, souffle).
function noise({ dur = 0.12, gain = 0.3, type = 'highpass', freq = 1000, q = 0.7, delay = 0 }) {
  const t0 = AC.currentTime + delay;
  const n = Math.floor(AC.sampleRate * dur);
  const buf = AC.createBuffer(1, n, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = AC.createBufferSource(); src.buffer = buf;
  const f = AC.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = AC.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

const play = (fn) => { if (!enabled) return; ensure(); if (AC) fn(); };

let prevCtrl = null; // instantané du contrôle des objectifs (détection de capture)

export const audio = {
  move() { play(() => noise({ dur: 0.05, gain: 0.14, type: 'highpass', freq: 1400 })); },
  place() {
    play(() => {
      noise({ dur: 0.04, gain: 0.3, type: 'highpass', freq: 1800 });
      tone({ freq: 150, type: 'triangle', dur: 0.09, gain: 0.22, glideTo: 90 });
    });
  },
  dice() {
    play(() => {
      let t = 0;
      for (let i = 0; i < 7; i++) {
        noise({ dur: 0.03, gain: 0.18, type: 'bandpass', freq: 2200 + Math.random() * 1200, q: 2, delay: t });
        t += 0.05 + i * 0.012;
      }
      tone({ freq: 220, type: 'triangle', dur: 0.1, gain: 0.2, glideTo: 160, delay: t });
      noise({ dur: 0.05, gain: 0.22, type: 'highpass', freq: 1600, delay: t });
    });
  },
  combat() {
    play(() => {
      tone({ freq: 120, type: 'triangle', dur: 0.28, gain: 0.4, glideTo: 55 });
      noise({ dur: 0.18, gain: 0.28, type: 'lowpass', freq: 900, q: 0.6 });
    });
  },
  capture() {
    play(() => [523.25, 659.25, 783.99].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.4, gain: 0.28, attack: 0.008, delay: i * 0.1 })));
  },
  endTurn() {
    play(() => {
      tone({ freq: 330, type: 'triangle', dur: 0.16, gain: 0.3, glideTo: 300 });
      tone({ freq: 220, type: 'sine', dur: 0.22, gain: 0.22, delay: 0.12 });
    });
  },
  // Capture d'objectif détectée côté rendu (diff de objControl) : évite de
  // toucher aux règles — updateObjectives tourne aussi dans la simulation IA,
  // qui partage le bus réel. Le premier appel ne fait qu'initialiser l'instantané.
  checkCaptures(state) {
    const cur = new Map();
    for (const k of state.objectives) cur.set(k, state.objControl.get(k) ?? null);
    if (prevCtrl) {
      for (const [k, side] of cur) {
        if (side && side !== (prevCtrl.get(k) ?? null)) { audio.capture(); break; }
      }
    }
    prevCtrl = cur;
  },
  setEnabled(v) { enabled = v; if (v) ensure(); },
  isEnabled: () => enabled,
  unlock() { ensure(); },
};
