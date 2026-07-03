// ===========================================================================
//  Constantes de jeu — agnostiques du rendu.
//  Ces valeurs pilotent la géométrie, le terrain, les unités et la table de
//  combat (CRT). Elles sont importées par les modules de règles ET par le rendu.
// ===========================================================================

export const SIZE = 46;          // rayon d'un hex en pixels (rendu + géométrie)
export const COLS = 34;          // largeur de la carte en colonnes offset
export const ROWS = 22;          // hauteur de la carte en lignes offset
export const SQRT3 = Math.sqrt(3);
export const STACK_MAX = 3;      // limite d'empilement par hex et par camp
export const MAX_TURNS = 6;      // durée de la partie (objectifs comptés à la fin)
export const ARTY_RANGE = 3;     // portée d'appui de l'artillerie (en hex)
export const SUPPLY_RANGE = 8;   // longueur max d'une route de ravitaillement (hexes)

// Camp de base : hexe source du ravitaillement de chaque camp (col, row offset),
// posé en retrait de son bord de carte.
export const BASES = { axis: [1, 8], ally: [COLS - 2, 8] };

// Voisinage axial (6 directions).
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// Terrain : couleur (fill/stroke), coût de mouvement (PM) et décalage défensif
// (nombre de colonnes retirées à l'attaquant sur la CRT).
export const TERRAIN = {
  sea:   { name: 'Rivière',      fill: 0x35597f, stroke: 0x243f5c, cost: Infinity, def: 0 },
  coast: { name: 'Berge',        fill: 0x6a97ab, stroke: 0x3f6f86, cost: 1, def: 0 },
  sand:  { name: 'Plaine',       fill: 0x8faa5c, stroke: 0x67813f, cost: 1, def: 0 },
  sand2: { name: 'Plaine',       fill: 0x9cb768, stroke: 0x67813f, cost: 1, def: 0 },
  rock:  { name: 'Coteau',       fill: 0x8f8b7a, stroke: 0x605d4d, cost: 3, def: 2 },
  town:  { name: 'Ville/pont',   fill: 0xa89a72, stroke: 0x726643, cost: 1, def: 2 },
  oasis: { name: 'Bois',         fill: 0x4d7a3c, stroke: 0x335627, cost: 2, def: 1 },
  base:  { name: 'Camp de base', fill: 0x556a44, stroke: 0x2f3d24, cost: 1, def: 0 },
};

// Positions (colonne, ligne offset) des villes de terre ferme — objectifs de
// la partie (les ponts sur la rivière sont aussi des objectifs, voir map.js).
export const TOWNS = [[5, 5], [7, 15], [28, 6], [26, 16]];

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
