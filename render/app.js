// ===========================================================================
//  Point d'entrée de la couche rendu & interaction (PixiJS v8 + HUD DOM).
//  Assemble la session (URL/réseau), la scène et les modules d'affichage et
//  d'interaction, câble le bus des règles au rendu, puis lance la partie.
//  N'importe QUE des règles pures depuis ../src ; aucune règle de jeu ici.
// ===========================================================================

import { createGame } from '../src/game.js';
import { other } from '../src/units.js';
import { createSession } from './session.js';
import { createStage } from './stage.js';
import { buildBoard } from './board.js';
import { createUiState } from './uiState.js';
import { createCounters } from './counters.js';
import { createFx } from './fx.js';
import { createOverlay } from './overlay.js';
import { createHud } from './hud.js';
import { createCombatModal } from './combatModal.js';
import { createStackFan } from './stackFan.js';
import { createInput } from './input.js';
import { createDrivers } from './drivers.js';
import { audio } from './audio.js';
import { sideLabel } from './html.js';

(async () => {
  try {
    const session = await createSession();
    const state = createGame(session.rng, session.seed, session.composition,
      session.mapData ?? undefined,
      session.mapData ? undefined : { fair: session.fair, biome: session.biome });
    session.start({ isGameOver: () => state.G.over });

    // Verrou de tour : hors ligne (sans IA) on joue les deux camps ; en ligne on
    // n'agit que pendant son propre camp ; contre l'IA on n'agit pas quand c'est
    // au camp de l'IA de jouer.
    const myTurn = () => session.isOnline
      ? (!session.netLost && state.G.player === session.localSide)
      : session.isAI ? state.G.player !== session.aiSide : true;

    if (session.isOnline || session.isAI) {
      const nb = document.getElementById('netbar');
      nb.style.display = '';
      nb.innerHTML = session.isOnline
        ? `🌐 En ligne — tu joues <b>${sideLabel(session.localSide)}</b>`
        : `🤖 Contre l'IA — tu joues <b>${sideLabel(other(session.aiSide))}</b>`;
    }

    const stage = await createStage();
    await buildBoard(state, stage);
    const ui = createUiState();
    const counters = createCounters(state, stage);
    const fx = createFx(state, stage, counters);
    const overlay = await createOverlay(state, stage, ui);
    const hud = createHud({ state, stage, ui, session, myTurn, counters, overlay, audio });
    const combatModal = createCombatModal({ state, stage, ui, session, fx, hud, overlay });
    const stackFan = createStackFan({ state, stage, ui, session, myTurn, counters, hud });
    createInput({ state, stage, ui, session, myTurn, hud, overlay, combatModal, counters, stackFan });
    const drivers = createDrivers({ state, stage, ui, session, hud, overlay, combatModal });

    // La vue a bougé (zoom, pan, resize) : repositionne les bulles ancrées.
    stage.onViewChanged(() => {
      if (ui.pending) hud.positionMoveTooltip();
      if (ui.pendingAdvance) hud.positionAdvanceTooltip();
    });

    // -- Abonnements au bus : le rendu réagit aux événements des règles -------
    state.bus.on('log', hud.log);
    // Effets de combat : on mémorise la position touchée ; l'animation est jouée
    // à la fermeture de la modale, synchronisée avec le résultat du dé.
    state.bus.on('unitReduced', (u) => fx.fxQueue.push({ q: u.q, r: u.r, kind: 'hit', id: u.id }));
    state.bus.on('unitRemoved', (u) => fx.fxQueue.push({ q: u.q, r: u.r, kind: 'kill' }));
    state.bus.on('combatResolved', (summary) => { audio.dice(); combatModal.runRoll(summary); });
    state.bus.on('phaseChanged', () => {
      audio.endTurn();
      stackFan.close();
      ui.clearSel();
      hud.refresh();
      drivers.maybeRunAI(); // enchaîne le tour de l'IA si c'est à elle
    });
    state.bus.on('gameOver', ({ side, reason }) => {
      audio.capture(); // flourish de victoire (réutilise le carillon de capture)
      stackFan.close();
      ui.clearSel();
      overlay.drawOverlay();
      stage.draw();
      hud.showGameOver(side, reason);
    });

    drivers.attachNet(); // branche le rejeu distant et vide les messages différés
    stage.fitView();
    hud.refresh();
    hud.log(session.isOnline
      ? `Partie en ligne prête — tu joues ${sideLabel(session.localSide)}. ${session.localSide === 'blue' ? 'À toi de jouer.' : "Au tour de l'adversaire."}`
      : session.isAI
        ? `Partie contre l'IA — tu joues ${sideLabel(other(session.aiSide))}. À toi de jouer.`
        : 'Partie prête — tour 1, phase de mouvement du camp Bleu.');
    drivers.maybeRunAI(); // au cas où l'IA ouvre la partie
  } catch (err) {
    const el = document.getElementById('err');
    el.style.display = 'block';
    el.textContent = "Erreur d'initialisation :\n" + (err && err.stack ? err.stack : err);
  }
})();
