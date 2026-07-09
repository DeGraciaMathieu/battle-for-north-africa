// ===========================================================================
//  État d'interaction partagé entre les modules de rendu : sélection courante,
//  déplacement en attente, attaquants désignés, bascules d'affichage. Objet
//  mutable unique — input/drivers l'écrivent, overlay/hud l'affichent.
// ===========================================================================

export function createUiState() {
  const ui = {
    sel: null, // { unit, reachable, dist, eZOC }  (phase mouvement)
    pending: null, // { key, q, r, hasOwn } — déplacement en attente de confirmation
    dragOverKey: null, // hexe survolé pendant un glisser d'unité (drag & drop)
    pendingCombat: null, // { atkUnits, defender } — combat en attente de décision
    showSupply: false, // overlay de la zone ravitaillée du camp actif
    showLegend: false, // panneau de légende (coin bas-droit)
    showStats: false, // filtre : PM & défense de chaque hexe
    showZoc: false, // zone d'influence (ZOC) des unités du camp actif
    attackers: new Set(), // ids des unités attaquantes (phase combat)
    combatSpotlight: null, // { atk: Set<key>, def: key } — combat que l'IA joue
    artyPreview: [], // appui d'artillerie du combat en aperçu { from, to }
    clearPending() {
      ui.pending = null;
      document.getElementById('moveConfirm').style.display = 'none';
    },
    clearSel() {
      ui.sel = null;
      ui.attackers.clear();
      ui.artyPreview = [];
      ui.clearPending();
    },
  };
  return ui;
}
