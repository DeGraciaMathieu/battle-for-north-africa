// ===========================================================================
//  Constantes de jeu — agnostiques du rendu.
//  Ces valeurs pilotent la géométrie, le terrain, les unités et la table de
//  combat (CRT). Elles sont importées par les modules de règles ET par le rendu.
// ===========================================================================

export const SIZE = 46;          // rayon d'un hex en pixels (rendu + géométrie)
export const COLS = 30;          // largeur de la carte en colonnes offset
export const ROWS = 20;          // hauteur de la carte en lignes offset
export const SQRT3 = Math.sqrt(3);
export const STACK_MAX = 3;      // limite d'empilement par hex et par camp
export const MAX_TURNS = 6;      // durée de la partie (objectifs comptés à la fin)
export const ARTY_RANGE = 3;     // portée d'appui de l'artillerie (en hex)
export const SUPPLY_RANGE = 8;   // longueur max d'une route de ravitaillement (hexes)

// Camp de base : hexe source du ravitaillement de chaque camp (col, row offset).
// Bleu (axis, joueur 1) démarre en bas-gauche, Rouge (ally) en haut-droite.
export const BASES = { axis: [1, ROWS - 3], ally: [COLS - 2, 2] };

// Voisinage axial (6 directions).
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// Terrain : couleur (fill/stroke), coût de mouvement (PM) et décalage défensif
// (nombre de colonnes retirées à l'attaquant sur la CRT).
export const TERRAIN = {
  sea:     { name: 'Rivière',      fill: 0x336d94, stroke: 0x1f4c6e, cost: Infinity, def: 0 },
  coast:   { name: 'Berge',        fill: 0x77aec2, stroke: 0x437a92, cost: 1, def: 0 },
  sand:    { name: 'Plaine',       fill: 0x93b957, stroke: 0x67863a, cost: 1, def: 0 },
  sand2:   { name: 'Plaine',       fill: 0xaacb69, stroke: 0x67863a, cost: 1, def: 0 },
  rock:    { name: 'Coteau',       fill: 0x9a9078, stroke: 0x655d49, cost: 3, def: 2 },
  town:    { name: 'Ville/pont',   fill: 0xbaa971, stroke: 0x7a6a3f, cost: 1, def: 2, supply: 6 },
  village: { name: 'Village',      fill: 0xa8977a, stroke: 0x6e6042, cost: 1, def: 2, supply: 4 },
  oasis:   { name: 'Bois',         fill: 0x468236, stroke: 0x2c5622, cost: 2, def: 1 },
  road:    { name: 'Route',        fill: 0xc2ab7a, stroke: 0x8a7550, cost: 0.5, def: -1 },
  base:    { name: 'Camp de base', fill: 0x5c7649, stroke: 0x33422a, cost: 1, def: 0, supply: SUPPLY_RANGE },
};

// Table de résolution des combats (CRT) indexée par rapport de force (ODDS).
export const ODDS = ['1:3', '1:2', '1:1', '2:1', '3:1', '4:1', '5:1', '6:1'];
export const CRT = { //  dé:  1     2     3     4     5     6
  '1:3': ['AE', 'AE', 'AR', 'AR', 'EX', 'DR'],
  '1:2': ['AE', 'AR', 'AR', 'EX', 'DR', 'DR'],
  '1:1': ['AR', 'AR', 'EX', 'DR', 'DR', 'DE'],
  '2:1': ['AR', 'EX', 'DR', 'DR', 'DE', 'DE'],
  '3:1': ['EX', 'DR', 'DR', 'DE', 'DE', 'DE'],
  '4:1': ['DR', 'DR', 'DE', 'DE', 'DE', 'DE'],
  '5:1': ['DR', 'DE', 'DE', 'DE', 'DE', 'DE'],
  '6:1': ['DE', 'DE', 'DE', 'DE', 'DE', 'DE'],
};
export const RESULT_FR = {
  AE: 'Attaquant éliminé', AR: 'Attaquant repoussé', EX: 'Échange',
  DR: 'Défenseur repoussé', DE: 'Défenseur éliminé',
};
