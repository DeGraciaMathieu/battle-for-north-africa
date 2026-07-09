// ===========================================================================
//  Pilotes d'adversaire : rejouent des INTENTIONS via le même chemin de règles
//  que le joueur local — jamais d'état transmis, pour rester en lockstep.
//  - IA (solo) : applique les intentions du planificateur pur (src/ai.js) avec
//    des pauses et un projecteur caméra pour rester lisible.
//  - Réseau : applique les actions du joueur distant (déplacement recalculé,
//    dé reproduit par le RNG semé).
// ===========================================================================

import { key } from '../src/geometry.js';
import { computeReachable, moveUnit } from '../src/movement.js';
import { endPhase } from '../src/game.js';
import { aiMovePhase, aiAttackPhase } from '../src/ai.js';

export function createDrivers({ state, stage, ui, session, hud, overlay, combatModal }) {
  const byId = (id) => state.units.find((u) => u.id === id);

  // -- Pilote de l'IA (solo) : le planificateur ne mute jamais l'état ; c'est
  // ici qu'on applique moves/combats sur l'état réel et qu'on anime.
  const AI_MOVE_MS = 420, AI_STEP_MS = 360, AI_COMBAT_MS = 2200;
  const AI_AIM_MS = 850, AI_IMPACT_MS = 1300; // pauses pour situer le combat puis voir l'impact
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  let aiRunning = false;
  async function runAiTurn() {
    if (aiRunning) return;
    aiRunning = true;
    try {
      for (const m of aiMovePhase(state, session.aiSide)) { // phase de mouvement
        if (state.G.over) return;
        const u = byId(m.id);
        if (!u) continue;
        const { dist, eZOC } = computeReachable(state, u);
        if (!dist[m.to]) continue; // destination devenue invalide
        moveUnit(u, m.to, dist, eZOC);
        hud.refresh();
        await wait(AI_MOVE_MS);
      }
      if (state.G.over) return;
      endPhase(state); // mouvement → combat
      await wait(AI_STEP_MS);
      for (const a of aiAttackPhase(state, session.aiSide)) { // phase de combat
        if (state.G.over) return;
        const atk = a.atk.map(byId).filter(Boolean), def = byId(a.def);
        if (!atk.length || !def) continue;
        ui.combatSpotlight = { atk: new Set(atk.map((u) => key(u.q, u.r))), def: key(def.q, def.r) };
        overlay.drawOverlay(); stage.draw(); // marque attaquants/défenseur
        await stage.panToHex(def.q, def.r); // amène le combat au centre de l'écran
        await wait(AI_AIM_MS); // laisse le temps de voir OÙ ça se joue
        if (state.G.over) return; // le finally nettoie le projecteur
        combatModal.remoteCombat(atk, def);
        await wait(AI_COMBAT_MS);
        combatModal.closeCombat(); // ferme la modale + joue explosions/flips (au centre)
        await wait(AI_IMPACT_MS); // laisse le temps de voir l'impact
        ui.combatSpotlight = null;
        overlay.drawOverlay(); stage.draw();
        await wait(AI_STEP_MS);
      }
      if (state.G.over) return;
      endPhase(state); // combat → tour du joueur humain
    } finally {
      aiRunning = false;
      if (ui.combatSpotlight) { ui.combatSpotlight = null; overlay.drawOverlay(); stage.draw(); }
    }
  }
  const maybeRunAI = () => {
    if (session.isAI && !state.G.over && !aiRunning && state.G.player === session.aiSide && state.G.phase === 'move') runAiTurn();
  };

  // -- Réseau : applique une action distante en rejouant EXACTEMENT le même
  // code de règle que l'auteur. À brancher une fois le bus câblé (attachNet) :
  // les messages différés rejoués peuvent émettre des événements de règle.
  function attachNet() {
    if (!session.isOnline) return;
    session.setGameMessageHandler((m) => {
      if (session.netLost) return;
      if (m.t === 'move') {
        const u = byId(m.id);
        if (u) { const { dist, eZOC } = computeReachable(state, u); moveUnit(u, m.to, dist, eZOC); }
        ui.clearSel();
        hud.refresh();
      } else if (m.t === 'combat') {
        const atk = m.atk.map(byId).filter(Boolean);
        const def = byId(m.def);
        if (atk.length && def) combatModal.remoteCombat(atk, def);
      } else if (m.t === 'phase') {
        endPhase(state); // phaseChanged → clearSel + refresh (bus)
      }
    });
  }

  return { maybeRunAI, attachNet };
}
